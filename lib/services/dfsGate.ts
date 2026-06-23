/**
 * WordGod — DataForSEO Call Gate
 *
 * Controls WHEN to call DataForSEO.
 * Default behavior:
 *   1. Internal AEO analysis first (free)
 *   2. Cache check (free)
 *   3. DFS Labs only for keywords that pass the priority gate
 *   4. SERP API only for top-tier (not implemented yet — reserved)
 *
 * Never calls DFS for:
 *   - duplicates / low-priority / basic informational with no problem context
 *   - keywords with fresh cache
 *   - keywords under budget cap
 */

import { batchReadDFSCache, writeDFSCache, getTTLDays } from '../cache/dfsCache';
import type { DFSMetric } from './dataForSeoService';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GateCandidate {
  keyword: string;
  keyword_type: string;
  intent: string;
  // Scores already computed by internal analysis
  ai_search_priority_score?: number;
  sales_impact_score?: number;
  aeo_opportunity_score?: number;
  topic_cluster_role?: string;
  // Problem context
  has_customer_problem?: boolean;
}

export interface GateDecision {
  keyword: string;
  call_dfs: boolean;
  reason: string;
  use_stale?: boolean;        // use stale cache instead of calling
  representative?: string;    // representative keyword for this group
}

export interface GateResult {
  decisions: GateDecision[];
  to_call: string[];          // keywords to actually send to DFS
  from_cache: Map<string, DFSMetric>;
  stats: {
    total: number;
    cache_hits: number;
    stale_used: number;
    gate_passed: number;
    gate_blocked: number;
    estimated_cost_usd: number;
  };
}

// ─── Budget config ────────────────────────────────────────────────────────────

const DFS_COST_PER_KW = 0.0003;   // ~$0.0003 per keyword (Labs search volume)
const DEFAULT_BUDGET_USD = 0.50;   // $0.50 per pipeline run

// ─── Priority gate thresholds ─────────────────────────────────────────────────

const MIN_AI_SEARCH_SCORE  = 50;   // skip DFS if AI Search Priority < 50
const MIN_SALES_IMPACT     = 40;   // skip DFS if Sales Impact < 40
const MIN_AEO_SCORE        = 45;   // skip DFS if AEO Opportunity < 45

// Keyword types that always pass gate
const HIGH_VALUE_TYPES = new Set([
  'money', 'commercial', 'transactional', 'comparison', 'price', 'review',
]);

// Intent types that always pass gate
const HIGH_VALUE_INTENTS = new Set([
  'transactional', 'commercial', 'service_seeking', 'comparison', 'price', 'review', 'problem_solving',
]);

// Topic cluster roles that always pass gate
const HIGH_VALUE_ROLES = new Set([
  'parent_topic', 'money_page', 'pillar',
]);

// Basic informational — low value unless has problem context
const LOW_VALUE_TYPES = new Set(['question', 'seed', 'long_tail']);

// ─── Dedup / representative selection ────────────────────────────────────────
// Groups keywords by stripping common modifiers, keeps the most informative one.

function normalizeForGrouping(kw: string): string {
  return kw.toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/(ราคา|ค่าใช้จ่าย|วิธี|ขั้นตอน|คืออะไร|หมายถึง|ดีไหม|ดีมั้ย)$/, '')
    .trim();
}

export function selectRepresentatives(keywords: GateCandidate[]): Map<string, string> {
  // Returns: normalizedGroup → representative keyword
  const groupMap = new Map<string, GateCandidate[]>();

  for (const kw of keywords) {
    const group = normalizeForGrouping(kw.keyword);
    if (!groupMap.has(group)) groupMap.set(group, []);
    groupMap.get(group)!.push(kw);
  }

  const repMap = new Map<string, string>(); // keyword → representative
  for (const [, members] of groupMap.entries()) {
    // Pick representative: highest ai_search_priority_score, then longest keyword
    const rep = members.sort((a, b) => {
      const scoreA = a.ai_search_priority_score ?? 0;
      const scoreB = b.ai_search_priority_score ?? 0;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return b.keyword.length - a.keyword.length;
    })[0];

    for (const m of members) {
      repMap.set(m.keyword, rep.keyword);
    }
  }

  return repMap;
}

// ─── Gate evaluation ──────────────────────────────────────────────────────────

function shouldCallDFS(kw: GateCandidate): { pass: boolean; reason: string } {
  // Always pass: high-value type / intent / role
  if (HIGH_VALUE_TYPES.has(kw.keyword_type))  return { pass: true, reason: `high-value type: ${kw.keyword_type}` };
  if (HIGH_VALUE_INTENTS.has(kw.intent))      return { pass: true, reason: `high-value intent: ${kw.intent}` };
  if (kw.topic_cluster_role && HIGH_VALUE_ROLES.has(kw.topic_cluster_role)) {
    return { pass: true, reason: `cluster role: ${kw.topic_cluster_role}` };
  }

  // Pass: has customer problem + decent AEO score
  if (kw.has_customer_problem && (kw.aeo_opportunity_score ?? 0) >= MIN_AEO_SCORE) {
    return { pass: true, reason: 'customer problem + AEO opportunity' };
  }

  // Pass: high AI Search Priority Score
  if ((kw.ai_search_priority_score ?? 0) >= MIN_AI_SEARCH_SCORE) {
    return { pass: true, reason: `AI Search Priority Score: ${kw.ai_search_priority_score}` };
  }

  // Pass: high Sales Impact
  if ((kw.sales_impact_score ?? 0) >= MIN_SALES_IMPACT) {
    return { pass: true, reason: `Sales Impact: ${kw.sales_impact_score}` };
  }

  // Block: basic informational with no problem context
  if (LOW_VALUE_TYPES.has(kw.keyword_type) && !kw.has_customer_problem) {
    return { pass: false, reason: 'low-value type, no customer problem' };
  }

  // Block: low intent + no signals
  if (!HIGH_VALUE_INTENTS.has(kw.intent) &&
      (kw.ai_search_priority_score ?? 0) < MIN_AI_SEARCH_SCORE &&
      (kw.sales_impact_score ?? 0) < MIN_SALES_IMPACT) {
    return { pass: false, reason: 'low intent + low scores' };
  }

  return { pass: true, reason: 'passes default gate' };
}

// ─── Main gate function ───────────────────────────────────────────────────────

export function runDFSGate(
  candidates: GateCandidate[],
  budgetUsd = DEFAULT_BUDGET_USD
): GateResult {
  const decisions: GateDecision[] = [];
  const fromCache = new Map<string, DFSMetric>();

  // Step 1: Cache check for all candidates
  const kwTypes = candidates.reduce((m, c) => { m[c.keyword] = c; return m; }, {} as Record<string, GateCandidate>);
  const cacheResult = batchReadDFSCache(
    candidates.map(c => c.keyword),
    'default',
    'informational'
  );

  // Step 2: Collect from fresh cache immediately
  for (const [kw, metric] of cacheResult.cached.entries()) {
    fromCache.set(kw, metric);
    decisions.push({ keyword: kw, call_dfs: false, reason: 'fresh cache hit' });
  }

  // Step 3: Select representative for dedup
  // Only evaluate non-cache keywords
  const nonCached = candidates.filter(c =>
    !cacheResult.cached.has(c.keyword)
  );
  const repMap = selectRepresentatives(nonCached);

  // Step 4: For stale cache — use stale for low-priority, refresh for high-priority
  const toCallSet = new Set<string>();

  for (const kw of nonCached) {
    const isStale = cacheResult.stale.has(kw.keyword);
    const staleMetric = cacheResult.stale.get(kw.keyword);
    const rep = repMap.get(kw.keyword) ?? kw.keyword;
    const isRep = rep === kw.keyword;

    // Gate check
    const { pass, reason } = shouldCallDFS(kw);

    if (!pass) {
      // Use stale cache if available, otherwise skip DFS (use Gemini est)
      if (isStale && staleMetric) {
        fromCache.set(kw.keyword, staleMetric);
        decisions.push({ keyword: kw.keyword, call_dfs: false, reason: 'gate blocked — using stale cache', use_stale: true });
      } else {
        decisions.push({ keyword: kw.keyword, call_dfs: false, reason: `gate blocked: ${reason}` });
      }
      continue;
    }

    // Gate passed — only call DFS for the representative keyword
    if (!isRep) {
      // Non-representative: use stale or skip
      if (isStale && staleMetric) {
        fromCache.set(kw.keyword, staleMetric);
        decisions.push({ keyword: kw.keyword, call_dfs: false, reason: 'non-representative — using stale cache', use_stale: true, representative: rep });
      } else {
        decisions.push({ keyword: kw.keyword, call_dfs: false, reason: 'non-representative — will inherit from rep', representative: rep });
      }
      continue;
    }

    // Representative keyword — check budget
    const currentEstimatedCost = toCallSet.size * DFS_COST_PER_KW;
    if (currentEstimatedCost >= budgetUsd) {
      // Budget exceeded — use stale or skip
      if (isStale && staleMetric) {
        fromCache.set(kw.keyword, staleMetric);
        decisions.push({ keyword: kw.keyword, call_dfs: false, reason: 'budget cap — using stale cache', use_stale: true });
      } else {
        decisions.push({ keyword: kw.keyword, call_dfs: false, reason: 'budget cap reached' });
      }
      continue;
    }

    toCallSet.add(kw.keyword);
    decisions.push({ keyword: kw.keyword, call_dfs: true, reason });
  }

  // Step 5: After DFS returns, propagate rep volume to non-rep siblings (done in pipeline)

  const gateBlocked = decisions.filter(d => !d.call_dfs && !d.reason.includes('cache')).length;
  const cacheHits   = [...cacheResult.cached.keys()].length;
  const staleUsed   = decisions.filter(d => d.use_stale).length;

  return {
    decisions,
    to_call: [...toCallSet],
    from_cache: fromCache,
    stats: {
      total: candidates.length,
      cache_hits: cacheHits,
      stale_used: staleUsed,
      gate_passed: toCallSet.size,
      gate_blocked: gateBlocked,
      estimated_cost_usd: toCallSet.size * DFS_COST_PER_KW,
    },
  };
}

// ─── Post-call: write results to cache + propagate to siblings ────────────────

export function applyDFSResults(
  dfsMap: Map<string, DFSMetric>,
  decisions: GateDecision[],
  candidates: GateCandidate[]
): Map<string, DFSMetric> {
  // Write fresh results to cache
  const kwMeta = candidates.reduce((m, c) => { m[c.keyword] = c; return m; }, {} as Record<string, GateCandidate>);
  for (const [kw, metric] of dfsMap.entries()) {
    const meta = kwMeta[kw];
    writeDFSCache(kw, metric, meta?.keyword_type ?? 'default', meta?.intent ?? 'informational');
  }

  // Propagate rep results to siblings
  const result = new Map<string, DFSMetric>(dfsMap);
  for (const d of decisions) {
    if (!d.representative || result.has(d.keyword)) continue;
    const repMetric = dfsMap.get(d.representative);
    if (repMetric) result.set(d.keyword, repMetric);
  }

  return result;
}
