/**
 * WordGod — GoogleKeywordPlannerService
 *
 * Connects to Google Ads API (Keyword Planner) to fetch:
 * - Keyword ideas from seed keywords / URL
 * - Historical metrics (avg monthly searches, competition, CPC)
 *
 * Server-side only. Never expose credentials to frontend.
 * No OAuth flow here — expects pre-generated refresh token in env.
 */

import type { GoogleAdsConfig, KeywordPlannerResult, KeywordPlannerRow, SkillInput } from '../skills/keyword-seo-title/types';
import { readKeywordPlannerCache, writeKeywordPlannerCache, buildCacheKey } from '../cache/keywordPlannerCache';
import { appendFileSync } from 'fs';

// ─── Config ───────────────────────────────────────────────────────────────────

export function loadGoogleAdsConfig(): GoogleAdsConfig | null {
  const {
    GOOGLE_ADS_DEVELOPER_TOKEN,
    GOOGLE_ADS_CLIENT_ID,
    GOOGLE_ADS_CLIENT_SECRET,
    GOOGLE_ADS_REFRESH_TOKEN,
    GOOGLE_ADS_CUSTOMER_ID,
    GOOGLE_ADS_LOGIN_CUSTOMER_ID,
    GOOGLE_ADS_API_VERSION,
  } = process.env;

  if (!GOOGLE_ADS_DEVELOPER_TOKEN || !GOOGLE_ADS_CLIENT_ID || !GOOGLE_ADS_CLIENT_SECRET ||
      !GOOGLE_ADS_REFRESH_TOKEN || !GOOGLE_ADS_CUSTOMER_ID) {
    return null;
  }

  return {
    developerToken: GOOGLE_ADS_DEVELOPER_TOKEN,
    clientId: GOOGLE_ADS_CLIENT_ID,
    clientSecret: GOOGLE_ADS_CLIENT_SECRET,
    refreshToken: GOOGLE_ADS_REFRESH_TOKEN,
    customerId: normalizeCustomerId(GOOGLE_ADS_CUSTOMER_ID),
    loginCustomerId: GOOGLE_ADS_LOGIN_CUSTOMER_ID
      ? normalizeCustomerId(GOOGLE_ADS_LOGIN_CUSTOMER_ID)
      : undefined,
    apiVersion: GOOGLE_ADS_API_VERSION || 'v21',
  };
}

export function validateGoogleAdsConfig(config: GoogleAdsConfig | null): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!config) {
    return { valid: false, errors: ['Google Ads credentials not configured. Check GOOGLE_ADS_* env variables.'] };
  }
  if (!config.developerToken) errors.push('GOOGLE_ADS_DEVELOPER_TOKEN missing');
  if (!config.clientId) errors.push('GOOGLE_ADS_CLIENT_ID missing');
  if (!config.clientSecret) errors.push('GOOGLE_ADS_CLIENT_SECRET missing');
  if (!config.refreshToken) errors.push('GOOGLE_ADS_REFRESH_TOKEN missing');
  if (!config.customerId) errors.push('GOOGLE_ADS_CUSTOMER_ID missing');
  if (config.customerId && !/^\d+$/.test(config.customerId)) {
    errors.push(`GOOGLE_ADS_CUSTOMER_ID invalid format: ${config.customerId}`);
  }
  return { valid: errors.length === 0, errors };
}

// ─── ID normalizer ────────────────────────────────────────────────────────────

export function normalizeCustomerId(id: string): string {
  return id.replace(/-/g, '').trim();
}

// ─── Access Token ─────────────────────────────────────────────────────────────

export async function getAccessToken(config: GoogleAdsConfig): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new GoogleAdsApiError(`Failed to get access token: ${res.status} ${body}`, 'AUTH_ERROR');
  }

  const data = await res.json();
  if (!data.access_token) throw new GoogleAdsApiError('No access_token in OAuth response', 'AUTH_ERROR');
  return data.access_token;
}

// ─── Error class ─────────────────────────────────────────────────────────────

export class GoogleAdsApiError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'GoogleAdsApiError';
    this.code = code;
  }
}

// ─── Targeting helpers ────────────────────────────────────────────────────────

// Common language constants
const LANGUAGE_CONSTANTS: Record<string, string> = {
  th: 'languageConstants/1011',
  thai: 'languageConstants/1011',
  en: 'languageConstants/1000',
  english: 'languageConstants/1000',
};

// Common geo target constants
const GEO_TARGET_CONSTANTS: Record<string, string> = {
  thailand: 'geoTargetConstants/2764',
  th: 'geoTargetConstants/2764',
  us: 'geoTargetConstants/2840',
  usa: 'geoTargetConstants/2840',
};

function resolveLanguageResource(input: SkillInput): string {
  if (input.google_ads_language_resource) return input.google_ads_language_resource;
  const lang = (input.target_language_name || input.target_language || 'th').toLowerCase();
  return LANGUAGE_CONSTANTS[lang] || LANGUAGE_CONSTANTS['th'];
}

function resolveGeoTargetResources(input: SkillInput): string[] {
  if (input.google_ads_geo_target_resources?.length) return input.google_ads_geo_target_resources;
  const country = (input.target_country || 'Thailand').toLowerCase();
  const geo = GEO_TARGET_CONSTANTS[country] || GEO_TARGET_CONSTANTS['thailand'];
  return [geo];
}

// ─── Metric mappers ───────────────────────────────────────────────────────────

function mapCompetition(value: string | number | undefined): string {
  if (!value) return 'UNSPECIFIED';
  const v = String(value).toUpperCase();
  if (['LOW', 'MEDIUM', 'HIGH', 'UNSPECIFIED'].includes(v)) return v;
  return 'UNSPECIFIED';
}

function microsToUnit(micros: number | undefined | null): number {
  if (!micros || micros === 0) return 0;
  return Math.round((micros / 1_000_000) * 100) / 100;
}

function mapKeywordIdeaToRow(idea: any): KeywordPlannerRow {
  const metrics = idea.keywordIdeaMetrics || {};
  const monthlySearches = metrics.monthlySearchVolumes || [];
  const monthlyTrend = monthlySearches
    .map((m: any) => parseInt(m.monthlySearches || '0', 10))
    .filter((v: number) => !isNaN(v));

  const avgVolume = metrics.avgMonthlySearches
    ? parseInt(String(metrics.avgMonthlySearches), 10)
    : 0;

  return {
    keyword: idea.text || '',
    volume: isNaN(avgVolume) ? 0 : avgVolume,
    competition: mapCompetition(metrics.competition),
    competition_index: parseInt(String(metrics.competitionIndex || '0'), 10),
    low_cpc: microsToUnit(metrics.lowTopOfPageBidMicros),
    high_cpc: microsToUnit(metrics.highTopOfPageBidMicros),
    monthly_trend: monthlyTrend,
    source: 'google_keyword_planner_api',
  };
}

// ─── API calls ────────────────────────────────────────────────────────────────

async function generateKeywordIdeas(
  config: GoogleAdsConfig,
  accessToken: string,
  input: SkillInput
): Promise<KeywordPlannerRow[]> {
  const allSeeds = input.seed_keywords || [];
  const url = input.website_url;
  const language = resolveLanguageResource(input);
  const geoTargets = resolveGeoTargetResources(input);
  const network = input.keyword_plan_network || 'GOOGLE_SEARCH';

  if (allSeeds.length === 0 && !url) {
    throw new GoogleAdsApiError('Must provide seed_keywords or website_url', 'INVALID_INPUT');
  }

  // Google Ads limit: max 20 seed keywords per request
  const SEED_CHUNK = 20;
  const customerId = config.customerId;
  const endpoint = `https://googleads.googleapis.com/${config.apiVersion}/customers/${customerId}:generateKeywordIdeas`;
  const slog = (msg: string) => appendFileSync('/tmp/wordgod-metrics.log', `[Step1][${new Date().toISOString()}] ${msg}\n`);

  const allRows: KeywordPlannerRow[] = [];
  const seedChunks = allSeeds.length > 0
    ? Array.from({ length: Math.ceil(allSeeds.length / SEED_CHUNK) }, (_, i) => allSeeds.slice(i * SEED_CHUNK, (i + 1) * SEED_CHUNK))
    : [[]]; // url-only mode: one request, no seed chunks

  for (const seedChunk of seedChunks) {
    let keywordSeed: object;
    if (seedChunk.length > 0 && url) {
      keywordSeed = { keywordAndUrlSeed: { keywords: seedChunk, url } };
    } else if (seedChunk.length > 0) {
      keywordSeed = { keywordSeed: { keywords: seedChunk } };
    } else {
      keywordSeed = { urlSeed: { url } };
    }

    const body = {
      language,
      geoTargetConstants: geoTargets,
      keywordPlanNetwork: network,
      includeAdultKeywords: false,
      ...keywordSeed,
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'developer-token': config.developerToken,
        'Content-Type': 'application/json',
        ...(config.loginCustomerId ? { 'login-customer-id': config.loginCustomerId } : {}),
      },
      body: JSON.stringify(body),
    });

    const rawText = await res.text();
    if (!res.ok) {
      slog(`API error ${res.status}: ${rawText.slice(0, 400)}`);
      handleGoogleAdsApiError(res.status, rawText);
    }

    const data = JSON.parse(rawText);
    slog(`API ok — results: ${data.results?.length ?? 0}, seeds: ${seedChunk.slice(0,3).join(',')}`);
    if (data.results?.length > 0) slog(`sample: ${JSON.stringify(data.results[0]).slice(0, 200)}`);
    const rows = (data.results || []).map(mapKeywordIdeaToRow).filter((r: KeywordPlannerRow) => r.keyword);
    allRows.push(...rows);
  }

  // Deduplicate by keyword text
  const seen = new Set<string>();
  return allRows.filter(r => {
    if (seen.has(r.keyword)) return false;
    seen.add(r.keyword);
    return true;
  });
}

// ─── Error handler ────────────────────────────────────────────────────────────

export function handleGoogleAdsApiError(status: number, body: string): never {
  let parsed: any = {};
  try { parsed = JSON.parse(body); } catch {}

  const details = parsed?.error?.details || parsed?.error?.message || body;
  const msg = typeof details === 'string' ? details : JSON.stringify(details);

  if (status === 401) throw new GoogleAdsApiError(`Auth failed: ${msg}`, 'AUTH_ERROR');
  if (status === 403) throw new GoogleAdsApiError(`Permission denied: ${msg}`, 'PERMISSION_DENIED');
  if (status === 429) throw new GoogleAdsApiError(`Rate limited / quota exceeded: ${msg}`, 'QUOTA_EXCEEDED');
  if (status === 400) throw new GoogleAdsApiError(`Bad request: ${msg}`, 'BAD_REQUEST');
  throw new GoogleAdsApiError(`Google Ads API error ${status}: ${msg}`, 'API_ERROR');
}

// ─── Historical metrics (lookup volume for known keywords) ────────────────────

// generateKeywordHistoricalMetrics requires elevated permissions not available on this account.
// Instead, use generateKeywordIdeas with small seed batches and filter results to only
// keywords that exactly match the input — same endpoint as Step 1, no extra permissions needed.
export interface MetricEntry {
  volume: number;
  competition: string;
  competition_index: number;
  source: 'exact' | 'close_variant';
  variant_keyword?: string;  // the Planner keyword that provided volume (if close_variant)
}

export async function getHistoricalMetrics(
  keywords: string[],
  config: GoogleAdsConfig,
  accessToken: string,
  language: string = 'th',
  country: string = 'Thailand'
): Promise<Map<string, MetricEntry>> {
  const result = new Map<string, MetricEntry>();
  if (keywords.length === 0) return result;

  const languageResource = LANGUAGE_CONSTANTS[language.toLowerCase()] || LANGUAGE_CONSTANTS['th'];
  const geoResource = GEO_TARGET_CONSTANTS[country.toLowerCase()] || GEO_TARGET_CONSTANTS['thailand'];
  // Use client account ID in endpoint path; MCC goes in login-customer-id header only
  const customerId = config.customerId;
  const endpoint = `https://googleads.googleapis.com/${config.apiVersion}/customers/${customerId}:generateKeywordIdeas`;

  // Chunk size 10 — larger chunks give Planner more context → more relevant results
  // but still small enough to get each seed appearing in the response
  const CHUNK = 10;
  const MAX_RETRIES = 2;
  const logLine = (msg: string) => appendFileSync('/tmp/wordgod-metrics.log', `[${new Date().toISOString()}] ${msg}\n`);

  for (let i = 0; i < keywords.length; i += CHUNK) {
    const chunk = keywords.slice(i, i + CHUNK);
    const inputSet = new Set(chunk.map(k => k.trim().toLowerCase()));

    const body = {
      language: languageResource,
      geoTargetConstants: [geoResource],
      keywordPlanNetwork: 'GOOGLE_SEARCH',
      keywordSeed: { keywords: chunk },
    };

    let responseText = '';
    let success = false;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise(r => setTimeout(r, 1000 * attempt)); // 1s, 2s backoff
          logLine(`retry attempt ${attempt} for chunk: ${chunk[0]}`);
        }
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'developer-token': config.developerToken,
            'Content-Type': 'application/json',
            ...(config.loginCustomerId ? { 'login-customer-id': config.loginCustomerId } : {}),
          },
          body: JSON.stringify(body),
        });
        responseText = await res.text();
        if (!res.ok) {
          logLine(`API error ${res.status} (attempt ${attempt}): ${responseText.slice(0, 200)}`);
          if (res.status === 429 || res.status >= 500) continue; // retry on rate limit / server error
          break; // don't retry on 400/403
        }
        success = true;
        break;
      } catch (fetchErr) {
        logLine(`fetch exception (attempt ${attempt}): ${fetchErr}`);
      }
    }

    if (!success) {
      logLine(`chunk failed after retries, skipping: ${chunk[0]}`);
      continue;
    }

    try {

      const data = JSON.parse(responseText);
      logLine(`API ok — results: ${data.results?.length ?? 0}, chunk: ${chunk.join(',').slice(0, 80)}`);
      if (data.results?.length > 0) {
        logLine(`sample item: ${JSON.stringify(data.results[0]).slice(0, 200)}`);
      }

      // Build a map: plannerText → { metrics, plannerText } for all results in this batch
      // Used for close-variant fallback after exact matching
      const plannerResults: Array<{ plannerText: string; metrics: any }> = [];

      for (const item of (data.results || [])) {
        const rawText = (item.text || '').trim().toLowerCase();
        const plannerText = rawText.replace(/\s+/g, ' ');
        const closeVariants: string[] = (item.closeVariants || []).map((v: string) => v.trim().toLowerCase());
        const metrics = item.keywordIdeaMetrics || {};
        const volume = metrics.avgMonthlySearches ? parseInt(String(metrics.avgMonthlySearches), 10) : 0;
        if (isNaN(volume) || volume < 0) continue;

        plannerResults.push({ plannerText, metrics });

        // ── Exact / space-normalized match ──
        const allForms = [plannerText, ...closeVariants];
        const matchedInput = [...inputSet].find(inp =>
          allForms.some(form => form === inp || form.replace(/\s/g, '') === inp.replace(/\s/g, ''))
        );
        if (matchedInput && !result.has(matchedInput)) {
          result.set(matchedInput, {
            volume,
            competition: mapCompetition(metrics.competition),
            competition_index: parseInt(String(metrics.competitionIndex || '0'), 10),
            source: 'exact',
          });
          logLine(`exact: "${matchedInput}" vol=${volume}`);
        }
      }

      // ── Close-variant fallback for unmatched inputs ──
      // If an input keyword didn't get an exact match, find the Planner result whose
      // text shares the most words with the input and use its volume × 0.3 discount.
      // This is clearly labelled 'close_variant' so the pipeline can distinguish.
      const CLOSE_VARIANT_DISCOUNT = 0.3;
      const MIN_SHARED_WORDS = 2; // at least 2 words must overlap

      for (const inp of inputSet) {
        if (result.has(inp)) continue; // already matched exactly
        const inpWords = new Set(inp.split(/\s+/).filter(w => w.length > 1));
        if (inpWords.size === 0) continue;

        let bestScore = 0;
        let bestResult: { plannerText: string; metrics: any } | null = null;
        for (const pr of plannerResults) {
          const prWords = pr.plannerText.split(/\s+/);
          const shared = prWords.filter(w => inpWords.has(w)).length;
          if (shared > bestScore) { bestScore = shared; bestResult = pr; }
        }

        if (bestResult && bestScore >= MIN_SHARED_WORDS) {
          const rawVol = bestResult.metrics.avgMonthlySearches
            ? parseInt(String(bestResult.metrics.avgMonthlySearches), 10) : 0;
          if (!isNaN(rawVol) && rawVol > 0) {
            const discountedVol = Math.round(rawVol * CLOSE_VARIANT_DISCOUNT);
            result.set(inp, {
              volume: discountedVol,
              competition: mapCompetition(bestResult.metrics.competition),
              competition_index: parseInt(String(bestResult.metrics.competitionIndex || '0'), 10),
              source: 'close_variant',
              variant_keyword: bestResult.plannerText,
            });
            logLine(`close_variant: "${inp}" ← "${bestResult.plannerText}" vol=${rawVol}×0.3=${discountedVol}`);
          }
        }
      }
    } catch (err) {
      logLine(`parse/process exception: ${err}`);
    }
  }

  return result;
}

// ─── Main service function ────────────────────────────────────────────────────

export async function getKeywordPlannerRows(input: SkillInput): Promise<KeywordPlannerResult> {
  const config = loadGoogleAdsConfig();
  const { valid, errors } = validateGoogleAdsConfig(config);

  if (!valid) {
    return {
      success: false,
      rows: [],
      error: errors.join('; '),
    };
  }

  // Cache check
  const cacheKey = buildCacheKey(input);
  if (!input.force_refresh) {
    const cached = readKeywordPlannerCache(cacheKey);
    if (cached) {
      return { success: true, rows: cached.rows, cached: true, cached_at: cached.cached_at };
    }
  }

  try {
    const accessToken = await getAccessToken(config!);
    const rows = await generateKeywordIdeas(config!, accessToken, input);

    if (rows.length === 0) {
      return {
        success: false,
        rows: [],
        error: 'No keyword ideas returned from Google Keyword Planner.',
      };
    }

    // Write cache
    writeKeywordPlannerCache(cacheKey, rows);

    return { success: true, rows };
  } catch (err: any) {
    return {
      success: false,
      rows: [],
      error: err.message || String(err),
    };
  }
}
