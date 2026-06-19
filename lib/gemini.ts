import { GoogleGenerativeAI } from '@google/generative-ai';

// Gemini 3.5 Flash pricing (USD per 1M tokens)
const PRICE_INPUT_PER_M = 0.15;
const PRICE_OUTPUT_PER_M = 0.60;
const USD_TO_THB = 34;

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

export async function callGeminiWithGrounding(prompt: string) {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash', tools: [{ googleSearch: {} } as any] });
  const result = await model.generateContent(prompt);
  const usage = result.response.usageMetadata;
  if (usage) trackUsage(usage.promptTokenCount ?? 0, usage.candidatesTokenCount ?? 0);
  return parseJSON(result.response.text());
}

export async function callGemini(prompt: string) {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });
  const result = await model.generateContent(prompt);
  const usage = result.response.usageMetadata;
  if (usage) trackUsage(usage.promptTokenCount ?? 0, usage.candidatesTokenCount ?? 0);
  return parseJSON(result.response.text());
}
