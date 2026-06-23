/**
 * WordGod — DataForSEO Keyword Metrics Cache
 *
 * File-based cache per keyword. TTL varies by keyword type:
 *   money / commercial:   30 days
 *   evergreen info:       90 days
 *   legal/visa/health:    14 days
 *   trend/news:           3 days
 *   low priority (est):   90 days (stale-ok)
 *
 * Stored in .cache/dfs/ (gitignored).
 * Key: normalized keyword string → sha256 prefix.
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { DFSMetric } from '../services/dataForSeoService';

const CACHE_ROOT = process.env.VERCEL ? tmpdir() : join(process.cwd(), '.cache');
const CACHE_DIR = join(CACHE_ROOT, 'dfs');

export interface DFSCacheEntry {
  keyword: string;
  metric: DFSMetric;
  cached_at: string;       // ISO string
  ttl_days: number;
  keyword_type: string;
}

// ─── TTL by keyword type ───────────────────────────────────────────────────────

const TTL_MAP: Record<string, number> = {
  money:       30,
  commercial:  30,
  transactional: 30,
  price:       30,
  comparison:  60,
  review:      60,
  informational: 90,
  checklist:   90,
  problem:     60,
  question:    90,
  seed:        60,
  long_tail:   90,
  trend:        3,
  legal:       14,
  visa:        14,
  health:      14,
  finance:     14,
  default:     60,
};

export function getTTLDays(keyword_type: string, intent: string, keyword: string): number {
  const kw = keyword.toLowerCase();
  // Sensitive category override
  if (/วีซ่า|visa/.test(kw))     return TTL_MAP.visa;
  if (/ภาษี|กฎหมาย|law|tax/.test(kw)) return TTL_MAP.legal;
  if (/สุขภาพ|โรค|ยา|health/.test(kw)) return TTL_MAP.health;
  if (/ลงทุน|กองทุน|หุ้น|finance/.test(kw)) return TTL_MAP.finance;
  if (/เทรนด์|trend|ล่าสุด|2026|ใหม่/.test(kw)) return TTL_MAP.trend;
  return TTL_MAP[keyword_type] ?? TTL_MAP[intent] ?? TTL_MAP.default;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cacheKey(keyword: string): string {
  return createHash('sha256').update(keyword.trim().toLowerCase()).digest('hex').slice(0, 20);
}

function ensureDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export interface DFSCacheReadResult {
  hit: boolean;
  metric?: DFSMetric;
  age_days?: number;
  stale?: boolean;        // expired but usable for low-priority keywords
  entry?: DFSCacheEntry;
}

export function readDFSCache(keyword: string, keyword_type = 'default', intent = 'informational'): DFSCacheReadResult {
  try {
    ensureDir();
    const file = join(CACHE_DIR, `${cacheKey(keyword)}.json`);
    if (!existsSync(file)) return { hit: false };

    const entry: DFSCacheEntry = JSON.parse(readFileSync(file, 'utf-8'));
    const ageDays = (Date.now() - new Date(entry.cached_at).getTime()) / (1000 * 60 * 60 * 24);
    const ttl = getTTLDays(keyword_type, intent, keyword);
    const expired = ageDays > ttl;

    return {
      hit: true,
      metric: entry.metric,
      age_days: Math.round(ageDays),
      stale: expired,
      entry,
    };
  } catch {
    return { hit: false };
  }
}

// ─── Write ────────────────────────────────────────────────────────────────────

export function writeDFSCache(keyword: string, metric: DFSMetric, keyword_type = 'default', intent = 'informational') {
  try {
    ensureDir();
    const ttl_days = getTTLDays(keyword_type, intent, keyword);
    const entry: DFSCacheEntry = {
      keyword: keyword.trim().toLowerCase(),
      metric,
      cached_at: new Date().toISOString(),
      ttl_days,
      keyword_type,
    };
    writeFileSync(join(CACHE_DIR, `${cacheKey(keyword)}.json`), JSON.stringify(entry), 'utf-8');
  } catch {
    // Non-fatal
  }
}

// ─── Batch read ───────────────────────────────────────────────────────────────

export interface BatchCacheResult {
  cached: Map<string, DFSMetric>;    // fresh cache hits
  stale:  Map<string, DFSMetric>;    // expired but usable
  miss:   string[];                  // no cache at all
}

export function batchReadDFSCache(
  keywords: string[],
  keyword_type = 'default',
  intent = 'informational'
): BatchCacheResult {
  const cached = new Map<string, DFSMetric>();
  const stale  = new Map<string, DFSMetric>();
  const miss: string[] = [];

  for (const kw of keywords) {
    const r = readDFSCache(kw, keyword_type, intent);
    if (!r.hit || !r.metric) {
      miss.push(kw);
    } else if (r.stale) {
      stale.set(kw, r.metric);
    } else {
      cached.set(kw, r.metric);
    }
  }

  return { cached, stale, miss };
}
