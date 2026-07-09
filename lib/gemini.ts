import { createVertex } from '@ai-sdk/google-vertex';
import { getVercelOidcToken } from '@vercel/oidc';
import { generateText } from 'ai';
import { ExternalAccountClient } from 'google-auth-library';

// gemini-3.5-flash pricing (USD per 1M tokens)
const PRICE_INPUT_PER_M = 0.15;
const PRICE_OUTPUT_PER_M = 0.60;
const USD_TO_THB = 34;
const GEMINI_MODEL = 'gemini-3.5-flash';
const GEMINI_PROJECT_LABEL = 'wordgod';

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  cost_thb: number;
}

export interface GeminiCallOptions {
  functionLabel?: string;
  labels?: Record<string, string>;
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

function sanitizeLabelPart(value: string, fallback: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[^a-z]+/, '')
    .slice(0, 63);
  return sanitized || fallback;
}

function getRuntimeEnvironmentLabel(): string {
  if (process.env.VERCEL_ENV) return sanitizeLabelPart(process.env.VERCEL_ENV, 'unknown');
  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
}

function buildGeminiLabels(functionLabel = 'general', extraLabels: Record<string, string> = {}) {
  const labels: Record<string, string> = {
    project: GEMINI_PROJECT_LABEL,
    component: 'gemini',
    function: sanitizeLabelPart(functionLabel, 'general'),
    environment: getRuntimeEnvironmentLabel(),
  };

  for (const [key, value] of Object.entries(extraLabels)) {
    const labelKey = sanitizeLabelPart(key, 'label');
    labels[labelKey] = sanitizeLabelPart(value, 'unknown');
  }

  return labels;
}

let vertexProvider: ReturnType<typeof createVertex> | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function getVertexProvider() {
  if (vertexProvider) return vertexProvider;

  const projectId = requireEnv('GCP_PROJECT_ID');
  const projectNumber = requireEnv('GCP_PROJECT_NUMBER');
  const serviceAccountEmail = requireEnv('GCP_SERVICE_ACCOUNT_EMAIL');
  const poolId = requireEnv('GCP_WORKLOAD_IDENTITY_POOL_ID');
  const providerId = requireEnv('GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID');
  const workloadProvider = `projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`;
  const audience = process.env.GCP_AUDIENCE || `//iam.googleapis.com/${workloadProvider}`;

  const authClient = ExternalAccountClient.fromJSON({
    type: 'external_account',
    audience,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url:
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccountEmail}:generateAccessToken`,
    subject_token_supplier: {
      getSubjectToken: () => process.env.GCP_AUDIENCE
        ? getVercelOidcToken({ audience })
        : getVercelOidcToken(),
    },
  });

  if (!authClient) throw new Error('Failed to initialize the Google external account client');

  vertexProvider = createVertex({
    project: projectId,
    location: process.env.GCP_LOCATION || 'global',
    googleAuthOptions: {
      authClient,
      projectId,
    },
  });
  return vertexProvider;
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

function extractGroundingMetadata(providerMetadata: unknown): GroundingMetadata {
  const metadata = providerMetadata as Record<string, any> | undefined;
  const meta = metadata?.vertex?.groundingMetadata
    ?? metadata?.googleVertex?.groundingMetadata
    ?? {};

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

async function generateVertexText(prompt: string, useGoogleSearch = false, options: GeminiCallOptions = {}) {
  const vertex = getVertexProvider();
  const result = await generateText({
    model: vertex(GEMINI_MODEL),
    prompt,
    providerOptions: {
      googleVertex: {
        labels: buildGeminiLabels(options.functionLabel, options.labels),
      },
    },
    ...(useGoogleSearch ? {
      tools: { google_search: vertex.tools.googleSearch({}) },
    } : {}),
  });
  trackUsage(result.usage.inputTokens ?? 0, result.usage.outputTokens ?? 0);
  return result;
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
export async function callGeminiWithGrounding(prompt: string, returnGrounding: false, options?: GeminiCallOptions): Promise<any>;
export async function callGeminiWithGrounding(prompt: string, returnGrounding: true, options?: GeminiCallOptions): Promise<GroundedResult>;
export async function callGeminiWithGrounding(prompt: string, returnGrounding?: boolean, options: GeminiCallOptions = {}): Promise<any> {
  if (!returnGrounding) {
    return withRetry(async () => {
      const result = await generateVertexText(prompt, true, options);
      return parseJSON(result.text);
    });
  }

  const { researchPrompt, jsonSchema } = splitResearchPrompt(prompt);

  const researchResult = await withRetry(() => generateVertexText(researchPrompt, true, {
    ...options,
    functionLabel: `${options.functionLabel ?? 'grounded_generation'}_research`,
  }));
  const researchText = researchResult.text;
  const grounding = extractGroundingMetadata(researchResult.providerMetadata);

  let data: any;
  if (jsonSchema) {
    const formatPrompt = `Based on this research:\n\n${researchText}\n\nReturn ONLY valid JSON matching this schema (no markdown):\n${jsonSchema}`;
    data = await withRetry(async () => {
      const formatResult = await generateVertexText(formatPrompt, false, {
        ...options,
        functionLabel: `${options.functionLabel ?? 'grounded_generation'}_format`,
      });
      return parseJSON(formatResult.text);
    });
  } else {
    data = parseJSON(researchText);
  }

  return { data, grounding };
}

export async function callGemini(prompt: string, options: GeminiCallOptions = {}) {
  return withRetry(async () => {
    const result = await generateVertexText(prompt, false, options);
    return parseJSON(result.text);
  });
}
