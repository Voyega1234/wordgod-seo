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

export interface DFSMetric {
  volume: number;
  competition: string;        // LOW | MEDIUM | HIGH | UNSPECIFIED
  competition_index: number;  // 0–100
  cpc: number;                // cost per click USD
  source: 'dataforseo';
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
  locationCode = 2764 // Thailand
): Promise<Map<string, DFSMetric>> {
  const creds = getCredentials();
  if (!creds) return new Map();

  const resultMap = new Map<string, DFSMetric>();
  const auth = makeBasicAuth(creds.login, creds.password);
  const chunks = chunk(keywords, TASKS_PER_REQUEST);

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
                cpc: item.cpc ?? 0,
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
