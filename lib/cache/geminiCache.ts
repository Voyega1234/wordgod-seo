/**
 * WordGod — Gemini Keyword Expansion Cache
 *
 * File-based cache for expandWithGemini results.
 * TTL: 24 hours (keyword trends change daily).
 * Key: sha256 of (niche + sorted seeds + targetCount + intentRatio JSON + isKnowledgeMode).
 * Stored in .cache/gemini/ (gitignored).
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { IntentRatio } from '../skills/intentRatioSkill';

const CACHE_DIR = join(process.cwd(), '.cache', 'gemini');
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface GeminiCacheEntry {
  keywords: any[];
  cached_at: string;
  niche: string;
}

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

export function buildGeminiCacheKey(
  niche: string,
  seeds: string[],
  targetCount: number,
  intentRatio: IntentRatio,
  isKnowledgeMode: boolean
): string {
  const parts = [
    niche,
    [...seeds].sort().join(','),
    String(targetCount),
    JSON.stringify(intentRatio),
    String(isKnowledgeMode),
  ].join('|');
  return createHash('sha256').update(parts).digest('hex').slice(0, 16);
}

export function readGeminiCache(key: string): any[] | null {
  try {
    ensureCacheDir();
    const file = join(CACHE_DIR, `${key}.json`);
    if (!existsSync(file)) return null;
    const entry: GeminiCacheEntry = JSON.parse(readFileSync(file, 'utf-8'));
    const age = Date.now() - new Date(entry.cached_at).getTime();
    if (age > TTL_MS) return null; // expired
    return entry.keywords;
  } catch {
    return null;
  }
}

export function writeGeminiCache(key: string, keywords: any[], niche: string): void {
  try {
    ensureCacheDir();
    const entry: GeminiCacheEntry = {
      keywords,
      cached_at: new Date().toISOString(),
      niche,
    };
    writeFileSync(join(CACHE_DIR, `${key}.json`), JSON.stringify(entry, null, 2), 'utf-8');
  } catch {
    // Cache write failures are non-fatal
  }
}
