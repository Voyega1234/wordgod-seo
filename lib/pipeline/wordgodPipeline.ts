/**
 * WordGod — Unified Keyword + Title Pipeline
 *
 * Flow:
 *   1. Google Keyword Planner → real volume, competition, CPC per keyword
 *   2. Gemini grounding → expand & discover new keywords with volume signals
 *   3. Merge & deduplicate — Planner data takes priority over Gemini estimates
 *   4. SEO Title AI Skill → Gemini writes titles optimized for SEO + AEO + AI Search
 *   5. Score & rank → opportunity score formula
 *   6. Return enriched rows ready for CSV export
 *
 * Server-side only. All credentials stay in process.env.
 */

import { callGeminiWithGrounding, callGemini, resetSessionUsage, getSessionUsage } from '../gemini';
import type { GroundingMetadata } from '../gemini';
import { buildGeminiCacheKey, readGeminiCache, writeGeminiCache } from '../cache/geminiCache';
import { extractCompetitorKeywords } from '../skills/competitorUrlSkill';
import { buildSeoTitleAiPrompt } from '../skills/seoTitleAiSkill';
import type { TitleRequest, TitleAiResult } from '../skills/seoTitleAiSkill';
import { KEYWORD_RESEARCH_PROMPT } from '../skills/keywordResearchSkill';
import { clusterKeywords } from '../skills/topicClusterSkill';
import type { ClusterResult } from '../skills/topicClusterSkill';
import { DEFAULT_RATIO as DEFAULT_INTENT_RATIO } from '../skills/intentRatioSkill';
import type { IntentRatio } from '../skills/intentRatioSkill';
import {
  runCustomerProblemDiscoveryEngine,
  runProblemToKeywordExpander,
  runArticleGroupingDecisionEngine,
  classifyJourneyStage,
  classifyAISearchRisk,
  computeSalesImpactScore,
  computeBuyerIntentScore,
  computeVolumeScore,
  computePriorityScore,
  computeKnowledgeImpactScore,
  computeIntentBucketScore,
  computeKeywordDepthScore,
  computeInternalLinkOpportunityScore,
  computeCustomerPainUrgencyScore,
  suggestAnchorText,
  validateKeywordResearchQA,
  buildProblemFirstTitlePrompt,
} from '../skills/problemFirstSkill';
import type { DiscoveredProblem, ArticleGroupDecision, AllScores, IntentBucket } from '../skills/problemFirstSkill';
import { detectTopicClusterRole } from '../skills/keywordResearchSkill';
import type { TopicClusterRole } from '../skills/keywordResearchSkill';
import { enrichWithAEO } from '../skills/aeoSkill';
import type { AEOFields } from '../skills/aeoSkill';
import { scoreCompetitorGap } from '../skills/competitorGapSkill';
import { detectTrendSignal } from '../skills/trendSkill';
import type { TrendType } from '../skills/trendSkill';

export type { IntentRatio };
export { DEFAULT_INTENT_RATIO };

// ─── Types ─────────────────────────────────────────────────────────────────────

export type JourneyStage = 'pre_purchase' | 'during_use' | 'result_interpretation' | 'caregiver' | 'post_purchase' | 'general_education';
export type StrategyMode = 'volume_first' | 'problem_first' | 'hybrid';
export type WebsiteType = 'ecommerce' | 'service' | 'knowledge';
export type AISearchRisk = 'high' | 'medium' | 'low';

export interface PipelineInput {
  seeds: string[];               // seed keywords from CSV/user input
  niche: string;                 // e.g. "Beauty & Personal Care"
  businessContext: string;       // e.g. "Co Journey Visa — visa agency"
  category: string;
  targetLanguage?: string;       // 'th' | 'en' (default: 'th')
  targetCount: number;           // total keywords to produce
  intentRatio?: IntentRatio;     // default: DEFAULT_INTENT_RATIO
  presetKey?: string;            // e.g. 'preset6' for knowledge mode
  excludeKeywords?: string[];    // keywords to never return
  useKeywordPlanner?: boolean;   // default: true if credentials exist
  forceRefresh?: boolean;
  onProgress?: (msg: string) => void;
  signal?: AbortSignal;
  // Problem-First Layer
  product_or_service?: string;
  target_customer?: string;
  customer_problems?: string[];
  pain_points?: string[];
  real_customer_questions?: string[];
  faq_from_sales_team?: string[];
  faq_from_customer_service?: string[];
  journey_stages?: JourneyStage[];
  strategy_mode?: StrategyMode;
  ai_search_optimization?: boolean;
  website_type?: WebsiteType;
  // Step 0.1 — optional site context from sitemap crawl
  site_url?: string;
  site_context_summary?: string;   // pre-built summary from /api/crawl-site
  site_categories?: string[];      // top category slugs from sitemap
}

export interface PipelineKeyword {
  keyword: string;
  volume: number;                // real (from Planner) or estimated (from Gemini)
  volume_source: 'keyword_planner' | 'planner_variant' | 'dataforseo' | 'gemini_estimated';
  volume_proxy_keyword?: string;  // shortened keyword used as volume proxy (planner_variant only)
  competition: string;           // LOW | MEDIUM | HIGH | UNSPECIFIED
  competition_index: number;     // 0–100
  intent: string;
  keyword_type: string;
  content_type: string;
  opportunity_score: number;
  priority: 'high' | 'medium' | 'low';
  title: string;
  aeo_question: string;
  seo_score: number;
  aeo_score: number;
  ai_search_score: number;
  ctr_score: number;
  title_notes: string;
  // Problem-First + Intent-Bucket Layer (always populated after Step 3b)
  journey_stage?: JourneyStage;
  problem_group?: string;
  original_problem?: string;
  customer_problem?: string;       // from Gemini keyword output (Gap-Fill Area 7)
  ai_search_risk?: AISearchRisk;
  ai_resilience_score?: number;
  sales_impact_score?: number;
  buyer_intent_score?: number;
  knowledge_impact_score?: number;
  customer_pain_urgency_score?: number;  // Gap-Fill Area 6/7 (distinct from problem_urgency_score)
  problem_urgency_score?: number;
  keyword_depth_score?: number;          // Gap-Fill Area 6/7
  internal_link_opportunity_score?: number; // Gap-Fill Area 8
  suggested_anchor_text?: string;        // Gap-Fill Area 8
  money_page_opportunity?: boolean;      // Gap-Fill Area 7 (from Gemini or rule-based)
  topic_cluster_role?: TopicClusterRole; // Gap-Fill Area 7/9
  keyword_group?: string;                // Gap-Fill Area 7 (alias / display label)
  parent_topic?: string;                 // Gap-Fill Area 9
  merge_with?: string;                   // Gap-Fill Area 3/7
  split_reason?: string;                 // Gap-Fill Area 3/7
  qa_passes?: boolean;                   // Gap-Fill Area 10
  qa_warnings?: string[];                // Gap-Fill Area 10
  priority_score?: number;         // global strategy-mode score
  intent_bucket_score?: number;    // intent-specific intra-bucket score
  intent_mix_preset?: string;      // the preset key used for allocation
  // Short-tail parent reference — shows which KP keyword this long-tail was derived from
  seed_keyword?: string;           // the short-tail keyword from Planner (KP)
  seed_volume?: number;            // real KP volume of the short-tail parent
  // AEO / AI Search / GEO layer (Step 3b supplement)
  aeo_opportunity?: AEOFields['aeo_opportunity'];
  aeo_opportunity_score?: number;
  ai_overview_risk?: AEOFields['ai_overview_risk'];
  ai_overview_risk_score?: number;
  geo_opportunity?: AEOFields['geo_opportunity'];
  geo_opportunity_score?: number;
  direct_answer_potential?: boolean;
  featured_snippet_potential?: boolean;
  people_also_ask_potential?: boolean;
  conversational_query_potential?: boolean;
  entity_based_query?: boolean;
  question_pattern?: AEOFields['question_pattern'];
  answer_format_recommendation?: AEOFields['answer_format_recommendation'];
  ai_search_priority_score?: number;
  ai_search_priority_level?: AEOFields['ai_search_priority_level'];
  ai_search_notes?: string;
  article_group?: string;
  merge_or_split?: 'merge' | 'split' | 'standalone';
  primary_keyword?: string;
  secondary_keywords?: string[];
  internal_link_target?: string;
  next_topic_ideas?: string[];
  notes?: string;
  // Competitor Gap (Task 5)
  gap_score?: number;
  gap_level?: 'high' | 'medium' | 'low';
  gap_reasons?: string[];
  // Trend / Seasonal (Task 6)
  trend_type?: TrendType;
  trend_score?: number;
  refresh_priority?: 'urgent' | 'regular' | 'low';
  content_notes?: string;
}

export interface PipelineResult {
  keywords: PipelineKeyword[];
  clusters: ClusterResult;
  meta: {
    total: number;
    planner_count: number;
    dataforseo_count: number;
    gemini_count: number;
    title_ai_count: number;
    fallback_title_count: number;
    cluster_count: number;
    warnings: string[];
    generated_at: string;
    strategy_mode?: StrategyMode;
    problem_keywords_count?: number;
    grounding_queries?: string[];     // hidden queries Gemini fired at Google Search
    grounding_urls?: string[];        // competitor URLs Gemini cited
    cost: {
      // Gemini (AI)
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      gemini_cost_usd: number;
      gemini_cost_thb: number;
      // DataForSEO
      dfs_keywords_called: number;
      dfs_cost_usd: number;
      dfs_cost_thb: number;
      // Google Keyword Planner (free — $0)
      kp_keywords_fetched: number;
      kp_cost_usd: number;
      kp_cost_thb: number;
      // Legacy alias kept for compatibility
      cost_usd: number;
      cost_thb: number;
      // Grand total
      total_cost_usd: number;
      total_cost_thb: number;
    };
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function normalize(kw: string) {
  const s = kw.trim().toLowerCase().replace(/\s+/g, ' ');
  // KP often inserts spaces between Thai syllables (e.g. "ประกัน เดินทาง").
  // Strip spaces between Thai character sequences so both forms hash identically.
  return s.replace(/([฀-๿]+) +([฀-๿])/g, '$1$2')
          .replace(/([฀-๿]+) +([฀-๿])/g, '$1$2'); // second pass for ≥3-word clusters
}

function classifyIntent(keyword: string): string {
  const kw = keyword.toLowerCase();
  if (/ราคา|ค่า|เท่าไร/.test(kw)) return 'price';
  if (/เปรียบเทียบ|vs\.|ดีกว่า|ต่างกัน|ไหนดี/.test(kw)) return 'comparison';
  if (/รีวิว|review|ดีไหม/.test(kw)) return 'review';
  if (/ซื้อ|สั่ง|จอง/.test(kw)) return 'transactional';
  if (/บริการ|รับจัด|agency/.test(kw)) return 'service_seeking';
  if (/แก้|รักษา|ป้องกัน|วิธีแก้|ปัญหา/.test(kw)) return 'problem_solving';
  if (/วิธีเลือก|ก่อนซื้อ|แนะนำ|ควรรู้/.test(kw)) return 'commercial';
  if (/เช็คลิสต์|checklist|รายการ/.test(kw)) return 'checklist';
  if (/คืออะไร|หมายถึง|คือ|ทำไม|วิธี/.test(kw)) return 'informational';
  return 'informational';
}

function classifyKeywordType(keyword: string): string {
  const kw = keyword.toLowerCase();
  const words = kw.trim().split(/\s+/);
  if (/เปรียบเทียบ|vs\./.test(kw)) return 'comparison';
  if (/ราคา|เท่าไร/.test(kw)) return 'price';
  if (/รีวิว/.test(kw)) return 'review';
  if (/ซื้อ|สั่ง/.test(kw)) return 'transactional';
  if (/ปัญหา|แก้|รักษา/.test(kw)) return 'problem';
  if (/คืออะไร|ทำไม/.test(kw)) return 'question';
  if (/แนะนำ|ก่อนซื้อ|วิธีเลือก/.test(kw)) return 'commercial';
  if (words.length >= 4) return 'long_tail';
  if (words.length === 1) return 'seed';
  return 'supporting_keyword';
}

function resolveContentType(intent: string): string {
  const map: Record<string, string> = {
    informational: 'pillar_article',
    commercial: 'buying_guide',
    transactional: 'product_page',
    problem_solving: 'problem_solution_article',
    comparison: 'comparison_article',
    price: 'price_guide',
    checklist: 'checklist_article',
    review: 'review_article',
    service_seeking: 'service_page',
    local: 'local_seo_page',
  };
  return map[intent] || 'article';
}

function computeOpportunity(
  volume: number,
  intent: string,
  keyword_type: string,
  keyword: string
): { score: number; priority: 'high' | 'medium' | 'low' } {
  const volScore =
    volume >= 100000 ? 10 : volume >= 50000 ? 9 : volume >= 20000 ? 8 :
    volume >= 10000 ? 7 : volume >= 5000 ? 6 : volume >= 1000 ? 5 :
    volume >= 500 ? 4 : volume >= 100 ? 3 : volume > 0 ? 2 : 1;

  const intentVal: Record<string, number> = {
    transactional: 10, commercial: 9, service_seeking: 8, price: 8,
    comparison: 7, review: 7, problem_solving: 6, local: 6,
    checklist: 5, informational: 5, navigational: 4,
  };
  const typeVal: Record<string, number> = {
    money_keyword: 10, commercial: 9, transactional: 9, comparison: 8,
    price: 8, review: 7, long_tail: 7, problem: 7, question: 6,
    checklist: 6, seed: 6, supporting_keyword: 5, local: 5, seasonal: 4, brand: 4,
  };

  const words = keyword.trim().split(/\s+/).length;
  const gap = words >= 4 ? 9 : words >= 3 ? 7 : words >= 2 ? 5 : 3;
  const diff = words === 1 ? 15 : words === 2 ? 8 : words === 3 ? 4 : 0;

  // Competition proxy: shorter keywords = harder to rank (higher difficulty penalty)
  const compVal = words === 1 ? 2 : words === 2 ? 5 : words === 3 ? 7 : 9;

  const raw =
    volScore * 10 * 0.30 +
    (intentVal[intent] ?? 5) * 10 * 0.25 +
    compVal * 10 * 0.20 +
    (typeVal[keyword_type] ?? 5) * 10 * 0.15 +
    gap * 10 * 0.10 - diff;

  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const priority: 'high' | 'medium' | 'low' = score >= 80 ? 'high' : score >= 60 ? 'medium' : 'low';
  return { score, priority };
}

// Strip search operators injected by DataForSEO/KP (e.g. site:pantip.com, "quoted" operators)
// so they don't contaminate AI-generated titles
function cleanKeywordForTitle(kw: string): string {
  return kw
    .replace(/\bsite:[^\s]+/gi, '')
    .replace(/\bintitle:[^\s]+/gi, '')
    .replace(/\binurl:[^\s]+/gi, '')
    .replace(/\bfiletype:[^\s]+/gi, '')
    .replace(/^"|"$/g, '')       // strip surrounding quotes
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Dynamic title batch size: larger batches = fewer API calls = lower cost at scale
// 1–50 kw → 25/batch, 51–500 → 50/batch, 501–3000 → 100/batch
function getTitleBatchSize(total: number): number {
  if (total <= 50) return 25;
  if (total <= 500) return 50;
  return 100;
}

// ─── Intent Bucket Mapping ────────────────────────────────────────────────────

function mapIntentToBucket(intent: string): IntentBucket {
  if (['commercial', 'comparison', 'review'].includes(intent)) return 'commercial';
  if (['transactional', 'service_seeking', 'price'].includes(intent)) return 'transactional';
  if (['navigational', 'brand'].includes(intent)) return 'navigational';
  if (['update', 'news', 'freshness'].includes(intent)) return 'update';
  return 'informational';
}

// ─── Intent Bucket Allocation ─────────────────────────────────────────────────
// Groups keywords by intent bucket, scores within each bucket using intent-
// specific formula, selects top-N per bucket based on IntentRatio allocation,
// then recombines into final ordered list.

function keywordTier(kw: PipelineKeyword): number {
  const hasProblem = !!(kw.original_problem || kw.customer_problem || kw.problem_group);
  const hasVolume = kw.volume > 0;
  if (hasProblem && hasVolume) return 1;  // best: problem + volume
  if (hasVolume) return 2;                 // good: volume only
  if (hasProblem) return 3;               // fallback: problem, no volume
  return 4;                               // last: neither
}

function fixedPrioritySort(a: PipelineKeyword, b: PipelineKeyword): number {
  const tierDiff = keywordTier(a) - keywordTier(b);
  if (tierDiff !== 0) return tierDiff;
  // Within same tier: intent_bucket_score desc (bucket-specific quality)
  return (b.intent_bucket_score ?? 0) - (a.intent_bucket_score ?? 0);
}

function applyIntentBucketAllocation(
  keywords: Array<PipelineKeyword & { intent_bucket_score?: number }>,
  intentRatio: IntentRatio,
  presetKey: string,
  totalTarget: number
): PipelineKeyword[] {
  // Step A: Tag preset + knowledge score (bucket score already computed in Step 3b)
  for (const kw of keywords) {
    kw.intent_mix_preset = presetKey;
    const bucket = mapIntentToBucket(kw.intent);
    if (bucket === 'informational' && !kw.knowledge_impact_score) {
      kw.knowledge_impact_score = computeKnowledgeImpactScore(kw.keyword, kw.intent);
    }
    // Fallback: if Step 3b didn't run yet (e.g. partial abort), compute now
    if (!kw.intent_bucket_score) {
      const base = {
        volume_score: computeVolumeScore(kw.volume),
        ai_resilience_score: kw.ai_resilience_score ?? 50,
        sales_impact_score: kw.sales_impact_score ?? 40,
        buyer_intent_score: kw.buyer_intent_score ?? 40,
      };
      kw.intent_bucket_score = computeIntentBucketScore(kw.keyword, kw.intent, bucket, base);
    }
  }

  // Step B: Group by bucket
  const buckets: Record<IntentBucket, Array<PipelineKeyword & { intent_bucket_score?: number }>> = {
    informational: [],
    commercial: [],
    transactional: [],
    navigational: [],
    update: [],
  };
  for (const kw of keywords) {
    const b = mapIntentToBucket(kw.intent);
    buckets[b].push(kw);
  }

  // Step C: Sort within each bucket by intent_bucket_score desc
  for (const b of Object.keys(buckets) as IntentBucket[]) {
    buckets[b].sort((a, b2) => (b2.intent_bucket_score ?? 0) - (a.intent_bucket_score ?? 0));
  }

  // Step D: Calculate how many to take from each bucket
  const bucketKeys: IntentBucket[] = ['informational', 'commercial', 'transactional', 'navigational', 'update'];
  const ratioMap: Record<IntentBucket, number> = {
    informational: intentRatio.informational,
    commercial: intentRatio.commercial,
    transactional: intentRatio.transactional,
    navigational: intentRatio.navigational,
    update: intentRatio.update,
  };

  let allocated = 0;
  const quotas: Record<IntentBucket, number> = {} as any;
  const activeBuckets = bucketKeys.filter(b => ratioMap[b] > 0);

  for (let i = 0; i < activeBuckets.length; i++) {
    const b = activeBuckets[i];
    if (i === activeBuckets.length - 1) {
      quotas[b] = totalTarget - allocated;
    } else {
      quotas[b] = Math.round(totalTarget * ratioMap[b] / 100);
      allocated += quotas[b];
    }
  }
  for (const b of bucketKeys) {
    if (!quotas[b]) quotas[b] = 0;
  }

  // Step E: Select top-N from each bucket, collect remainder
  const selected: PipelineKeyword[] = [];
  const remainder: PipelineKeyword[] = [];

  for (const b of bucketKeys) {
    const quota = quotas[b];
    const pool = buckets[b];
    selected.push(...pool.slice(0, quota));
    remainder.push(...pool.slice(quota));
  }

  // Step F: Fill remaining slots from remainder if needed
  if (selected.length < totalTarget) {
    // Remainder sorted by same fixed priority below
    remainder.sort(fixedPrioritySort);
    selected.push(...remainder.slice(0, totalTarget - selected.length));
  }

  // Step G: Fixed ranking — no user-selectable strategy.
  // Tier 1: problem keyword + has real volume  (original_problem set AND volume > 0)
  // Tier 2: any keyword with real volume       (volume > 0, no problem context needed)
  // Tier 3: problem keyword without volume     (original_problem set, volume = 0)
  // Within each tier: sort by intent_bucket_score desc (intent-specific quality signal)
  selected.sort(fixedPrioritySort);

  return selected;
}

// ─── Step 1: Google Keyword Planner ───────────────────────────────────────────

async function fetchPlannerVolumes(
  seeds: string[],
  input: PipelineInput
): Promise<Map<string, { volume: number; competition: string; competition_index: number; source?: string }>> {
  const map = new Map<string, any>();
  try {
    const { getKeywordPlannerRows } = await import('../services/googleKeywordPlannerService');
    const result = await getKeywordPlannerRows({
      seed_keywords: seeds.map(s => s.trim()).filter(Boolean),
      target_country: 'Thailand',
      target_language: input.targetLanguage || 'th',
      volume_source: 'google_keyword_planner_api',
      force_refresh: input.forceRefresh,
    } as any);
    if (result.success) {
      for (const row of result.rows) {
        map.set(normalize(row.keyword), {
          volume: row.volume,
          competition: row.competition,
          competition_index: row.competition_index,
        });
      }
    }
  } catch (err: any) {
    // Log the real error so we can diagnose — fall back to Gemini estimates
    console.error('[KP] fetchPlannerVolumes error:', err?.message ?? err);
  }
  return map;
}


// ─── Step 2: Gemini keyword expansion ─────────────────────────────────────────

interface GeminiExpandResult {
  keywords: Array<{ keyword: string; volume_estimate: number; competition: string; intent: string; keyword_type: string; content_type: string; journey_stage?: string; topic_cluster_role?: string; customer_problem?: string; money_page_opportunity?: boolean }>;
  groundingQueries: string[];   // webSearchQueries harvested from Gemini grounding
  groundingUrls: string[];      // competitor URLs cited by Gemini
}

async function expandWithGemini(
  seeds: string[],
  niche: string,
  targetCount: number,
  excludeSet: Set<string>,
  onProgress: (msg: string) => void,
  intentRatio: IntentRatio = DEFAULT_INTENT_RATIO,
  isKnowledgeMode = false,
  problemContext?: {
    customerProblems?: string[];
    painPoints?: string[];
    realCustomerQuestions?: string[];
    faqFromSalesTeam?: string[];
  },
  siteContextSummary?: string,
  siteCategories?: string[],
  cacheKey?: string
): Promise<GeminiExpandResult> {
  // ── Cache check ───────────────────────────────────────────────────────────────
  if (cacheKey) {
    const cached = readGeminiCache(cacheKey);
    if (cached) {
      onProgress(`WordGod: using cached Gemini result (${cached.length} keywords)`);
      for (const kw of cached) {
        if (kw?.keyword) excludeSet.add(normalize(kw.keyword));
      }
      // Cache doesn't store grounding metadata — return empty (will re-harvest next non-cached run)
      return { keywords: cached, groundingQueries: [], groundingUrls: [] };
    }
  }

  // Dynamic batch/parallel scaling:
  // Small runs (≤100): small batches, low concurrency to avoid rate limits
  // Mid runs (≤500): standard 50-kw batches, 5 parallel
  // Large runs (≤3000): 100-kw batches, 8 parallel for throughput
  const BATCH = targetCount <= 100 ? 25 : targetCount <= 500 ? 50 : 100;
  const PARALLEL = targetCount <= 100 ? 3 : targetCount <= 500 ? 5 : 8;
  const totalBatches = Math.ceil(targetCount / BATCH);
  const allResults: any[][] = new Array(totalBatches).fill(null);
  const allGroundingQueries: string[] = [];
  const allGroundingUrls: string[] = [];

  onProgress(`WordGod: running ${totalBatches} keyword batches (${PARALLEL} parallel, ${BATCH}/batch)...`);

  // Run in parallel waves
  for (let wave = 0; wave < totalBatches; wave += PARALLEL) {
    const waveIndexes = Array.from({ length: Math.min(PARALLEL, totalBatches - wave) }, (_, i) => wave + i);
    const alreadyFound = allResults.flat().filter(Boolean).map((k: any) => k.keyword);

    await Promise.all(waveIndexes.map(async (bi) => {
      const need = bi === totalBatches - 1
        ? targetCount - bi * BATCH
        : BATCH;
      try {
        const siteSection = siteContextSummary
          ? `\n### WEBSITE CONTEXT (use this to keep keywords on-theme)\n${siteContextSummary}${siteCategories?.length ? `\n\nExisting site categories: ${siteCategories.join(', ')} — match keywords to these topics where possible` : ''}\n`
          : '';
        const prompt = KEYWORD_RESEARCH_PROMPT(niche, seeds[0], need, [...excludeSet], alreadyFound, intentRatio, isKnowledgeMode, problemContext) + siteSection;
        const { data, grounding } = await callGeminiWithGrounding(prompt, true);
        const FORUM_FILTER = /\b(pantip|sanook|wongnai|reddit|quora|twitter|facebook|youtube|tiktok|blockdit|medium)\b/i;
        allResults[bi] = (data.keywords || []).filter((k: any) => !FORUM_FILTER.test(k.keyword || ''));
        // Collect grounding metadata from every batch
        for (const q of grounding.webSearchQueries) {
          if (!allGroundingQueries.includes(q)) allGroundingQueries.push(q);
        }
        for (const u of grounding.sourceUrls) {
          if (!allGroundingUrls.includes(u)) allGroundingUrls.push(u);
        }
        onProgress(`WordGod batch ${bi + 1}/${totalBatches}: ${allResults[bi].length} keywords`);
      } catch (err: any) {
        onProgress(`WordGod batch ${bi + 1} error: ${err.message}`);
        allResults[bi] = [];
      }
    }));
  }

  // Merge, deduplicate, classify
  // Build seed brand set for navigational filter — only keep brand navigational
  // keywords if they match one of the user-supplied seed brands.
  const seedBrands = new Set(
    seeds.map(s => s.toLowerCase().replace(/\s+/g, ''))
  );

  const collected: any[] = [];
  let navFiltered = 0;
  for (const batch of allResults) {
    for (const kw of (batch || [])) {
      if (!kw?.keyword) continue;
      const norm = normalize(kw.keyword);
      if (excludeSet.has(norm) || collected.length >= targetCount) continue;

      const intent = kw.intent ? kw.intent.toLowerCase() : classifyIntent(kw.keyword);

      // Filter navigational keywords that reference competitor brands or third-party sites.
      // Block third-party forum/aggregator keywords regardless of intent —
      // these are impossible to rank for and pollute the keyword list.
      const FORUM_SITES = /\b(pantip|sanook|wongnai|reddit|quora|twitter|facebook|youtube|tiktok|blockdit|medium)\b/i;
      if (FORUM_SITES.test(kw.keyword)) {
        navFiltered++;
        continue;
      }

      // Block navigational keywords pointing to competitor brands (any intent).
      if (intent === 'navigational') {
        const kwLower = kw.keyword.toLowerCase();
        const kwNorm = norm.replace(/\s+/g, '');
        // Known third-party brand signals: insurer names, review sites, aggregators
        const thirdPartySignals = /\b(msig|axa|allianz|fwd|aia|aig|chubb|muang thai|เมืองไทย|อาคเนย์|วิริยะ|ทิพย|ไทยประกัน|คุ้มภัย|กรุงไทย|กรุงเทพ|นวกิจ|sanook|rabbit|the standard)\b/i;
        const hasThirdParty = thirdPartySignals.test(kwLower);
        const matchesSeedBrand = [...seedBrands].some(b => kwNorm.includes(b) || b.includes(kwNorm));
        if (hasThirdParty && !matchesSeedBrand) {
          navFiltered++;
          continue;
        }
      }

      excludeSet.add(norm);
      const keyword_type = classifyKeywordType(kw.keyword);
      collected.push({
        keyword: kw.keyword,
        volume_estimate: kw.volume_estimate || 0,
        competition: kw.competition || 'UNSPECIFIED',
        intent,
        keyword_type,
        content_type: resolveContentType(intent),
        journey_stage: kw.journey_stage,
        topic_cluster_role: kw.topic_cluster_role,
        customer_problem: kw.customer_problem,
        money_page_opportunity: kw.money_page_opportunity ?? false,
      });
    }
  }
  if (navFiltered > 0) {
    onProgress(`WordGod: filtered ${navFiltered} competitor-brand navigational keywords`);
  }

  onProgress(`WordGod: collected ${collected.length} unique keywords`);
  if (allGroundingQueries.length > 0) {
    onProgress(`WordGod: harvested ${allGroundingQueries.length} hidden queries + ${allGroundingUrls.length} competitor URLs from grounding`);
  }

  // ── Cache write ───────────────────────────────────────────────────────────────
  if (cacheKey && collected.length > 0) {
    writeGeminiCache(cacheKey, collected, niche);
  }

  return { keywords: collected, groundingQueries: allGroundingQueries, groundingUrls: allGroundingUrls };
}

// ─── Step 3: Merge Planner + Gemini ───────────────────────────────────────────

function findSeedParent(
  keyword: string,
  seedVolumeMap: Map<string, number>
): { seed_keyword: string; seed_volume: number } | null {
  const kwNorm = normalize(keyword);
  const kwNoSpace = kwNorm.replace(/\s+/g, '');
  const kwWords = kwNorm.split(/\s+/);
  let bestMatch: { seed_keyword: string; seed_volume: number; score: number } | null = null;

  for (const [seed, vol] of seedVolumeMap.entries()) {
    const seedNorm = seed.replace(/\s+/g, ''); // strip spaces for Thai matching
    const seedWords = seed.split(/\s+/);

    // Check if all seed words appear in the keyword (space-insensitive for Thai)
    const allWordsMatch = seedWords.every(w => kwWords.includes(w));
    const substringMatch = kwNoSpace.includes(seedNorm) && seedNorm.length >= 4;

    if (allWordsMatch || substringMatch) {
      const score = seedNorm.length; // prefer longer matching seeds
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { seed_keyword: seed, seed_volume: vol, score };
      }
    }
  }
  return bestMatch ? { seed_keyword: bestMatch.seed_keyword, seed_volume: bestMatch.seed_volume } : null;
}

function mergeKeywords(
  geminiKeywords: any[],
  plannerMap: Map<string, any>,
  seedVolumeMap: Map<string, number> = new Map()
): Array<PipelineKeyword & { _title_pending: true }> {
  return geminiKeywords.map(gk => {
    const norm = normalize(gk.keyword);
    const planner = plannerMap.get(norm);
    const intent = gk.intent || classifyIntent(gk.keyword);
    const keyword_type = gk.keyword_type || classifyKeywordType(gk.keyword);

    // If Planner matched but returned 0, fall back to Gemini estimate so we don't show misleading zeroes
    const plannerVolume = planner?.volume ?? null;
    const geminiEstimate = gk.volume_estimate ?? 0;
    const volume = (plannerVolume !== null && plannerVolume > 0) ? plannerVolume : geminiEstimate;
    const competition = planner?.competition ?? gk.competition ?? 'UNSPECIFIED';
    const competition_index = planner?.competition_index ?? 0;
    // plannerDirectPool keywords carry _volume_source preset — honour it over plannerMap lookup
    const volume_source: PipelineKeyword['volume_source'] =
      gk._volume_source ? gk._volume_source :
      (planner?.source === 'exact' && plannerVolume > 0) ? 'keyword_planner' :
      (planner?.source === 'close_variant' && plannerVolume > 0) ? 'planner_variant' :
      (planner?.source === 'dataforseo' && plannerVolume > 0) ? 'dataforseo' :
      'gemini_estimated';

    // Find short-tail KP parent so long-tail keywords show their volume context
    const seedParent = volume_source === 'gemini_estimated'
      ? findSeedParent(gk.keyword, seedVolumeMap)
      : null;

    const content_type = resolveContentType(intent);
    const { score, priority } = computeOpportunity(volume, intent, keyword_type, gk.keyword);

    return {
      keyword: gk.keyword,
      volume,
      volume_source,
      competition,
      competition_index,
      intent,
      keyword_type,
      content_type,
      opportunity_score: score,
      priority,
      // Short-tail parent reference (only for gemini_estimated keywords)
      seed_keyword: seedParent?.seed_keyword,
      seed_volume: seedParent?.seed_volume,
      // Volume proxy: original keyword used for volume when exact match failed
      volume_proxy_keyword: planner?.volume_proxy_keyword,
      // placeholders — filled by AI title step
      title: '',
      aeo_question: '',
      seo_score: 0,
      aeo_score: 0,
      ai_search_score: 0,
      ctr_score: 0,
      title_notes: '',
      // preserve problem-first + gap-fill metadata from expansion step
      journey_stage: gk.journey_stage,
      original_problem: gk.original_problem,
      problem_group: gk.problem_group,
      problem_urgency_score: gk.problem_urgency_score,
      customer_problem: gk.customer_problem,
      topic_cluster_role: gk.topic_cluster_role as TopicClusterRole | undefined,
      money_page_opportunity: gk.money_page_opportunity ?? false,
      _title_pending: true as const,
    };
  });
}

// ─── Step 4: AI Title Generation (batched) ────────────────────────────────────

async function generateAiTitles(
  keywords: PipelineKeyword[],
  businessContext: string,
  category: string,
  targetLanguage: string,
  onProgress: (msg: string) => void,
  aiSearchOptimization = false,
  warnings?: string[]
): Promise<Map<string, TitleAiResult>> {
  const resultMap = new Map<string, TitleAiResult>();
  const titleBatchSize = getTitleBatchSize(keywords.length);
  const batches: PipelineKeyword[][] = [];

  // Group by intent before batching — same-intent batch improves diversity
  // because Gemini sees the full range of styles needed within the intent group
  const byIntent = new Map<string, PipelineKeyword[]>();
  for (const kw of keywords) {
    const bucket = kw.intent || 'informational';
    if (!byIntent.has(bucket)) byIntent.set(bucket, []);
    byIntent.get(bucket)!.push(kw);
  }
  // Interleave intents so each batch gets mixed intents → forces style variety
  const ordered: PipelineKeyword[] = [];
  const intentQueues = [...byIntent.values()];
  let qi = 0;
  while (ordered.length < keywords.length) {
    for (const q of intentQueues) {
      if (qi < q.length) ordered.push(q[qi]);
    }
    qi++;
  }
  for (let i = 0; i < ordered.length; i += titleBatchSize) {
    batches.push(ordered.slice(i, i + titleBatchSize));
  }

  onProgress(`Title AI: writing ${keywords.length} titles in ${batches.length} parallel batches...`);

  let failedBatches = 0;

  await Promise.all(batches.map(async (batch, bi) => {
    const hasProblemContext = aiSearchOptimization && batch.some(kw => kw.journey_stage || kw.original_problem);

    let prompt: string;
    if (hasProblemContext) {
      const enrichedRequests = batch.map(kw => ({
        keyword: cleanKeywordForTitle(kw.keyword),
        volume: kw.volume,
        competition: kw.competition,
        intent: kw.intent,
        keyword_type: kw.keyword_type,
        content_type: kw.content_type,
        business_context: businessContext,
        category,
        journey_stage: kw.journey_stage,
        original_problem: kw.original_problem,
        ai_resilience_score: kw.ai_resilience_score,
      }));
      prompt = buildProblemFirstTitlePrompt(enrichedRequests, targetLanguage);
    } else {
      const requests: TitleRequest[] = batch.map(kw => ({
        keyword: cleanKeywordForTitle(kw.keyword),
        volume: kw.volume,
        competition: kw.competition,
        intent: kw.intent,
        keyword_type: kw.keyword_type,
        content_type: kw.content_type,
        business_context: businessContext,
        category,
      }));
      prompt = buildSeoTitleAiPrompt(requests, targetLanguage);
    }

    const BACKOFFS = [1000, 2000];
    let lastErr: any = null;
    let succeeded = false;

    for (let attempt = 0; attempt <= BACKOFFS.length; attempt++) {
      try {
        const result = await callGemini(prompt);
        const titles: TitleAiResult[] = result.titles || [];
        for (const t of titles) {
          if (t.keyword) resultMap.set(normalize(t.keyword), t);
        }
        onProgress(`Title batch ${bi + 1}/${batches.length}: ${titles.length} titles done`);
        succeeded = true;
        break;
      } catch (err: any) {
        lastErr = err;
        const isJsonError = /JSON|parse/i.test(err.message ?? '');
        if (isJsonError || attempt >= BACKOFFS.length) {
          // No retry for JSON parse errors or exhausted retries
          break;
        }
        const wait = BACKOFFS[attempt];
        onProgress(`Title batch ${bi + 1} retry ${attempt + 1}/2...`);
        await new Promise(r => setTimeout(r, wait));
      }
    }

    if (!succeeded) {
      onProgress(`Title batch ${bi + 1} error: ${lastErr?.message ?? 'unknown'}`);
      failedBatches++;
    }
  }));

  if (failedBatches > 0 && warnings) {
    warnings.push(`${failedBatches} title batch(es) failed after retries`);
  }

  return resultMap;
}

// ─── Step 5: Apply titles + score ─────────────────────────────────────────────

function applyTitles(
  keywords: PipelineKeyword[],
  titleMap: Map<string, TitleAiResult>
): { keywords: PipelineKeyword[]; fallbackCount: number } {
  let fallbackCount = 0;

  const FORBIDDEN = ['ดีที่สุด', 'อันดับ 1', '100%', 'การันตี', 'เห็นผลแน่นอน', 'ผ่านแน่นอน', 'รับประกัน'];
  const FORUM_IN_TITLE = /\b(pantip|sanook|wongnai|reddit|quora|twitter|facebook|youtube|tiktok|blockdit|medium)\b/i;

  const updated = keywords.map(kw => {
    const ai = titleMap.get(normalize(kw.keyword));
    const title = ai?.title || '';
    const isForbidden = FORBIDDEN.some(f => title.includes(f)) || FORUM_IN_TITLE.test(title);
    // Thai keywords have no spaces — check substring. English: check any word token.
    const kwLower = kw.keyword.toLowerCase();
    const titleLower = title.toLowerCase();
    const isThai = /[฀-๿]/.test(kw.keyword);
    const hasKeyword = isThai
      ? titleLower.includes(kwLower)
      : kw.keyword.split(/\s+/).some(w => w.length > 1 && titleLower.includes(w.toLowerCase()));

    if (ai && title && !isForbidden && hasKeyword) {
      return {
        ...kw,
        title,
        aeo_question: ai.aeo_question || `${cleanKeywordForTitle(kw.keyword)} คืออะไร และควรรู้อะไรบ้าง?`,
        seo_score: ai.seo_score || 0,
        aeo_score: ai.aeo_score || 0,
        ai_search_score: ai.ai_search_score || 0,
        ctr_score: ai.ctr_score || 0,
        title_notes: ai.notes || '',
      };
    } else {
      // Fallback: simple rule-based title
      fallbackCount++;
      const fallback = `${kw.keyword} คืออะไร? รวมข้อควรรู้ที่ควรเข้าใจก่อนเริ่มใช้`;
      return { ...kw, title: fallback, title_notes: 'fallback title' };
    }
  });

  return { keywords: updated, fallbackCount };
}

// ─── Main pipeline ─────────────────────────────────────────────────────────────

function makePartialResult(
  keywords: PipelineKeyword[],
  plannerCount: number,
  geminiCount: number,
  warnings: string[]
): PipelineResult {
  const geminiCost = getSessionUsage();
  const cost = {
    ...geminiCost,
    gemini_cost_usd: geminiCost.cost_usd,
    gemini_cost_thb: geminiCost.cost_thb,
    dfs_keywords_called: 0,
    dfs_cost_usd: 0,
    dfs_cost_thb: 0,
    kp_keywords_fetched: plannerCount,
    kp_cost_usd: 0,
    kp_cost_thb: 0,
    total_cost_usd: geminiCost.cost_usd,
    total_cost_thb: geminiCost.cost_thb,
  };
  return {
    keywords,
    clusters: { clusters: [], ungrouped: [] },
    meta: {
      total: keywords.length,
      planner_count: plannerCount,
      dataforseo_count: 0,
      gemini_count: geminiCount,
      title_ai_count: 0,
      fallback_title_count: 0,
      cluster_count: 0,
      warnings: [...warnings, 'Stopped early — showing partial results'],
      generated_at: new Date().toISOString(),
      cost,
    },
  };
}

export async function runWordGodPipeline(input: PipelineInput): Promise<PipelineResult> {
  resetSessionUsage();
  const log = input.onProgress || (() => {});
  const sig = input.signal;
  const warnings: string[] = [];
  const lang = input.targetLanguage || 'th';
  // Strategy is fixed — not user-selectable.
  // Ranking order: problem keywords with volume → volume keywords → problem keywords without volume.
  const strategyMode: StrategyMode = 'hybrid';
  const aiSearchOpt = input.ai_search_optimization !== false;
  const excludeSet = new Set<string>((input.excludeKeywords || []).map(normalize));
  // Capture user-supplied seeds before Step 0 expands them — used as short-tail KP anchors
  const userSuppliedSeeds = input.seeds.map(normalize);
  input.seeds.forEach(s => excludeSet.add(normalize(s)));

  const checkAbort = () => sig?.aborted ?? false;

  // ── Step 0.1: Site context — crawl-derived OR Gemini-suggested categories ──────
  // If user provided site_context_summary (from /api/crawl-site), use it directly.
  // If no URL was given, ask Gemini to suggest a realistic category structure from
  // the niche — same shape as sitemap categories so all downstream steps are identical.
  let resolvedSiteContextSummary = input.site_context_summary;
  let resolvedSiteCategories: string[] = (input.site_categories || []).map((c: any) =>
    typeof c === 'string' ? c : c.slug
  );

  if (!resolvedSiteContextSummary && !input.site_url) {
    log('[0.1/4] No site URL — asking WordGod AI to suggest content categories for this niche...');
    try {
      const { suggestCategoriesFromNiche } = await import('../services/siteContextService');
      const suggestedCats = await suggestCategoriesFromNiche(input.niche, input.businessContext, lang);
      if (suggestedCats.length > 0) {
        resolvedSiteCategories = suggestedCats.map(c => c.slug);
        resolvedSiteContextSummary = `Suggested content structure for "${input.niche}":\nCategories: ${suggestedCats.map(c => `${c.label} (${c.slug})`).join(', ')}`;
        log(`[0.1/4] AI suggested ${suggestedCats.length} content categories: ${resolvedSiteCategories.slice(0, 5).join(', ')}...`);
      }
    } catch (err: any) {
      log(`[0.1/4] Category suggestion skipped: ${err.message}`);
    }
  } else if (resolvedSiteContextSummary) {
    log(`[0.1/4] Using crawled site context (${resolvedSiteCategories.length} categories)`);
  }

  // ── Step 0: Customer Problem Discovery (always runs unless volume_first) ──────
  // User-provided context is used if available. When not provided, Gemini
  // auto-discovers problems from niche + seeds using grounding — no user input needed.
  const userHasProblemContext = (input.customer_problems?.length ?? 0) > 0 || (input.pain_points?.length ?? 0) > 0;
  const hasProblemContext = true; // always discover problems — strategy is fixed
  let discoveredProblems: DiscoveredProblem[] = [];
  let problemKeywordsCount = 0;
  // Grounding query accumulator — collects hidden queries from all Gemini grounding calls
  const allGroundingQueries: string[] = [];
  const allGroundingUrls: string[] = [];

  if (hasProblemContext) {
    if (userHasProblemContext) {
      log('[0/4] Discovering customer problems from provided context...');
    } else {
      log('[0/4] Auto-discovering customer problems from niche + seeds (Gemini grounding)...');
    }
    const discoveryResult = await runCustomerProblemDiscoveryEngine({
      product_or_service: input.product_or_service,
      target_customer: input.target_customer,
      customer_problems: input.customer_problems?.length
        ? input.customer_problems
        : [`ลูกค้าที่สนใจเรื่อง ${input.niche}`],
      pain_points: input.pain_points || [],
      real_customer_questions: input.real_customer_questions || [],
      faq_from_sales_team: input.faq_from_sales_team || [],
      faq_from_customer_service: input.faq_from_customer_service || [],
      niche: input.niche,
      businessContext: input.businessContext,
    });
    discoveredProblems = discoveryResult.problems;
    // Harvest grounding queries from problem discovery
    for (const q of discoveryResult.groundingQueries) {
      if (!allGroundingQueries.includes(q)) allGroundingQueries.push(q);
    }
    for (const u of discoveryResult.groundingUrls) {
      if (!allGroundingUrls.includes(u)) allGroundingUrls.push(u);
    }
    const problemSeeds = discoveredProblems.flatMap(p => p.keywords_to_expand);
    const newSeeds = problemSeeds.filter(s => !excludeSet.has(normalize(s)));
    input = { ...input, seeds: [...input.seeds, ...newSeeds] };
    log(`[0/4] Problem discovery: ${discoveredProblems.length} problems → ${newSeeds.length} new seeds added`);
  }

  // ── Step 1: Keyword Planner ──────────────────────────────────────────────────
  // plannerDirectPool: KP keywords staged for direct injection into geminiKeywords
  // after Gemini expansion. Populated in Step 1, merged in Step 2c.
  const plannerDirectPool: any[] = [];
  log('[1/4] Fetching Keyword Planner volumes...');
  let plannerMap = new Map<string, any>();
  const hasPlannerCreds = !!(
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
    process.env.GOOGLE_ADS_CLIENT_ID &&
    process.env.GOOGLE_ADS_REFRESH_TOKEN &&
    process.env.GOOGLE_ADS_CUSTOMER_ID
  );

  // seedVolumeMap: short-tail keyword → real KP volume (used to annotate long-tail children)
  const seedVolumeMap = new Map<string, number>();

  if (hasPlannerCreds && input.useKeywordPlanner !== false) {
    // Put user-supplied seeds FIRST so they appear in the first Planner chunk
    // and get real volume back before long-tail expanded seeds fill up the quota
    const FORUM_SEED_BLOCK = /\b(pantip|sanook|wongnai|reddit|quora|twitter|facebook|youtube|tiktok|blockdit|medium)\b/i;
    const expandedSeeds = input.seeds.map(normalize).filter(s => !userSuppliedSeeds.includes(s));
    const allPlannerSeeds = [...new Set([...userSuppliedSeeds, ...expandedSeeds])].filter(s => !FORUM_SEED_BLOCK.test(s));
    log(`[1/4] Planner seeds: ${allPlannerSeeds.slice(0,5).join(', ')}... (${allPlannerSeeds.length} total, user seeds first)`);
    plannerMap = await fetchPlannerVolumes(allPlannerSeeds, input);
    log(`[1/4] Keyword Planner: ${plannerMap.size} keywords with real volume`);
    if (plannerMap.size === 0) warnings.push('Google Keyword Planner returned 0 results — using WordGod estimates only');

    // Build seedVolumeMap — short-tail KP anchors for annotating long-tail estimates
    // Planner sometimes inserts spaces into Thai keywords (e.g. "ประกัน เดินทาง")
    // so we match both with and without spaces
    const stripSpaces = (s: string) => s.replace(/\s+/g, '');

    // 1. User-supplied seeds: look up in plannerMap with space-insensitive matching
    for (const userSeed of userSuppliedSeeds) {
      const wordCount = userSeed.split(/\s+/).length;
      if (wordCount > 3) continue;
      // Try exact, then space-stripped match
      const data = plannerMap.get(userSeed)
        ?? [...plannerMap.entries()].find(([k]) => stripSpaces(k) === stripSpaces(userSeed))?.[1];
      if (data?.volume > 0) {
        seedVolumeMap.set(userSeed, data.volume);
      }
    }
    // 2. Any short-tail ideas Planner returned with real volume
    for (const [kw, data] of plannerMap.entries()) {
      const wordCount = kw.trim().split(/\s+/).length;
      if (wordCount <= 3 && data.volume > 0 && !seedVolumeMap.has(kw) && !seedVolumeMap.has(stripSpaces(kw))) {
        seedVolumeMap.set(kw, data.volume);
      }
    }
    log(`[1/4] Seed volume map: ${seedVolumeMap.size} short-tail KP anchors (${[...seedVolumeMap.entries()].slice(0,3).map(([k,v])=>`${k}=${v}`).join(', ')})`);

    // ── Pre-populate geminiKeywords with all KP-returned keywords ───────────────
    // KP returns keywords it HAS volume data for. Inject them directly into the pool
    // NOW (before excludeSet fills up during Gemini expansion) so they are guaranteed
    // to appear in the final output with real volume_source='keyword_planner'.
    // Mark source='exact' so mergeKeywords assigns the correct volume_source.
    // Track which KP keywords we've already added to avoid duplicates within the pool
    const kpPoolSet = new Set<string>();
    const userExcludeSet = new Set<string>((input.excludeKeywords || []).map(normalize));
    let kpDirectCount = 0;
    const FORUM_BLOCK = /\b(pantip|sanook|wongnai|reddit|quora|twitter|facebook|youtube|tiktok|blockdit|medium)\b/i;
    for (const [kpKey, kpData] of plannerMap.entries()) {
      if (kpData.volume === 0) continue;
      if (FORUM_BLOCK.test(kpKey)) continue; // block forum/aggregator keywords
      // Only skip if user explicitly excluded this keyword — seeds are in excludeSet
      // too but KP keywords with real volume must always be injected into the pool
      if (userExcludeSet.has(kpKey)) continue;
      if (kpPoolSet.has(kpKey)) continue;
      if (!kpData.source) kpData.source = 'exact';
      excludeSet.add(kpKey);
      const intent = classifyIntent(kpKey);
      const keyword_type = classifyKeywordType(kpKey);
      kpPoolSet.add(kpKey);
      excludeSet.add(kpKey); // prevent Gemini from creating duplicates
      plannerDirectPool.push({
        keyword: kpKey,
        volume_estimate: kpData.volume,
        competition: kpData.competition,
        intent,
        keyword_type,
        content_type: resolveContentType(intent),
        journey_stage: undefined,
        topic_cluster_role: undefined,
        customer_problem: undefined,
        money_page_opportunity: false,
        _volume_source: 'keyword_planner' as const, // bypass mergeKeywords plannerMap lookup
      });
      kpDirectCount++;
    }
    // Also inject KP keywords as seeds for Gemini (up to 30, already in excludeSet so won't duplicate)
    const kpSeedTexts = plannerDirectPool.slice(0, 30).map(k => k.keyword);
    if (kpSeedTexts.length > 0) input = { ...input, seeds: [...input.seeds, ...kpSeedTexts] };
    if (kpDirectCount > 0) log(`[1/4] Queued ${kpDirectCount} KP keywords for direct pool injection (will merge with real volume)`);
  } else {
    log('[1/4] Keyword Planner: credentials not configured — using WordGod AI estimates');
    warnings.push('GOOGLE_ADS_* credentials not set — volumes are WordGod AI estimates, not real data');
  }

  // ── Step 2: WordGod keyword expansion ───────────────────────────────────────
  const intentRatio: IntentRatio = input.intentRatio ?? DEFAULT_INTENT_RATIO;
  const isKnowledgeMode = input.presetKey === 'preset6';
  const modeLabel = isKnowledgeMode ? 'Knowledge Mode' : 'Standard';

  // Auto-derive website_type from presetKey — not user-selectable.
  // preset6 = Knowledge Blog → 'knowledge', preset4 = E-Commerce → 'ecommerce',
  // preset3 = Local Service → 'service', everything else → undefined (standard).
  const derivedWebsiteType: WebsiteType | undefined =
    input.presetKey === 'preset6' ? 'knowledge' :
    input.presetKey === 'preset4' ? 'ecommerce' :
    input.presetKey === 'preset3' ? 'service' :
    input.website_type ?? undefined;
  log(`[2/4] Expanding keywords with WordGod AI... [${modeLabel}] Info ${intentRatio.informational}% / Com ${intentRatio.commercial}% / Trans ${intentRatio.transactional}% / Nav ${intentRatio.navigational}% / Update ${intentRatio.update}%`);

  // Build cache key from stable inputs (skip cache on forceRefresh)
  const geminiCacheKey = input.forceRefresh
    ? undefined
    : buildGeminiCacheKey(
        input.niche,
        userSuppliedSeeds.slice(0, 20),
        input.targetCount,
        intentRatio,
        isKnowledgeMode
      );

  const geminiExpandResult = await expandWithGemini(
    input.seeds,
    input.niche,
    input.targetCount,
    excludeSet,
    log,
    intentRatio,
    isKnowledgeMode,
    {
      customerProblems: input.customer_problems?.length
        ? input.customer_problems
        : discoveredProblems.slice(0, 5).map(p => p.problem_statement),
      painPoints: input.pain_points,
      realCustomerQuestions: input.real_customer_questions,
      faqFromSalesTeam: input.faq_from_sales_team,
    },
    resolvedSiteContextSummary,
    resolvedSiteCategories.length > 0 ? resolvedSiteCategories : undefined,
    geminiCacheKey
  );
  const geminiKeywords = geminiExpandResult.keywords;
  // Harvest grounding from keyword expansion
  for (const q of geminiExpandResult.groundingQueries) {
    if (!allGroundingQueries.includes(q)) allGroundingQueries.push(q);
  }
  for (const u of geminiExpandResult.groundingUrls) {
    if (!allGroundingUrls.includes(u)) allGroundingUrls.push(u);
  }
  log(`[2/4] WordGod: found ${geminiKeywords.length} unique keywords`);
  if (geminiKeywords.length === 0) {
    warnings.push('WordGod returned 0 keywords — check API key and availability');
  }

  // ── Step 2b: Problem-derived keyword expansion ───────────────────────────────
  if (hasProblemContext && discoveredProblems.length > 0) {
    log('[2b/4] Expanding problem-derived keywords...');
    const problemExpandResult = await runProblemToKeywordExpander(discoveredProblems, input.niche, excludeSet, log);
    const problemKws = problemExpandResult.keywords;
    problemKeywordsCount = problemKws.length;
    // Harvest grounding from problem expansion
    for (const q of problemExpandResult.groundingQueries) {
      if (!allGroundingQueries.includes(q)) allGroundingQueries.push(q);
    }
    for (const u of problemExpandResult.groundingUrls) {
      if (!allGroundingUrls.includes(u)) allGroundingUrls.push(u);
    }
    log(`[2b/4] Problem keywords added: ${problemKws.length}`);
    geminiKeywords.push(...problemKws);
  }

  // ── Step 2c: Merge KP direct pool into geminiKeywords ───────────────────────
  // plannerDirectPool was populated in Step 1 with all KP keywords that have real volume.
  // They were added to excludeSet then, so Gemini won't have created duplicates.
  if (plannerDirectPool.length > 0) {
    geminiKeywords.push(...plannerDirectPool);
    log(`[2c/4] Merged ${plannerDirectPool.length} KP keywords with real volume into expansion pool`);
  }

  // ── Step 2.5: DataForSEO volume enrichment for all Gemini + problem keywords ─
  // Also includes hidden grounding queries harvested from Gemini's Google Search calls.
  // Cache-first: skip API call for keywords cached within TTL.
  // Cost: ~$0.0003/keyword — typically $0.01–0.02/run.
  let dfsCalled = 0;
  const { hasDataForSeoCreds, getDataForSeoVolumes } = await import('../services/dataForSeoService');
  const { readDFSCache, writeDFSCache } = await import('../cache/dfsCache');

  // Surface grounding queries in log
  if (allGroundingQueries.length > 0) {
    log(`[2.5/4] Grounding: harvested ${allGroundingQueries.length} hidden queries + ${allGroundingUrls.length} competitor URLs`);
    log(`[2.5/4] Hidden queries (sample): ${allGroundingQueries.slice(0, 5).join(' | ')}`);
    // Inject grounding queries as additional geminiKeywords (if not already present)
    // These are real queries Google users typed — highest-confidence keywords available
    for (const q of allGroundingQueries) {
      const qNorm = normalize(q);
      if (!excludeSet.has(qNorm) && !geminiKeywords.some(k => normalize(k.keyword) === qNorm)) {
        excludeSet.add(qNorm);
        geminiKeywords.push({
          keyword: q,
          volume_estimate: 0,  // will be enriched by DFS below
          competition: 'UNSPECIFIED',
          intent: classifyIntent(q),
          keyword_type: 'seed',
          content_type: resolveContentType(classifyIntent(q)),
          journey_stage: undefined,
          topic_cluster_role: undefined,
          customer_problem: undefined,
          money_page_opportunity: false,
        });
      }
    }
    if (allGroundingQueries.length > 0) {
      log(`[2.5/4] Injected ${Math.min(allGroundingQueries.length, geminiKeywords.length)} grounding queries as verified seeds`);
    }
  }

  if (hasDataForSeoCreds() && geminiKeywords.length > 0) {
    // Only enrich keywords that have no real KP volume yet
    const needsVolume = geminiKeywords.filter(k => {
      const p = plannerMap.get(normalize(k.keyword));
      return !p || p.volume === 0;
    });

    if (needsVolume.length > 0) {
      // Cache check — skip API for fresh cache hits
      const toCall: string[] = [];
      for (const k of needsVolume) {
        const cached = readDFSCache(k.keyword, k.keyword_type ?? 'default', k.intent ?? 'informational');
        if (cached.hit && cached.metric && !cached.stale) {
          if (cached.metric.volume > 0) {
            plannerMap.set(normalize(k.keyword), { ...cached.metric, source: 'dataforseo' });
          }
        } else {
          toCall.push(k.keyword);
        }
      }

      const cacheHits = needsVolume.length - toCall.length;
      // Prioritise shorter keywords — DFS only has data for ≤4 word queries typically.
      // Long-tail (5+ words) almost never appear in DFS; put them last to save quota.
      toCall.sort((a, b) => a.split(/\s+/).length - b.split(/\s+/).length);
      const shortTailCount = toCall.filter(k => k.split(/\s+/).length <= 4).length;
      dfsCalled += toCall.length;
      const dfsEstUsd = toCall.length * 0.0003;
      log(`[2.5/4] DataForSEO: ${needsVolume.length} keywords need volume → ${cacheHits} cache hits, ${toCall.length} to call (${shortTailCount} short-tail, ${toCall.length - shortTailCount} long-tail) | est. $${dfsEstUsd.toFixed(4)} (฿${(dfsEstUsd * 34).toFixed(2)})`);

      if (toCall.length > 0) {
        try {
          const locationCode = lang === 'th' ? 2764 : 2840;
          const isThai = lang === 'th';

          // DFS stores Thai keywords without inter-word spaces.
          // Build a map: dfsKey (stripped) → original keyword, so we can write
          // cache and plannerMap using the original form after getting results.
          const dfsKeyMap = new Map<string, string>(); // dfsKey → original kw
          const dfsKeywords: string[] = [];
          for (const kw of toCall) {
            const dfsKey = isThai
              ? kw.toLowerCase().replace(/\s+/g, '') // Thai: strip all spaces
              : kw.toLowerCase().trim();              // English: keep spaces
            if (!dfsKeyMap.has(dfsKey)) {
              dfsKeyMap.set(dfsKey, kw);
              dfsKeywords.push(dfsKey);
            }
          }

          const rawMap = await getDataForSeoVolumes(dfsKeywords, isThai ? 'th' : 'en', locationCode);
          let dfsHits = 0;

          // Track which original keywords still have no volume — need fallback
          const stillMissing: string[] = [];

          for (const kw of toCall) {
            const dfsKey = isThai
              ? kw.toLowerCase().replace(/\s+/g, '')
              : kw.toLowerCase().trim();
            const metric = rawMap.get(dfsKey) ?? rawMap.get(kw.toLowerCase().trim());
            const kwMeta = needsVolume.find(k => k.keyword === kw);
            if (metric && metric.volume > 0) {
              plannerMap.set(normalize(kw), { ...metric, source: 'dataforseo' });
              writeDFSCache(kw, metric, kwMeta?.keyword_type ?? 'default', kwMeta?.intent ?? 'informational');
              dfsHits++;
            } else {
              // Only cache zero-volume for short keywords (≤3 words) — long-tail may match via shortening
              if (kw.trim().split(/\s+/).length <= 3) {
                const dummy = { volume: 0, competition: 'UNSPECIFIED' as const, competition_index: 0, cpc: 0, source: 'dataforseo' as const };
                writeDFSCache(kw, dummy, kwMeta?.keyword_type ?? 'default', kwMeta?.intent ?? 'informational');
              } else {
                stillMissing.push(kw);
              }
            }
          }

          // ── Fallback: progressive shortening for long-tail with no volume ────────
          // Drop words from the right until DFS has data, use that volume as proxy.
          // e.g. "เอเจนซี่รับทำวีซ่า ราคาถูก ดีไหม" → try "เอเจนซี่รับทำวีซ่า ราคาถูก" → "เอเจนซี่รับทำวีซ่า"
          if (stillMissing.length > 0) {
            // Build shortened candidate → original keyword map (dedup candidates)
            const shortenMap = new Map<string, string>(); // shortened → original kw
            for (const kw of stillMissing) {
              const words = kw.trim().split(/\s+/);
              // Try removing 1 word at a time from right, minimum 2 words
              for (let len = words.length - 1; len >= 2; len--) {
                const shortened = words.slice(0, len).join(' ');
                const shortenKey = isThai
                  ? shortened.toLowerCase().replace(/\s+/g, '')
                  : shortened.toLowerCase();
                // Already have volume from round 1?
                if (rawMap.has(shortenKey)) {
                  const m = rawMap.get(shortenKey)!;
                  if (m.volume > 0) {
                    shortenMap.set(kw, shortened); // found in round-1 result
                  }
                  break;
                }
                // Need to look up — use shortest candidate per original kw (first success wins)
                if (!shortenMap.has(kw)) shortenMap.set(kw, shortened);
                break; // only try 1-word-shorter first; if no hit, try next iteration
              }
            }

            // Collect unique shortened keywords that need lookup
            const shortenLookup = [...new Set(shortenMap.values())].filter(s => {
              const k = isThai ? s.toLowerCase().replace(/\s+/g, '') : s.toLowerCase();
              return !rawMap.has(k); // skip if already in rawMap from round 1
            });

            if (shortenLookup.length > 0) {
              log(`[2.5/4] DataForSEO fallback: ${stillMissing.length} long-tail with no volume → trying ${shortenLookup.length} shortened forms`);
              const shortenDfsKeys = shortenLookup.map(s =>
                isThai ? s.toLowerCase().replace(/\s+/g, '') : s.toLowerCase()
              );
              const shortenRaw = await getDataForSeoVolumes(shortenDfsKeys, isThai ? 'th' : 'en', locationCode);
              // Merge into rawMap
              for (const [k, v] of shortenRaw) rawMap.set(k, v);
            }

            // Now assign volume from shortened form to original keywords
            let fallbackHits = 0;
            for (const kw of stillMissing) {
              const kwMeta = needsVolume.find(k => k.keyword === kw);
              const shortened = shortenMap.get(kw);
              if (!shortened) {
                const dummy = { volume: 0, competition: 'UNSPECIFIED' as const, competition_index: 0, cpc: 0, source: 'dataforseo' as const };
                writeDFSCache(kw, dummy, kwMeta?.keyword_type ?? 'default', kwMeta?.intent ?? 'informational');
                continue;
              }
              const shortenKey = isThai
                ? shortened.toLowerCase().replace(/\s+/g, '')
                : shortened.toLowerCase();
              const metric = rawMap.get(shortenKey);
              if (metric && metric.volume > 0) {
                // Tag as planner_variant so UI shows it differently from exact DFS
                const proxyMetric = { ...metric, source: 'dataforseo' as const };
                plannerMap.set(normalize(kw), { ...proxyMetric, source: 'close_variant' as const, volume_proxy_keyword: shortened });
                writeDFSCache(kw, proxyMetric, kwMeta?.keyword_type ?? 'default', kwMeta?.intent ?? 'informational');
                fallbackHits++;
              } else {
                const dummy = { volume: 0, competition: 'UNSPECIFIED' as const, competition_index: 0, cpc: 0, source: 'dataforseo' as const };
                writeDFSCache(kw, dummy, kwMeta?.keyword_type ?? 'default', kwMeta?.intent ?? 'informational');
              }
            }
            dfsHits += fallbackHits;
            log(`[2.5/4] DataForSEO fallback: ${fallbackHits}/${stillMissing.length} enriched via shortened form`);
          }

          log(`[2.5/4] DataForSEO: ${dfsHits}/${toCall.length} total enriched`);
        } catch (err: any) {
          log(`[2.5/4] DataForSEO error: ${err.message} — using Gemini estimates`);
        }
      }
    }
  }

  // ── Step 2.55: KP historical metrics for keywords still missing volume ────────
  // After DFS, some Gemini keywords still have no real volume. Send them to KP
  // getHistoricalMetrics which uses close-variant fallback (higher hit rate than DFS).
  if (hasPlannerCreds && input.useKeywordPlanner !== false) {
    const stillNoVolume = geminiKeywords.filter(k => {
      const p = plannerMap.get(normalize(k.keyword));
      return !p || p.volume === 0;
    });
    if (stillNoVolume.length > 0) {
      log(`[2.55/4] KP historical: ${stillNoVolume.length} keywords still without volume → querying Keyword Planner`);
      try {
        const { getHistoricalMetrics, loadGoogleAdsConfig, getAccessToken } = await import('../services/googleKeywordPlannerService');
        const kpConfig = loadGoogleAdsConfig();
        if (kpConfig) {
          const accessToken = await getAccessToken(kpConfig);
          const kpMetrics = await getHistoricalMetrics(
            stillNoVolume.map(k => k.keyword),
            kpConfig,
            accessToken,
            input.targetLanguage || 'th',
            'Thailand'
          );
          let kpHits = 0;
          for (const [kw, metric] of kpMetrics.entries()) {
            if (metric.volume > 0) {
              plannerMap.set(normalize(kw), {
                volume: metric.volume,
                competition: metric.competition,
                competition_index: metric.competition_index,
                source: metric.source, // 'exact' or 'close_variant'
                volume_proxy_keyword: metric.variant_keyword,
              });
              kpHits++;
            }
          }
          log(`[2.55/4] KP historical: ${kpHits}/${stillNoVolume.length} enriched`);
        }
      } catch (err: any) {
        log(`[2.55/4] KP historical error: ${err.message}`);
      }
    }
  }

  // ── Step 2.6: Inject competitor URL keyword signals from grounding citations ──
  if (allGroundingUrls.length > 0) {
    const existingNorms = new Set(geminiKeywords.map(k => normalize(k.keyword)));
    const competitorSignals = extractCompetitorKeywords(
      allGroundingUrls,
      [], // titles not available from current grounding — URLs only
      existingNorms
    );
    let competitorInjected = 0;
    for (const signal of competitorSignals) {
      const intent = classifyIntent(signal.keyword);
      const ktype = classifyKeywordType(signal.keyword);
      // Only inject if looks like a real search keyword (not nav garbage)
      if (signal.keyword.length < 8 || signal.source !== 'page_title') continue;
      geminiKeywords.push({
        keyword: signal.keyword,
        volume_estimate: 0,
        competition: 'UNSPECIFIED',
        intent,
        keyword_type: ktype,
        content_type: resolveContentType(intent),
        journey_stage: undefined,
        topic_cluster_role: undefined,
        customer_problem: undefined,
        money_page_opportunity: false,
      });
      competitorInjected++;
    }
    if (competitorInjected > 0) {
      log(`[2.6/4] Competitor signals: injected ${competitorInjected} keyword signals from ${allGroundingUrls.length} competitor URLs`);
    }
  }

  // ── Step 3: Merge ────────────────────────────────────────────────────────────
  log('[3/4] Merging Keyword Planner + WordGod data...');
  const merged = mergeKeywords(geminiKeywords, plannerMap, seedVolumeMap);

  const plannerCount = merged.filter(k => k.volume_source === 'keyword_planner' || k.volume_source === 'planner_variant').length;
  const dfsCount = merged.filter(k => k.volume_source === 'dataforseo').length;
  const geminiCount = merged.filter(k => k.volume_source === 'gemini_estimated').length;
  log(`[3/4] Merged: ${merged.length} keywords (${plannerCount} KP, ${dfsCount} DFS, ${geminiCount} est.) — applying intent-bucket allocation next`);

  // ── Step 3b: Enrich all keywords + Intent-Bucket Allocation ─────────────────
  //
  // Phase 1: Enrich every keyword with journey, AI risk, and scoring signals.
  // Phase 2: Group into intent buckets → score within each bucket using
  //          intent-specific formula → select quota per bucket per IntentRatio
  //          → recombine → final sort by strategy_mode.

  log('[3b/4] Scoring keywords and applying Intent-Bucket allocation...');

  for (const kw of merged) {
    if (!kw.journey_stage) {
      kw.journey_stage = classifyJourneyStage(kw.keyword, kw.intent, kw.keyword_type);
    }
    // Topic cluster role — use Gemini-provided value or rule-based fallback
    if (!kw.topic_cluster_role) {
      kw.topic_cluster_role = detectTopicClusterRole(kw.keyword, kw.intent);
    }
    const { risk, ai_resilience_score } = classifyAISearchRisk(kw.keyword, kw.intent, kw.content_type);
    kw.ai_search_risk = risk;
    kw.ai_resilience_score = ai_resilience_score;
    kw.sales_impact_score = computeSalesImpactScore(kw.intent, kw.journey_stage, kw.volume, derivedWebsiteType);

    // ── AEO / AI Search / GEO supplement layer ──────────────────────────────
    const aeoFields = enrichWithAEO(kw.keyword, kw.intent, ai_resilience_score, kw.sales_impact_score);
    Object.assign(kw, aeoFields);

    // ── Competitor Gap Scoring ───────────────────────────────────────────────
    const gap = scoreCompetitorGap(kw.keyword, kw.keyword_type, kw.intent, kw.volume, kw.aeo_opportunity_score ?? 0, kw.topic_cluster_role);
    kw.gap_score = gap.gap_score;
    kw.gap_level = gap.gap_level;
    kw.gap_reasons = gap.gap_reasons;

    // ── Trend / Seasonal Detection ───────────────────────────────────────────
    const trend = detectTrendSignal(kw.keyword, kw.intent, kw.keyword_type);
    kw.trend_type = trend.trend_type;
    kw.trend_score = trend.trend_score;
    kw.refresh_priority = trend.refresh_priority;
    kw.content_notes = trend.content_notes;

    kw.buyer_intent_score = computeBuyerIntentScore(kw.intent);
    if (!kw.problem_urgency_score) kw.problem_urgency_score = 50;
    // Gap-Fill new scores
    kw.keyword_depth_score = computeKeywordDepthScore(kw.keyword, kw.topic_cluster_role);
    kw.internal_link_opportunity_score = computeInternalLinkOpportunityScore(kw.keyword, kw.intent, kw.topic_cluster_role);
    kw.customer_pain_urgency_score = computeCustomerPainUrgencyScore(kw.keyword, kw.problem_urgency_score, kw.journey_stage);
    kw.suggested_anchor_text = suggestAnchorText(kw.keyword, kw.intent);
    // keyword_group: use problem_group if set, else topic_cluster_role label
    if (!kw.keyword_group) {
      kw.keyword_group = kw.problem_group || kw.topic_cluster_role || '';
    }
    const volScore = computeVolumeScore(kw.volume);
    // Compute intent bucket + bucket score first (gate layer)
    const bucket = mapIntentToBucket(kw.intent);
    const bucketBase = {
      volume_score: volScore,
      ai_resilience_score: kw.ai_resilience_score,
      sales_impact_score: kw.sales_impact_score,
      buyer_intent_score: kw.buyer_intent_score,
    };
    kw.intent_bucket_score = computeIntentBucketScore(kw.keyword, kw.intent, bucket, bucketBase);
    // Priority score: Intent Mix (bucket) → Strategy Mode (within-bucket sort)
    const scores: AllScores = {
      opportunity_score: kw.opportunity_score,
      sales_impact_score: kw.sales_impact_score,
      buyer_intent_score: kw.buyer_intent_score,
      problem_urgency_score: kw.problem_urgency_score,
      ai_resilience_score: kw.ai_resilience_score,
      cluster_potential_score: 50,
      volume_score: volScore,
      intent_bucket: bucket,
      intent_bucket_score: kw.intent_bucket_score,
      keyword_depth_score: kw.keyword_depth_score,
      internal_link_opportunity_score: kw.internal_link_opportunity_score,
      customer_pain_urgency_score: kw.customer_pain_urgency_score,
    };
    kw.priority_score = computePriorityScore(scores, strategyMode);
    // Boost keywords with verified real volume — they're more reliable than estimates
    if (kw.volume_source === 'keyword_planner' || kw.volume_source === 'planner_variant' || kw.volume_source === 'dataforseo') {
      kw.intent_bucket_score = (kw.intent_bucket_score ?? 0) + 15;
      kw.priority_score = (kw.priority_score ?? 0) + 15;
    }
  }

  // Guarantee KP/DFS keywords appear in final output — pre-select them first,
  // then fill remaining slots via intent-bucket allocation from the rest.
  const realVolumeKws = (merged as any[]).filter((kw: any) =>
    kw.volume_source === 'keyword_planner' || kw.volume_source === 'planner_variant' || kw.volume_source === 'dataforseo'
  );
  // Sort real-volume keywords by volume desc so highest-volume ones are selected first
  realVolumeKws.sort((a: any, b: any) => (b.volume ?? 0) - (a.volume ?? 0));

  // Cap pre-selected real-volume keywords to at most 60% of targetCount
  const maxRealGuaranteed = Math.floor(input.targetCount * 0.6);
  const guaranteedKws = realVolumeKws.slice(0, maxRealGuaranteed);
  const guaranteedSet = new Set(guaranteedKws.map((k: any) => k.keyword));
  const remainingForAllocation = (merged as any[]).filter((kw: any) => !guaranteedSet.has(kw.keyword));
  const remainingTarget = input.targetCount - guaranteedKws.length;

  const allocated = remainingTarget > 0
    ? [...guaranteedKws, ...applyIntentBucketAllocation(remainingForAllocation as any, intentRatio, input.presetKey ?? 'preset1', remainingTarget)]
    : guaranteedKws;
  // Replace merged with allocated result
  merged.length = 0;
  merged.push(...(allocated as any));

  log(`[3b/4] Intent-bucket allocation done: ${merged.length} keywords selected (strategy: ${strategyMode})`);

  // ── Abort after step 3 ───────────────────────────────────────────────────────
  if (checkAbort()) {
    log(`Stopped — returning ${merged.length} keywords without titles`);
    const partial = merged.map(k => ({ ...k, title: k.keyword, aeo_question: '', seo_score: 0, aeo_score: 0, ai_search_score: 0, ctr_score: 0, title_notes: '' })) as PipelineKeyword[];
    return makePartialResult(partial, plannerCount, geminiCount, warnings);
  }

  // ── Step 4+6: Title generation + Clustering + Article grouping in parallel ──
  log('[4/4] Generating titles + clustering + article grouping in parallel...');
  const runArticleGrouping = hasProblemContext; // always true except volume_first (already filtered above)

  const [titleMap, clusters, articleGroupMap] = await Promise.all([
    generateAiTitles(merged, input.businessContext, input.category, lang, log, aiSearchOpt, warnings),
    clusterKeywords(merged as any, input.niche, log),
    runArticleGrouping
      ? runArticleGroupingDecisionEngine(
          merged.map(k => ({ keyword: k.keyword, intent: k.intent, volume: k.volume, journey_stage: k.journey_stage })),
          input.niche,
          log
        )
      : Promise.resolve(new Map<string, ArticleGroupDecision>()),
  ]);

  log(`[4/4] Titles: ${titleMap.size}/${merged.length} | Clusters: ${clusters.clusters.length} | Article groups: ${articleGroupMap.size}`);

  // ── Step 5: Apply titles ─────────────────────────────────────────────────────
  const { keywords: final, fallbackCount } = applyTitles(merged as any, titleMap);
  if (fallbackCount > 0) warnings.push(`${fallbackCount} titles used fallback (AI title failed quality check)`);

  // Apply article group decisions
  for (const kw of final) {
    const group = articleGroupMap.get(kw.keyword);
    if (group) {
      kw.article_group = group.article_group;
      kw.merge_or_split = group.merge_or_split;
      kw.primary_keyword = group.primary_keyword;
      kw.secondary_keywords = group.secondary_keywords;
      kw.internal_link_target = group.internal_link_target;
      kw.next_topic_ideas = group.next_topic_ideas;
      if (group.notes) kw.notes = group.notes;
    }
  }

  // QA Validator — runs after article_group is assigned so results are accurate
  for (const kw of final) {
    const bucket = mapIntentToBucket(kw.intent);
    const qa = validateKeywordResearchQA({
      keyword: kw.keyword,
      intent: kw.intent,
      journey_stage: kw.journey_stage,
      ai_search_risk: kw.ai_search_risk,
      sales_impact_score: kw.sales_impact_score,
      priority_score: kw.priority_score,
      volume: kw.volume,
      customer_problem: kw.customer_problem,
      article_group: kw.article_group,
      internal_link_opportunity_score: kw.internal_link_opportunity_score,
      intent_bucket: bucket,
    });
    kw.qa_passes = qa.passes;
    kw.qa_warnings = qa.warnings.length > 0 ? qa.warnings : undefined;
  }

  // ── Abort check ───────────────────────────────────────────────────────────────
  if (checkAbort()) {
    log(`Stopped — returning ${final.length} keywords`);
    return makePartialResult(final, plannerCount, geminiCount, warnings);
  }

  // Attach titles to cluster keywords
  const titleLookup = new Map(final.map(k => [normalize(k.keyword), k]));
  for (const cluster of clusters.clusters) {
    const p = titleLookup.get(normalize(cluster.pillar.keyword));
    if (p) cluster.pillar.title = p.title;
    for (const s of cluster.supporting) {
      const sk = titleLookup.get(normalize(s.keyword));
      if (sk) s.title = sk.title;
    }
  }

  const geminiCost = getSessionUsage();
  const DFS_PRICE_PER_KW = 0.0003;
  const USD_TO_THB = 34;
  const dfsCostUsd = dfsCalled * DFS_PRICE_PER_KW;
  const dfsCostThb = dfsCostUsd * USD_TO_THB;
  const totalCostUsd = geminiCost.cost_usd + dfsCostUsd;
  const totalCostThb = geminiCost.cost_thb + dfsCostThb;

  log(`Done: ${final.length} keywords | KP: ${plannerCount} (฿0) | DFS: ${dfsCount} ($${dfsCostUsd.toFixed(4)}/฿${dfsCostThb.toFixed(2)}) | Gemini: $${geminiCost.cost_usd.toFixed(4)}/฿${geminiCost.cost_thb.toFixed(2)} | Total: $${totalCostUsd.toFixed(4)}/฿${totalCostThb.toFixed(2)}`);

  const cost = {
    ...geminiCost,
    gemini_cost_usd: geminiCost.cost_usd,
    gemini_cost_thb: geminiCost.cost_thb,
    dfs_keywords_called: dfsCalled,
    dfs_cost_usd: dfsCostUsd,
    dfs_cost_thb: dfsCostThb,
    kp_keywords_fetched: plannerCount,
    kp_cost_usd: 0,
    kp_cost_thb: 0,
    total_cost_usd: totalCostUsd,
    total_cost_thb: totalCostThb,
  };

  return {
    keywords: final,
    clusters,
    meta: {
      total: final.length,
      planner_count: plannerCount,
      dataforseo_count: dfsCount,
      gemini_count: geminiCount,
      title_ai_count: titleMap.size,
      fallback_title_count: fallbackCount,
      cluster_count: clusters.clusters.length,
      warnings,
      generated_at: new Date().toISOString(),
      strategy_mode: strategyMode,
      problem_keywords_count: problemKeywordsCount,
      grounding_queries: allGroundingQueries.length > 0 ? allGroundingQueries : undefined,
      grounding_urls: allGroundingUrls.length > 0 ? allGroundingUrls : undefined,
      cost,
    },
  };
}
