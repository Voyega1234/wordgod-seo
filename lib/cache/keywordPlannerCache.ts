/**
 * WordGod — Keyword Planner Cache
 *
 * File-based cache for Google Ads Keyword Planner results.
 * TTL: 30 days. Stored in .cache/ (gitignored).
 * Key: hash of seed_keywords + url + country + language + network.
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { KeywordPlannerRow, SkillInput } from '../skills/keyword-seo-title/types';

const CACHE_DIR = join(process.cwd(), '.cache', 'keyword-planner');
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface CacheEntry {
  rows: KeywordPlannerRow[];
  cached_at: string;
}

export function buildCacheKey(input: SkillInput, namespace = ''): string {
  const parts = [
    (input.seed_keywords || []).sort().join(','),
    input.website_url || '',
    input.target_country || 'Thailand',
    input.target_language || 'th',
    input.keyword_plan_network || 'GOOGLE_SEARCH',
    input.volume_source || '',
    namespace,
  ].join('|');
  return createHash('sha256').update(parts).digest('hex').slice(0, 16);
}

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

export function readKeywordPlannerCache(key: string): CacheEntry | null {
  try {
    ensureCacheDir();
    const file = join(CACHE_DIR, `${key}.json`);
    if (!existsSync(file)) return null;
    const entry: CacheEntry = JSON.parse(readFileSync(file, 'utf-8'));
    const age = Date.now() - new Date(entry.cached_at).getTime();
    if (age > TTL_MS) return null; // expired
    return entry;
  } catch {
    return null;
  }
}

export function writeKeywordPlannerCache(key: string, rows: KeywordPlannerRow[]) {
  try {
    ensureCacheDir();
    const entry: CacheEntry = { rows, cached_at: new Date().toISOString() };
    writeFileSync(join(CACHE_DIR, `${key}.json`), JSON.stringify(entry, null, 2), 'utf-8');
  } catch {
    // Non-fatal
  }
}
