/**
 * WordGod — EEAT Gemini Deep Synthesis
 *
 * Opt-in, LLM-assisted second pass over a deep-crawl result. The rule-based
 * `eeatSkill` module scores every page deterministically; this module asks
 * Gemini (via Vertex OIDC — no API key) to re-read a *sampled* subset of pages
 * and produce a refined DPAM E-E-A-T judgement with rationale, gaps, and
 * actionable recommendations.
 *
 * Design guarantees:
 *   - Cost-bounded: only a capped sample of pages is sent (default 40),
 *     batched (default 5 pages/call) to minimise call count.
 *   - Sampled by weakness: thin / signal-poor pages are prioritised so the
 *     spend goes where the SEO risk is highest.
 *   - Honest: unread pages (ok === false || wordCount === 0) are never scored.
 *     Every model score is clamped to 0–10; malformed / missing model output
 *     degrades a page to `scored: false` rather than fabricating a number.
 *   - Cost-transparent: token cost of THIS synthesis is measured as the delta
 *     of the shared session usage counter and returned in THB.
 *
 * No network call happens unless the default deps are used; both the Gemini
 * call and the usage getter are injectable for deterministic testing.
 */

import type { DeepCrawlResult, CrawledPage } from '../services/siteCrawlService';
import type { GeminiCallOptions, TokenUsage } from '../gemini';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GeminiEeatDimension {
  score: number;        // 0–10, clamped
  rationale: string;    // why this score, grounded in the page text provided
  gaps: string[];       // what is missing to improve this dimension
}

export interface GeminiEeatScore {
  url: string;
  experience: GeminiEeatDimension;
  expertise: GeminiEeatDimension;
  authority: GeminiEeatDimension;
  trust: GeminiEeatDimension;
  overall: number;              // 0–10, average of the four (clamped)
  recommendations: string[];    // concrete, page-specific SEO/EEAT fixes
  method: 'gemini';
  scored: boolean;              // false = not read or model output unusable
  notes: string[];
}

export interface GeminiEeatSynthesis {
  method: 'gemini';
  model: string;
  pagesEligible: number;    // read pages that could be synthesised
  pagesRequested: number;   // pages actually sent (after cap)
  pagesSynthesized: number; // pages with a usable model score
  pagesSkipped: number;     // eligible-but-capped + unread + failed
  batches: number;
  scores: GeminiEeatScore[];
  cost: TokenUsage;         // token cost of THIS synthesis only (delta)
  notes: string[];
}

export interface GeminiSynthesisOptions {
  maxPages?: number;         // hard cap on pages sent to Gemini (default 40)
  batchSize?: number;        // pages per Gemini call (default 5)
  language?: 'th' | 'en';    // prompt language (default 'th')
  textCharsPerPage?: number; // truncate each page's text (default 2000)
}

export interface GeminiSynthesisDeps {
  /** Injectable Gemini call. Defaults to the real Vertex-OIDC callGemini. */
  call?: (prompt: string, options?: GeminiCallOptions) => Promise<unknown>;
  /** Injectable session-usage getter. Defaults to the real getSessionUsage. */
  getUsage?: () => TokenUsage;
}

const GEMINI_MODEL = 'gemini-3.5-flash';

const DEFAULTS: Required<Omit<GeminiSynthesisOptions, 'language'>> & { language: 'th' | 'en' } = {
  maxPages: 40,
  batchSize: 5,
  language: 'th',
  textCharsPerPage: 2000,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clampScore(n: unknown): number {
  const num = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(10, Math.round(num * 10) / 10));
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(v => (typeof v === 'string' ? v : String(v))).filter(s => s.trim().length > 0).slice(0, 8);
}

function isReadable(page: CrawledPage): boolean {
  return page.ok === true && page.wordCount > 0 && page.text.trim().length > 0;
}

/**
 * Rank read pages by weakness so the capped spend targets the riskiest pages:
 * more missing signals first, then thinner content first.
 */
function selectPages(pages: CrawledPage[], maxPages: number): CrawledPage[] {
  return pages
    .filter(isReadable)
    .sort((a, b) => {
      const miss = (b.missingSignals?.length ?? 0) - (a.missingSignals?.length ?? 0);
      if (miss !== 0) return miss;
      return a.wordCount - b.wordCount;
    })
    .slice(0, Math.max(0, maxPages));
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += Math.max(1, size)) out.push(items.slice(i, i + Math.max(1, size)));
  return out;
}

function usageDelta(before: TokenUsage, after: TokenUsage): TokenUsage {
  return {
    input_tokens: after.input_tokens - before.input_tokens,
    output_tokens: after.output_tokens - before.output_tokens,
    total_tokens: after.total_tokens - before.total_tokens,
    cost_usd: Math.max(0, after.cost_usd - before.cost_usd),
    cost_thb: Math.max(0, after.cost_thb - before.cost_thb),
  };
}

function unusableScore(url: string, note: string): GeminiEeatScore {
  const empty: GeminiEeatDimension = { score: 0, rationale: '', gaps: [note] };
  return {
    url,
    experience: empty,
    expertise: empty,
    authority: empty,
    trust: empty,
    overall: 0,
    recommendations: [],
    method: 'gemini',
    scored: false,
    notes: [note],
  };
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

function buildPrompt(batch: CrawledPage[], textCharsPerPage: number, language: 'th' | 'en'): string {
  const pageBlocks = batch.map((page, i) => {
    const text = (page.text || '').slice(0, textCharsPerPage);
    const headings = (page.headings || []).slice(0, 12).join(' | ');
    return [
      `### PAGE ${i + 1}`,
      `url: ${page.url}`,
      `title: ${page.title || '(none)'}`,
      `headings: ${headings || '(none)'}`,
      `detected_missing_signals: ${(page.missingSignals || []).join(', ') || '(none)'}`,
      `content:`,
      text || '(empty)',
    ].join('\n');
  }).join('\n\n');

  const langInstruction = language === 'th'
    ? 'Write every rationale, gap, and recommendation in Thai.'
    : 'Write every rationale, gap, and recommendation in English.';

  return [
    'You are an SEO E-E-A-T auditor applying the DPAM rubric (Experience, Expertise, Authoritativeness, Trust).',
    'Score EACH page below on the four dimensions from 0 to 10.',
    '',
    'STRICT RULES:',
    '- Base every judgement ONLY on the provided page content. Do NOT invent facts, authors, credentials, citations, or dates that are not present.',
    '- If the content is too thin or empty to judge a dimension, give a low score and say so in the rationale. Never guess to be generous.',
    '- Experience = first-hand use/testing/personal examples. Expertise = demonstrated subject knowledge/credentials in the text. Authoritativeness = signals the source is recognised (author bylines, citations, brand). Trust = accuracy signals, transparency, contact/policy cues, balanced claims.',
    '- Recommendations must be concrete and specific to that page.',
    `- ${langInstruction}`,
    '',
    'Return ONLY valid JSON (no markdown) with this exact shape:',
    '{"pages":[{"url":"...","experience":{"score":0,"rationale":"...","gaps":["..."]},"expertise":{"score":0,"rationale":"...","gaps":["..."]},"authority":{"score":0,"rationale":"...","gaps":["..."]},"trust":{"score":0,"rationale":"...","gaps":["..."]},"recommendations":["..."]}]}',
    'The "pages" array MUST contain exactly one object per PAGE, in the same order, with the same url.',
    '',
    pageBlocks,
  ].join('\n');
}

function parseDimension(raw: unknown): GeminiEeatDimension {
  const obj = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  return {
    score: clampScore(obj.score),
    rationale: typeof obj.rationale === 'string' ? obj.rationale : '',
    gaps: toStringArray(obj.gaps),
  };
}

function mapModelPage(url: string, raw: unknown): GeminiEeatScore {
  if (!raw || typeof raw !== 'object') {
    return unusableScore(url, 'gemini-no-output');
  }
  const obj = raw as Record<string, unknown>;
  const experience = parseDimension(obj.experience);
  const expertise = parseDimension(obj.expertise);
  const authority = parseDimension(obj.authority);
  const trust = parseDimension(obj.trust);
  const overall = clampScore((experience.score + expertise.score + authority.score + trust.score) / 4);
  return {
    url,
    experience,
    expertise,
    authority,
    trust,
    overall,
    recommendations: toStringArray(obj.recommendations),
    method: 'gemini',
    scored: true,
    notes: [],
  };
}

/**
 * Extract the model's per-page array from whatever shape parseJSON returned
 * ({pages:[...]}, a bare [...], or a single object) and align it to the batch
 * by url first, falling back to positional order.
 */
function alignBatchResults(batch: CrawledPage[], modelOutput: unknown): GeminiEeatScore[] {
  let items: unknown[] = [];
  if (Array.isArray(modelOutput)) {
    items = modelOutput;
  } else if (modelOutput && typeof modelOutput === 'object') {
    const pages = (modelOutput as Record<string, unknown>).pages;
    if (Array.isArray(pages)) items = pages;
    else items = [modelOutput];
  }

  const byUrl = new Map<string, unknown>();
  for (const it of items) {
    if (it && typeof it === 'object') {
      const u = (it as Record<string, unknown>).url;
      if (typeof u === 'string') byUrl.set(u, it);
    }
  }

  return batch.map((page, idx) => {
    const raw = byUrl.get(page.url) ?? items[idx];
    if (raw === undefined) return unusableScore(page.url, 'gemini-missing-in-batch');
    return mapModelPage(page.url, raw);
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function synthesizeEeatWithGemini(
  result: DeepCrawlResult,
  options: GeminiSynthesisOptions = {},
  deps: GeminiSynthesisDeps = {},
): Promise<GeminiEeatSynthesis> {
  const maxPages = options.maxPages ?? DEFAULTS.maxPages;
  const batchSize = options.batchSize ?? DEFAULTS.batchSize;
  const language = options.language ?? DEFAULTS.language;
  const textCharsPerPage = options.textCharsPerPage ?? DEFAULTS.textCharsPerPage;

  // Load the real Vertex module only when a dep is missing. When both deps are
  // injected (tests), the module is never imported and no SDK/OIDC is touched.
  const realGemini = (!deps.call || !deps.getUsage) ? await import('../gemini') : null;
  const call = deps.call
    ?? ((prompt: string, opts?: GeminiCallOptions) => realGemini!.callGemini(prompt, opts));
  const getUsage = deps.getUsage ?? (() => realGemini!.getSessionUsage());

  const eligible = (result.pages || []).filter(isReadable);
  const selected = selectPages(result.pages || [], maxPages);
  const notes: string[] = [];
  if (eligible.length > selected.length) {
    notes.push(`capped: synthesised ${selected.length} of ${eligible.length} readable pages (maxPages=${maxPages})`);
  }
  const unread = (result.pages || []).length - eligible.length;
  if (unread > 0) notes.push(`${unread} page(s) not read (crawl failure or empty) — not scored`);

  const before = getUsage();
  const batches = chunk(selected, batchSize);
  const scores: GeminiEeatScore[] = [];

  for (const batch of batches) {
    try {
      const output = await call(
        buildPrompt(batch, textCharsPerPage, language),
        { functionLabel: 'eeat_synthesis' },
      );
      scores.push(...alignBatchResults(batch, output));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'gemini-call-failed';
      for (const page of batch) scores.push(unusableScore(page.url, `gemini-error: ${msg}`));
      notes.push(`batch failed (${batch.length} pages): ${msg}`);
    }
  }

  const after = getUsage();
  const cost = usageDelta(before, after);
  const pagesSynthesized = scores.filter(s => s.scored).length;

  return {
    method: 'gemini',
    model: GEMINI_MODEL,
    pagesEligible: eligible.length,
    pagesRequested: selected.length,
    pagesSynthesized,
    pagesSkipped: (result.pages || []).length - pagesSynthesized,
    batches: batches.length,
    scores,
    cost,
    notes,
  };
}
