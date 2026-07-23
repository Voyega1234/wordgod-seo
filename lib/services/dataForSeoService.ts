/**
 * WordGod — DataForSEO Service
 *
 * Provides keyword volume, competition, and CPC data as a fallback
 * when Google Keyword Planner returns 0 or has no data.
 *
 * Flow: KP exact → KP close variant → DataForSEO → Gemini estimate
 *
 * Server-side only. Credentials stay in process.env.
 */

import {
  CPC_OUTPUT_CURRENCY,
  convertAmountToCpcCurrency,
  getCpcConversion,
} from './cpcCurrency';

export interface DFSMetric {
  volume: number;
  competition: string;        // LOW | MEDIUM | HIGH | UNSPECIFIED
  competition_index: number;  // 0–100
  cpc: number;                // cost per click normalized to THB
  cpc_currency: 'THB';
  cpc_original_currency: 'USD';
  cpc_to_thb_rate?: number;
  cpc_rate_as_of?: string;
  cpc_rate_source?: string;
  cpc_conversion_available: boolean;
  source: 'dataforseo';
}

export interface DFSKeywordDifficultyResult {
  metrics: Map<string, number>;
  costUsd: number;
  calledKeywords: number;
}

interface DFSMonthlySearch {
  year: number;
  month: number;
  search_volume: number;
}

interface DFSKeywordResult {
  keyword: string;
  search_volume: number;
  competition: number | string; // float 0–1 (old) or string label (new API)
  competition_level?: string;   // LOW | MEDIUM | HIGH (older endpoints)
  competition_index?: number;   // 0–100 integer (newer endpoints)
  cpc: number;
  monthly_searches: DFSMonthlySearch[];
}

function getCredentials(): { login: string; password: string } | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return { login, password };
}

function makeBasicAuth(login: string, password: string): string {
  return 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64');
}

function toCompetitionLabel(level: string, index: number): string {
  if (level) {
    const l = level.toUpperCase();
    if (l === 'LOW' || l === 'MEDIUM' || l === 'HIGH') return l;
  }
  if (index >= 67) return 'HIGH';
  if (index >= 34) return 'MEDIUM';
  if (index > 0) return 'LOW';
  return 'UNSPECIFIED';
}

// Chunk array into groups of N
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// 1 task per keyword gives the best match rates for Thai long-tail keywords.
// Batch 100 tasks per HTTP request; run 5 requests in parallel for throughput.
const TASKS_PER_REQUEST = 100;
const DFS_PARALLEL = 5;
const MAX_RETRIES = 2;

export async function getDataForSeoVolumes(
  keywords: string[],
  languageCode = 'th',
  locationCode = 2764, // Thailand
  onWarning?: (warning: string) => void
): Promise<Map<string, DFSMetric>> {
  const creds = getCredentials();
  if (!creds) return new Map();

  const resultMap = new Map<string, DFSMetric>();
  const auth = makeBasicAuth(creds.login, creds.password);
  const chunks = chunk(keywords, TASKS_PER_REQUEST);
  let cpcConversion: Awaited<ReturnType<typeof getCpcConversion>> | null = null;
  try {
    cpcConversion = await getCpcConversion('USD');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    onWarning?.(`DataForSEO CPC was withheld because USD could not be converted to THB: ${reason}. Search Volume remains usable.`);
  }

  // Process chunks in parallel waves of DFS_PARALLEL
  for (let w = 0; w < chunks.length; w += DFS_PARALLEL) {
    await Promise.all(chunks.slice(w, w + DFS_PARALLEL).map(async (kwChunk) => {
    let lastError: string = '';

    // Build one task per keyword — DFS matches each keyword independently
    const requestBody = kwChunk.map(keyword => ({
      keywords: [keyword],
      language_code: languageCode,
      location_code: locationCode,
    }));

    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
      try {
        const res = await fetch(
          'https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live',
          {
            method: 'POST',
            headers: {
              Authorization: auth,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(30000),
          }
        );

        if (res.status === 429) {
          lastError = 'Rate limited';
          if (attempt <= MAX_RETRIES) {
            await new Promise(r => setTimeout(r, attempt * 2000));
            continue;
          }
          break;
        }

        if (!res.ok) {
          lastError = `HTTP ${res.status}`;
          break;
        }

        const data = await res.json();

        if (data.status_code !== 20000) {
          lastError = data.status_message || `DFS error ${data.status_code}`;
          break;
        }

        for (const task of data.tasks || []) {
          if (task.status_code !== 20000) continue;
          for (const result of task.result || []) {
            // API returns either result.items[] (some endpoints) or result is the item directly
            // For search_volume/live: Thai keywords come as flat result objects, not nested in items
            const items: DFSKeywordResult[] = result.items?.length
              ? result.items
              : result.keyword
                ? [result]   // flat result object IS the keyword item
                : [];
            for (const item of items) {
              if (!item.keyword) continue;
              // competition field: may be a float 0-1 (old) or string label (new)
              const compLevel = typeof item.competition === 'string'
                ? item.competition
                : (item as any).competition_level ?? '';
              const compIndex = typeof item.competition === 'number'
                ? Math.round(item.competition * 100)
                : (item as any).competition_index ?? 0;
              resultMap.set(item.keyword.toLowerCase().trim(), {
                volume: item.search_volume ?? 0,
                competition: toCompetitionLabel(compLevel, compIndex),
                competition_index: compIndex,
                cpc: convertAmountToCpcCurrency(item.cpc ?? 0, cpcConversion),
                cpc_currency: CPC_OUTPUT_CURRENCY,
                cpc_original_currency: 'USD',
                cpc_to_thb_rate: cpcConversion?.rate,
                cpc_rate_as_of: cpcConversion?.rateAsOf,
                cpc_rate_source: cpcConversion?.rateSource,
                cpc_conversion_available: !!cpcConversion,
                source: 'dataforseo',
              });
            }
          }
        }
        break; // success
      } catch (err: any) {
        lastError = err.message;
        if (attempt <= MAX_RETRIES) {
          await new Promise(r => setTimeout(r, attempt * 1500));
        }
      }
    }

    if (lastError) {
      console.error(`[DataForSEO] chunk failed: ${lastError}`);
    }
    })); // end Promise.all wave
  } // end wave loop

  return resultMap;
}

export function hasDataForSeoCreds(): boolean {
  return !!(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
}

/**
 * Organic Keyword Difficulty from DataForSEO Labs.
 * Uses the same DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD credential flow as the
 * existing volume integration. No new key names or client-side exposure.
 */
export async function getDataForSeoKeywordDifficulty(
  keywords: string[],
  languageCode = 'th',
  locationCode = 2764
): Promise<DFSKeywordDifficultyResult> {
  const creds = getCredentials();
  const uniqueKeywords = [...new Set(keywords.map(keyword => keyword.trim()).filter(keyword => keyword.length >= 3))];
  if (!creds || uniqueKeywords.length === 0) {
    return { metrics: new Map(), costUsd: 0, calledKeywords: 0 };
  }

  const metrics = new Map<string, number>();
  const auth = makeBasicAuth(creds.login, creds.password);
  let costUsd = 0;
  const batches = chunk(uniqueKeywords, 1000);

  for (const keywordBatch of batches) {
    const response = await fetch(
      'https://api.dataforseo.com/v3/dataforseo_labs/google/bulk_keyword_difficulty/live',
      {
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([{
          keywords: keywordBatch,
          language_code: languageCode,
          location_code: locationCode,
        }]),
        signal: AbortSignal.timeout(45000),
      }
    );

    if (!response.ok) {
      throw new Error(`DataForSEO KD HTTP ${response.status}`);
    }
    const data = await response.json();
    if (data.status_code !== 20000) {
      throw new Error(data.status_message || `DataForSEO KD error ${data.status_code}`);
    }

    for (const task of data.tasks || []) {
      if (typeof task.cost === 'number') costUsd += task.cost;
      if (task.status_code !== 20000) continue;
      for (const result of task.result || []) {
        for (const item of result.items || []) {
          if (!item.keyword || typeof item.keyword_difficulty !== 'number') continue;
          metrics.set(item.keyword.toLowerCase().trim(), item.keyword_difficulty);
        }
      }
    }
  }

  return { metrics, costUsd, calledKeywords: uniqueKeywords.length };
}

export interface RankedKeyword {
  keyword: string;
  searchVolume: number | null;
  cpc: number | null;
  competition: string | null;
  rankAbsolute: number | null;
  rankGroup: number | null;
  url: string | null;
}

export interface RankedKeywordsResult {
  domain: string;
  keywords: RankedKeyword[];
  source: 'dfs_ranked_keywords';
  fetchedAt: string;
  hasCreds: boolean;
  note: string;
}

function normalizeDomainForRankedKeywords(domain: string): string {
  const raw = domain.trim();
  try {
    const withProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(withProtocol);
    return parsed.hostname.replace(/^www\./i, '');
  } catch {
    return raw;
  }
}

function toFiniteNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Ranked (organic) keywords a domain currently ranks for, from DataForSEO Labs.
 * Endpoint: POST /v3/dataforseo_labs/google/ranked_keywords/live
 * Reuses the same DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD credential flow and the
 * same Thailand location_code (2764) / language_code ('th') convention already
 * established in this file for getDataForSeoVolumes / getDataForSeoKeywordDifficulty.
 * Field names below are parsed defensively (full optional chaining, skip malformed
 * items) because they are UNVERIFIED against a live response in this environment —
 * verify against a live ranked_keywords response before production trust.
 */
export async function getRankedKeywordsForDomain(
  domain: string,
  opts?: { limit?: number; locationCode?: number; languageCode?: string }
): Promise<RankedKeywordsResult> {
  const fetchedAt = new Date().toISOString();
  const creds = getCredentials();
  if (!creds || !hasDataForSeoCreds()) {
    return {
      domain,
      keywords: [],
      source: 'dfs_ranked_keywords',
      fetchedAt,
      hasCreds: false,
      note: 'no DataForSEO credentials configured',
    };
  }

  const normalizedDomain = normalizeDomainForRankedKeywords(domain);
  const auth = makeBasicAuth(creds.login, creds.password);
  const languageCode = opts?.languageCode ?? 'th';
  const locationCode = opts?.locationCode ?? 2764; // Thailand
  const limit = opts?.limit ?? 200;

  try {
    const res = await fetch(
      'https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live',
      {
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([{
          target: normalizedDomain,
          language_code: languageCode,
          location_code: locationCode,
          limit,
          order_by: ['ranked_serp_element.serp_item.rank_group,asc'],
        }]),
        signal: AbortSignal.timeout(30000),
      }
    );

    if (!res.ok) {
      const message = `HTTP ${res.status}`;
      console.error(`[DataForSEO] ranked_keywords failed: ${message}`);
      return {
        domain: normalizedDomain,
        keywords: [],
        source: 'dfs_ranked_keywords',
        fetchedAt,
        hasCreds: true,
        note: `request failed: ${message}`,
      };
    }

    const json = await res.json();
    const items: any[] = json?.tasks?.[0]?.result?.[0]?.items ?? [];
    const keywords: RankedKeyword[] = [];

    for (const item of items) {
      const keyword = item?.keyword_data?.keyword ?? item?.keyword ?? null;
      if (!keyword) continue;

      const searchVolume = toFiniteNumberOrNull(
        item?.keyword_data?.keyword_info?.search_volume ?? item?.keyword_info?.search_volume ?? null
      );
      const cpc = toFiniteNumberOrNull(item?.keyword_data?.keyword_info?.cpc ?? null);
      const rawCompetition = item?.keyword_data?.keyword_info?.competition ?? null;
      const competition = rawCompetition === null || rawCompetition === undefined
        ? null
        : typeof rawCompetition === 'string' ? rawCompetition : String(rawCompetition);
      const serpItem = item?.ranked_serp_element?.serp_item ?? item?.serp_item ?? {};
      const rankAbsolute = toFiniteNumberOrNull(serpItem?.rank_absolute ?? null);
      const rankGroup = toFiniteNumberOrNull(serpItem?.rank_group ?? null);
      const url = serpItem?.url ?? serpItem?.relative_url ?? null;

      keywords.push({
        keyword,
        searchVolume,
        cpc,
        competition,
        rankAbsolute,
        rankGroup,
        url,
      });
    }

    return {
      domain: normalizedDomain,
      keywords,
      source: 'dfs_ranked_keywords',
      fetchedAt,
      hasCreds: true,
      note: 'field names parsed defensively; verify against a live ranked_keywords response before production trust',
    };
  } catch (err: any) {
    const message = err?.message ?? String(err);
    console.error(`[DataForSEO] ranked_keywords failed: ${message}`);
    return {
      domain: normalizedDomain,
      keywords: [],
      source: 'dfs_ranked_keywords',
      fetchedAt,
      hasCreds: true,
      note: `request failed: ${message}`,
    };
  }
}

export interface SerpResultItem {
  position: number;
  url: string;
  domain: string;
  title: string;
}

export interface SerpTopResult {
  keyword: string;
  results: SerpResultItem[];
  source: 'dfs_serp';
  fetchedAt: string;
  hasCreds: boolean;
  note: string;
}

function deriveDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

/**
 * Live SERP organic results for a keyword, from DataForSEO SERP API.
 * Endpoint: POST /v3/serp/google/organic/live/advanced
 * Reuses the same DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD credential flow and the
 * same Thailand location_code (2764) / language_code ('th') convention already
 * established in this file for getDataForSeoVolumes / getRankedKeywordsForDomain.
 * Field names below are parsed defensively (full optional chaining, skip malformed
 * items) because they are UNVERIFIED against a live response in this environment —
 * verify against a live serp/organic response before production trust.
 */
export async function getSerpTop(
  keyword: string,
  opts?: { depth?: number; locationCode?: number; languageCode?: string }
): Promise<SerpTopResult> {
  const fetchedAt = new Date().toISOString();
  const creds = getCredentials();
  if (!creds || !hasDataForSeoCreds()) {
    return {
      keyword,
      results: [],
      source: 'dfs_serp',
      fetchedAt,
      hasCreds: false,
      note: 'no DataForSEO credentials configured',
    };
  }

  const auth = makeBasicAuth(creds.login, creds.password);
  const languageCode = opts?.languageCode ?? 'th';
  const locationCode = opts?.locationCode ?? 2764; // Thailand
  const depth = opts?.depth ?? 10;

  try {
    const res = await fetch(
      'https://api.dataforseo.com/v3/serp/google/organic/live/advanced',
      {
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([{
          keyword,
          language_code: languageCode,
          location_code: locationCode,
          depth,
        }]),
        signal: AbortSignal.timeout(30000),
      }
    );

    if (!res.ok) {
      const message = `HTTP ${res.status}`;
      console.error(`[DataForSEO] serp failed: ${message}`);
      return {
        keyword,
        results: [],
        source: 'dfs_serp',
        fetchedAt,
        hasCreds: true,
        note: `request failed: ${message}`,
      };
    }

    const json = await res.json();
    const items: any[] = json?.tasks?.[0]?.result?.[0]?.items ?? [];
    const results: SerpResultItem[] = [];

    for (const item of items) {
      if (!(item?.type === 'organic' || item?.type === undefined)) continue;
      const url = item?.url ?? null;
      if (!url) continue;
      const position = item?.rank_absolute ?? item?.rank_group ?? null;
      if (position === null || position === undefined) continue;
      const domain = item?.domain ?? deriveDomainFromUrl(url);
      const title = item?.title ?? '';
      results.push({ position, url, domain, title });
    }

    results.sort((a, b) => a.position - b.position);

    return {
      keyword,
      results,
      source: 'dfs_serp',
      fetchedAt,
      hasCreds: true,
      note: 'field names parsed defensively; verify against a live serp/organic response before production trust',
    };
  } catch (err: any) {
    const message = err?.message ?? String(err);
    console.error(`[DataForSEO] serp failed: ${message}`);
    return {
      keyword,
      results: [],
      source: 'dfs_serp',
      fetchedAt,
      hasCreds: true,
      note: `request failed: ${message}`,
    };
  }
}
