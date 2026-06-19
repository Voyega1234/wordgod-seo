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
  const seeds = input.seed_keywords || [];
  const url = input.website_url;
  const language = resolveLanguageResource(input);
  const geoTargets = resolveGeoTargetResources(input);
  const network = input.keyword_plan_network || 'GOOGLE_SEARCH';

  // Build seed payload
  let keywordSeed: object | undefined;
  if (seeds.length > 0 && url) {
    keywordSeed = { keywordAndUrlSeed: { keywords: seeds, url } };
  } else if (seeds.length > 0) {
    keywordSeed = { keywordSeed: { keywords: seeds } };
  } else if (url) {
    keywordSeed = { urlSeed: { url } };
  } else {
    throw new GoogleAdsApiError('Must provide seed_keywords or website_url', 'INVALID_INPUT');
  }

  const body = {
    language,
    geoTargetConstants: geoTargets,
    keywordPlanNetwork: network,
    includeAdultKeywords: false,
    ...keywordSeed,
  };

  const customerId = config.loginCustomerId || config.customerId;
  const endpoint = `https://googleads.googleapis.com/${config.apiVersion}/customers/${customerId}:generateKeywordIdeas`;

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

  if (!res.ok) {
    const errBody = await res.text();
    handleGoogleAdsApiError(res.status, errBody);
  }

  const data = await res.json();
  const results = data.results || [];
  return results.map(mapKeywordIdeaToRow).filter((r: KeywordPlannerRow) => r.keyword);
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
export async function getHistoricalMetrics(
  keywords: string[],
  config: GoogleAdsConfig,
  accessToken: string,
  language: string = 'th',
  country: string = 'Thailand'
): Promise<Map<string, { volume: number; competition: string; competition_index: number }>> {
  const result = new Map<string, { volume: number; competition: string; competition_index: number }>();
  if (keywords.length === 0) return result;

  const languageResource = LANGUAGE_CONSTANTS[language.toLowerCase()] || LANGUAGE_CONSTANTS['th'];
  const geoResource = GEO_TARGET_CONSTANTS[country.toLowerCase()] || GEO_TARGET_CONSTANTS['thailand'];
  const customerId = config.loginCustomerId || config.customerId;
  const endpoint = `https://googleads.googleapis.com/${config.apiVersion}/customers/${customerId}:generateKeywordIdeas`;

  // Small batches — Planner returns ideas related to ALL seeds combined.
  // Smaller batches = higher chance each seed appears in results.
  const CHUNK = 5;
  for (let i = 0; i < keywords.length; i += CHUNK) {
    const chunk = keywords.slice(i, i + CHUNK);
    const inputSet = new Set(chunk.map(k => k.trim().toLowerCase()));

    const body = {
      language: languageResource,
      geoTargetConstants: [geoResource],
      keywordPlanNetwork: 'GOOGLE_SEARCH',
      keywordSeed: { keywords: chunk },
    };

    try {
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

      const responseText = await res.text();
      const logLine = (msg: string) => {
        appendFileSync('/tmp/wordgod-metrics.log', `[${new Date().toISOString()}] ${msg}\n`);
      };

      if (!res.ok) {
        logLine(`API error ${res.status}: ${responseText.slice(0, 300)}`);
        continue;
      }

      const data = JSON.parse(responseText);
      logLine(`API ok — results: ${data.results?.length ?? 0}, chunk: ${chunk.join(',').slice(0, 80)}`);
      if (data.results?.length > 0) {
        logLine(`sample item: ${JSON.stringify(data.results[0]).slice(0, 200)}`);
      }

      for (const item of (data.results || [])) {
        const rawText = (item.text || '').trim().toLowerCase();
        // Planner sometimes inserts spaces between chars — normalize by removing all spaces for matching
        const normalizedText = rawText.replace(/\s+/g, ' ');
        // Also try close variants (original keyword without space insertion)
        const closeVariants: string[] = (item.closeVariants || []).map((v: string) => v.trim().toLowerCase());
        const allForms = [normalizedText, ...closeVariants];

        // Find which input keyword this result belongs to
        const matchedInput = [...inputSet].find(input =>
          allForms.some(form => form === input || form.replace(/\s/g, '') === input.replace(/\s/g, ''))
        );
        if (!matchedInput) continue;

        const metrics = item.keywordIdeaMetrics || {};
        const volume = metrics.avgMonthlySearches ? parseInt(String(metrics.avgMonthlySearches), 10) : 0;
        if (!isNaN(volume)) {
          result.set(matchedInput, {
            volume,
            competition: mapCompetition(metrics.competition),
            competition_index: parseInt(String(metrics.competitionIndex || '0'), 10),
          });
          logLine(`matched: "${matchedInput}" vol=${volume}`);
        }
      }
    } catch (err) {
      appendFileSync('/tmp/wordgod-metrics.log', `[${new Date().toISOString()}] exception: ${err}\n`);
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
