import { GoogleGenerativeAI } from '@google/generative-ai';

// Default pricing estimate is based on gemini-3-flash-preview (USD per 1M tokens).
// If GEMINI_MODEL is changed, update pricing constants if exact cost reporting matters.
const PRICE_INPUT_PER_M = 0.15;
const PRICE_OUTPUT_PER_M = 0.60;
const USD_TO_THB = 34;
const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview';

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  cost_thb: number;
}

// Accumulated across entire pipeline run
let sessionUsage: TokenUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0, cost_thb: 0 };

export function resetSessionUsage() {
  sessionUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0, cost_thb: 0 };
}

export function getSessionUsage(): TokenUsage {
  return { ...sessionUsage };
}

function trackUsage(inputTokens: number, outputTokens: number) {
  const cost_usd = (inputTokens / 1_000_000) * PRICE_INPUT_PER_M + (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_M;
  sessionUsage.input_tokens += inputTokens;
  sessionUsage.output_tokens += outputTokens;
  sessionUsage.total_tokens += inputTokens + outputTokens;
  sessionUsage.cost_usd += cost_usd;
  sessionUsage.cost_thb += cost_usd * USD_TO_THB;
}

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  return new GoogleGenerativeAI(apiKey);
}

export function getGeminiModelName() {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

function parseJSON(text: string) {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  let startIndex: number;
  if (firstBrace === -1 && firstBracket === -1) throw new Error('No JSON in response');
  else if (firstBrace === -1) startIndex = firstBracket;
  else if (firstBracket === -1) startIndex = firstBrace;
  else startIndex = Math.min(firstBrace, firstBracket);
  const jsonStr = cleaned.substring(startIndex);
  try {
    return JSON.parse(jsonStr);
  } catch {
    let depth = 0, inString = false, escape = false;
    for (let i = 0; i < jsonStr.length; i++) {
      const ch = jsonStr[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{' || ch === '[') depth++;
      if (ch === '}' || ch === ']') { depth--; if (depth === 0) return JSON.parse(jsonStr.substring(0, i + 1)); }
    }
    throw new Error('Failed to parse JSON');
  }
}

function isRateLimitError(err: any): boolean {
  const msg: string = err?.message ?? String(err);
  return msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429') || msg.includes('quota');
}

// Retry wrapper for Gemini calls — handles rate limits with exponential backoff
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  const BACKOFFS = [5000, 15000, 30000];
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (isRateLimitError(err) && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, BACKOFFS[attempt] ?? 30000));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Gemini: max retries exceeded');
}

export interface GroundingMetadata {
  webSearchQueries: string[];
  sourceUrls: string[];
  sourceTitles: string[];
}

export interface GroundedResult {
  data: any;
  grounding: GroundingMetadata;
}

function extractGroundingMetadata(aggregatedResponse: any): GroundingMetadata {
  const candidates = aggregatedResponse?.candidates ?? [];
  const meta = candidates[0]?.groundingMetadata ?? {};

  const webSearchQueries: string[] = meta.webSearchQueries ?? [];
  const chunks: any[] = meta.groundingChunks ?? [];
  const sourceUrls: string[] = [];
  const sourceTitles: string[] = [];
  for (const chunk of chunks) {
    const uri = chunk.web?.uri ?? '';
    const title = chunk.web?.title ?? '';
    if (uri) sourceUrls.push(uri);
    if (title) sourceTitles.push(title);
  }

  return { webSearchQueries, sourceUrls, sourceTitles };
}

async function callWithGroundingMetadata(
  model: any,
  prompt: string
): Promise<{ text: string; grounding: GroundingMetadata }> {
  // Streaming to get grounding metadata — SDK only populates groundingMetadata
  // on the aggregated stream response, not on the non-streaming generateContent response.
  const streamResult = await model.generateContentStream(prompt);
  const chunks: any[] = [];
  for await (const chunk of streamResult.stream) {
    chunks.push(chunk);
  }
  const aggResponse = await streamResult.response;

  let fullText = '';
  for (const chunk of chunks) {
    try { fullText += chunk.text(); } catch { /* chunk has no text part */ }
  }
  if (!fullText) {
    try { fullText = aggResponse.text(); } catch { /* ignore */ }
  }

  const usage = aggResponse.usageMetadata;
  if (usage) trackUsage(usage.promptTokenCount ?? 0, usage.candidatesTokenCount ?? 0);

  const grounding = extractGroundingMetadata(aggResponse);
  return { text: fullText, grounding };
}

function makeGroundingModel(genAI: GoogleGenerativeAI) {
  return genAI.getGenerativeModel({
    model: getGeminiModelName(),
    tools: [{ googleSearch: {} } as any],
  });
}

// Strip JSON schema from prompt so Gemini doesn't skip Google Search.
function splitResearchPrompt(prompt: string): { researchPrompt: string; jsonSchema: string } {
  const jsonStart = prompt.search(/\{[\s\S]*"(?:keywords|problems)":/);
  if (jsonStart === -1) return { researchPrompt: prompt, jsonSchema: '' };
  const beforeJson = prompt.substring(0, jsonStart);
  const lastRealLine = beforeJson.lastIndexOf('\n', beforeJson.trimEnd().length - 1);
  const instructions = beforeJson.substring(0, lastRealLine).trimEnd();
  const schema = prompt.substring(jsonStart).trim();
  const researchPrompt = instructions +
    '\n\nUse Google Search to research this topic. Report all findings as plain text — real keywords, problems, data, patterns you find.';
  return { researchPrompt, jsonSchema: schema };
}

export async function callGeminiWithGrounding(prompt: string): Promise<any>;
export async function callGeminiWithGrounding(prompt: string, returnGrounding: true): Promise<GroundedResult>;
export async function callGeminiWithGrounding(prompt: string, returnGrounding?: boolean): Promise<any> {
  const genAI = getClient();
  const groundingModel = makeGroundingModel(genAI);
  const jsonModel = genAI.getGenerativeModel({ model: getGeminiModelName() });

  if (!returnGrounding) {
    return withRetry(async () => {
      const result = await groundingModel.generateContent(prompt);
      const usage = result.response.usageMetadata;
      if (usage) trackUsage(usage.promptTokenCount ?? 0, usage.candidatesTokenCount ?? 0);
      return parseJSON(result.response.text());
    });
  }

  const { researchPrompt, jsonSchema } = splitResearchPrompt(prompt);

  const { text: researchText, grounding } = await withRetry(() =>
    callWithGroundingMetadata(groundingModel, researchPrompt)
  );

  let data: any;
  if (jsonSchema) {
    const formatPrompt = `Based on this research:\n\n${researchText}\n\nReturn ONLY valid JSON matching this schema (no markdown):\n${jsonSchema}`;
    data = await withRetry(async () => {
      const formatResult = await jsonModel.generateContent(formatPrompt);
      const usage2 = formatResult.response.usageMetadata;
      if (usage2) trackUsage(usage2.promptTokenCount ?? 0, usage2.candidatesTokenCount ?? 0);
      return parseJSON(formatResult.response.text());
    });
  } else {
    data = parseJSON(researchText);
  }

  return { data, grounding };
}

export async function callGemini(prompt: string) {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: getGeminiModelName() });
  return withRetry(async () => {
    const result = await model.generateContent(prompt);
    const usage = result.response.usageMetadata;
    if (usage) trackUsage(usage.promptTokenCount ?? 0, usage.candidatesTokenCount ?? 0);
    return parseJSON(result.response.text());
  });
}
