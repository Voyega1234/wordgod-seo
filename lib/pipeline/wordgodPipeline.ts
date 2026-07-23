/**
 * WordGod — Unified Keyword + Title Pipeline
 *
 * Flow:
 *   1. Google Keyword Planner → real volume, competition, CPC per keyword
 *   2. Gemini grounding → expand & discover new keywords with volume signals
 *   3. Merge & deduplicate — direct provider data is separated from AI references
 *   4. SEO Title AI Skill → Gemini writes titles optimized for SEO + AEO + AI Search
 *   5. Score & rank → opportunity score formula
 *   6. Return enriched rows ready for CSV export
 *
 * Server-side only. All credentials stay in process.env.
 */

import { callGeminiWithGrounding, callGemini, resetSessionUsage, getSessionUsage } from '../gemini';
import { buildGeminiCacheKey, readGeminiCache, writeGeminiCache } from '../cache/geminiCache';
import { extractCompetitorKeywords } from '../skills/competitorUrlSkill';
import { buildSeoTitleAiPrompt, buildSerpFewShotBlock } from '../skills/seoTitleAiSkill';
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
import { countWords, segmentWords, tokenSimilarity, keywordTokens, containsThai } from '../text/thai';
import { scoreTitle } from './titleScoring';
import { buildContentPlan } from '../planning/contentPlan';
import type { ContentPlanResult, PlanMode, PlanPillarInput } from '../planning/contentPlan';
import type { CompetitorEntry } from './rankValidation';
import {
  getCandidateTarget,
  isDirectMetricSource,
  isMetricLookupCandidate,
  summarizeMetricSources,
} from './keywordMetricPolicy';
import type { KeywordMetricMode, KeywordMetricSource } from './keywordMetricPolicy';

export type { IntentRatio };
export { DEFAULT_INTENT_RATIO };
export type { KeywordMetricMode };

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
  metricMode?: KeywordMetricMode; // api_only | api_first (default: api_only)
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
  // Full content planning (independent from keyword count)
  mode?: PlanMode;
  planMonths?: number;             // 1-12
  articlesPerMonth?: number;       // publishing capacity
  planStartMonth?: string;         // YYYY-MM
  planPillars?: PlanPillarInput[]; // optional money page + monthly quota per pillar
}

export interface PipelineKeyword {
  keyword: string;
  volume: number;                // direct API metric only; 0 means unavailable
  estimated_volume?: number;     // AI reference value, never presented as provider volume
  volume_source: KeywordMetricSource;
  volume_proxy_keyword?: string;  // shortened keyword used as volume proxy (planner_variant only)
  competition: string;           // LOW | MEDIUM | HIGH | UNSPECIFIED
  competition_index: number;     // 0–100
  organic_difficulty?: number;   // Organic KD 0-100 (DataForSEO Labs when available)
  cpc?: number;                  // always THB; undefined when direct conversion is unavailable
  cpc_low?: number;
  cpc_high?: number;
  cpc_currency?: 'THB';
  cpc_original_currency?: string;
  cpc_to_thb_rate?: number;
  cpc_rate_as_of?: string;
  cpc_rate_source?: string;
  monthly_trend?: number[];      // KP trailing ~12-month search-volume series (chart/sparkline source)
  metric_source?: string;
  metric_as_of?: string;
  metric_confidence?: 'high' | 'medium' | 'low';
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
  title_quality_score?: number;  // independent deterministic title quality (0–100); see titleScoring
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
  // Domain's existing ranking (from DFS ranked_keywords, Step 0.7) — the keyword the
  // domain already ranks for and its current position. Phase 3 adds a freshly SERP-
  // verified site_rank + confidence on top of this.
  existing_rank?: number;            // current rank_group the domain holds for this keyword
  existing_rank_url?: string;        // the domain URL currently ranking for it
  existing_rank_source?: 'dfs_ranked_keywords';
  is_base_seed?: boolean;            // keyword came from the domain's existing ranked set
  // Phase 3 — freshly SERP-verified rank + top-5 competitors + multi-layer confidence.
  site_rank?: number | null;         // L1: current position in DFS SERP (null = not in fetched depth)
  rank_in_top5?: boolean;
  rank_confidence?: 'high' | 'medium' | 'low';
  rank_source?: 'dfs_serp';
  rank_checked_at?: string;
  competitors?: CompetitorEntry[];   // top-5 organic results for this keyword
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
  plan?: ContentPlanResult;
  meta: {
    total: number;
    requested_count: number;
    candidate_count: number;
    metric_mode: KeywordMetricMode;
    api_backed_count: number;
    derived_count: number;
    estimated_count: number;
    shortfall_count: number;
    cpc_currency: 'THB';
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
      dfs_kd_keywords_called?: number;
      dfs_cost_usd: number;
      dfs_cost_thb: number;
      dfs_kd_cost_usd?: number;
      dfs_kd_cost_thb?: number;
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
  // Thai + English signals in one pass. KP keywords arrive here (bypassing
  // Gemini), so English patterns are needed or every KP term defaults to
  // "informational" — which flattened the whole plan to TOFU before.
  if (/ราคา|ค่า|เท่าไร|กี่บาท|โปรโมชั่น|ส่วนลด|\bprice\b|\bcost\b|\bcheap\b|\bfee\b|\brate\b/.test(kw)) return 'price';
  if (/เปรียบเทียบ|vs\.?|ดีกว่า|ต่างกัน|ไหนดี|อันไหน|เทียบ|\bcompare\b|\bversus\b|\bvs\b|\bbest\b|\bbetter\b|\bwhich\b/.test(kw)) return 'comparison';
  if (/รีวิว|review|ดีไหม|น่าเชื่อถือ|\bpantip\b|\brating\b/.test(kw)) return 'review';
  if (/ซื้อ|สั่ง|จอง|สมัคร|เปิดบัญชี|ดาวน์โหลด|\bbuy\b|\border\b|\bapply\b|\bsign ?up\b|\bregister\b|\bdownload\b|\bopen account\b/.test(kw)) return 'transactional';
  if (/บริการ|รับจัด|agency|\bservice\b|\bnear me\b|\bใกล้ฉัน\b|ใกล้ฉัน/.test(kw)) return 'service_seeking';
  if (/แก้|รักษา|ป้องกัน|วิธีแก้|ปัญหา|ถูกระงับ|ไม่ได้|error|\bfix\b|\bproblem\b|\bnot working\b|\btroubleshoot\b/.test(kw)) return 'problem_solving';
  if (/วิธีเลือก|ก่อนซื้อ|แนะนำ|ควรรู้|เลือกยังไง|\bhow to choose\b|\bguide\b|\btips\b|\brecommend/.test(kw)) return 'commercial';
  if (/เช็คลิสต์|checklist|รายการ|\bcheck ?list\b/.test(kw)) return 'checklist';
  if (/คืออะไร|หมายถึง|คือ|ทำไม|วิธี|ยังไง|\bwhat is\b|\bwhat's\b|\bhow\b|\bwhy\b|\bmeaning\b|\bคือ\b/.test(kw)) return 'informational';
  return 'informational';
}

// Google Keyword Planner expands a seed into semantically-adjacent ideas, some
// of which are off-topic (seed "line bk" pulled in "burger king", "mcdonald").
// Gemini is meant to filter these, but when it is down every KP idea passes
// straight through. This gate is the deterministic backstop.

// Scripts we never keep: a Thai-market brand plan should not carry Spanish,
// Cyrillic, Arabic, CJK, etc. Allow Thai, Latin, digits, and common symbols.
const NON_TARGET_SCRIPT = /[^฀-๿ -ɏ -⁯\s]/;
const SPANISH_LOCALE_HINT = /\b(cerca de|más|para llevar|precio|sucursal|comida|dónde|cómo)\b|[ñáéíóúü¿¡]/i;

function buildRelevanceAnchors(seeds: string[], niche: string, siteContext?: string): Set<string> {
  const anchors = new Set<string>();
  const add = (text: string) => {
    for (const tok of keywordTokens(text, containsThai(text) ? 'th' : 'en')) anchors.add(tok);
  };
  for (const seed of seeds) add(seed);
  add(niche);
  if (siteContext) add(siteContext);
  return anchors;
}

/**
 * A KP keyword is on-topic if it shares at least one meaningful token with the
 * seed/niche/site vocabulary. Off-script and locale-foreign keywords are always
 * rejected. Returns a reason string when rejected, or null when the keyword passes.
 */
function offTopicReason(keyword: string, anchors: Set<string>): string | null {
  if (NON_TARGET_SCRIPT.test(keyword)) return 'non-target script';
  if (SPANISH_LOCALE_HINT.test(keyword)) return 'foreign-locale term';
  if (anchors.size === 0) return null; // no anchors to compare against — keep
  const tokens = keywordTokens(keyword, containsThai(keyword) ? 'th' : 'en');
  for (const tok of tokens) {
    if (anchors.has(tok)) return null; // shares vocabulary with the niche
  }
  return 'no overlap with niche vocabulary';
}

function classifyKeywordType(keyword: string): string {
  const kw = keyword.toLowerCase();
  const wordCount = countWords(kw, /[\u0E00-\u0E7F]/.test(kw) ? 'th' : 'en');
  if (/เปรียบเทียบ|vs\./.test(kw)) return 'comparison';
  if (/ราคา|เท่าไร/.test(kw)) return 'price';
  if (/รีวิว/.test(kw)) return 'review';
  if (/ซื้อ|สั่ง/.test(kw)) return 'transactional';
  if (/ปัญหา|แก้|รักษา/.test(kw)) return 'problem';
  if (/คืออะไร|ทำไม/.test(kw)) return 'question';
  if (/แนะนำ|ก่อนซื้อ|วิธีเลือก/.test(kw)) return 'commercial';
  if (wordCount >= 4) return 'long_tail';
  if (wordCount === 1) return 'seed';
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
  keyword: string,
  organicDifficulty?: number,
  competitionIndex = 0
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

  const words = countWords(keyword, /[\u0E00-\u0E7F]/.test(keyword) ? 'th' : 'en');
  const gap = words >= 4 ? 9 : words >= 3 ? 7 : words >= 2 ? 5 : 3;

  // Prefer a real organic KD. Paid competition is only a fallback and is never
  // labelled as organic difficulty. Word count only supplies a low-confidence
  // depth signal when neither metric exists.
  const compVal = typeof organicDifficulty === 'number'
    ? Math.max(0, Math.min(10, (100 - organicDifficulty) / 10))
    : competitionIndex > 0
      ? Math.max(1, Math.min(9, (100 - competitionIndex) / 10))
      : Math.max(3, Math.min(8, gap));

  const raw =
    volScore * 10 * 0.30 +
    (intentVal[intent] ?? 5) * 10 * 0.25 +
    compVal * 10 * 0.20 +
    (typeVal[keyword_type] ?? 5) * 10 * 0.15 +
    gap * 10 * 0.10;

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
  input: PipelineInput,
  warnings?: string[]
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
    for (const warning of result.warnings ?? []) {
      if (!warnings?.includes(warning)) warnings?.push(warning);
    }
    if (result.success) {
      for (const row of result.rows) {
        map.set(normalize(row.keyword), {
          volume: row.volume,
          competition: row.competition,
          competition_index: row.competition_index,
          cpc: row.low_cpc && row.high_cpc ? (row.low_cpc + row.high_cpc) / 2 : row.high_cpc || row.low_cpc || 0,
          cpc_low: row.low_cpc,
          cpc_high: row.high_cpc,
          cpc_currency: row.cpc_currency,
          cpc_original_currency: row.cpc_original_currency,
          cpc_to_thb_rate: row.cpc_to_thb_rate,
          cpc_rate_as_of: row.cpc_rate_as_of,
          cpc_rate_source: row.cpc_rate_source,
          monthly_trend: row.monthly_trend,
          source: 'exact',
        });
      }
    }
  } catch (err: any) {
    // Log the real error so we can diagnose; missing provider metrics stay blank.
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

  // Track batch failures so we can fail loud if Gemini is entirely down
  // (e.g. GCP_PROJECT_ID unset). Silently swallowing every batch produced a
  // "successful" plan built purely from rule-based fallbacks that still
  // reported QA PASS — the exact failure mode we are guarding against.
  let batchErrorCount = 0;
  let lastBatchError = '';

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
        const batchSeed = seeds[bi % Math.max(seeds.length, 1)] || niche;
        const seedSection = `\n### RESEARCH PILLARS / SEEDS\nUse the current focus "${batchSeed}" while keeping coverage balanced across: ${[...new Set(seeds)].slice(0, 20).join(', ')}\n`;
        const prompt = KEYWORD_RESEARCH_PROMPT(niche, batchSeed, need, [...excludeSet], alreadyFound, intentRatio, isKnowledgeMode, problemContext) + seedSection + siteSection;
        const { data, grounding } = await callGeminiWithGrounding(prompt, true, {
          functionLabel: 'keyword_research',
        });
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
        batchErrorCount++;
        lastBatchError = err?.message ?? String(err);
      }
    }));
  }

  // Fail loud if EVERY batch failed — the AI layer is down (bad/missing GCP
  // credentials, quota, network). Returning a rule-based fallback here is what
  // produced the "burger king / all-informational / QA PASS" garbage plan.
  if (batchErrorCount === totalBatches && totalBatches > 0) {
    throw new Error(
      `Gemini keyword expansion failed on all ${totalBatches} batches — aborting instead of emitting a low-quality fallback plan. ` +
      `Check GCP_PROJECT_ID / Vercel OIDC credentials. Last error: ${lastBatchError || 'unknown'}`
    );
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
  const kwWords = segmentWords(kwNorm, /[\u0E00-\u0E7F]/.test(kwNorm) ? 'th' : 'en');
  let bestMatch: { seed_keyword: string; seed_volume: number; score: number } | null = null;

  for (const [seed, vol] of seedVolumeMap.entries()) {
    const seedNorm = seed.replace(/\s+/g, ''); // strip spaces for Thai matching
    const seedWords = segmentWords(seed, /[\u0E00-\u0E7F]/.test(seed) ? 'th' : 'en');

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

    const plannerVolume = planner?.volume ?? null;
    const geminiEstimate = gk.volume_estimate ?? 0;
    // plannerDirectPool keywords carry _volume_source preset — honour it over plannerMap lookup
    const volume_source: PipelineKeyword['volume_source'] =
      gk._volume_source ? gk._volume_source :
      (planner?.source === 'exact' && plannerVolume > 0) ? 'keyword_planner' :
      (planner?.source === 'close_variant' && plannerVolume > 0) ? 'planner_variant' :
      (planner?.source === 'dataforseo' && plannerVolume > 0) ? 'dataforseo' :
      'gemini_estimated';
    const hasDirectMetric = isDirectMetricSource(volume_source) && plannerVolume !== null && plannerVolume > 0;
    const volume = hasDirectMetric ? plannerVolume : 0;
    const estimatedVolume = !hasDirectMetric && geminiEstimate > 0 ? geminiEstimate : undefined;
    const competition = hasDirectMetric ? (planner?.competition ?? 'UNSPECIFIED') : 'UNSPECIFIED';
    const competition_index = hasDirectMetric ? (planner?.competition_index ?? 0) : 0;

    // Find short-tail KP parent so long-tail keywords show their volume context
    const seedParent = volume_source === 'gemini_estimated'
      ? findSeedParent(gk.keyword, seedVolumeMap)
      : null;

    const content_type = resolveContentType(intent);
    const { score, priority } = computeOpportunity(
      volume,
      intent,
      keyword_type,
      gk.keyword,
      planner?.organic_difficulty,
      competition_index
    );

    const cpcLow = hasDirectMetric ? (planner?.cpc_low ?? 0) : 0;
    const cpcHigh = hasDirectMetric ? (planner?.cpc_high ?? 0) : 0;
    const rawCpc = hasDirectMetric
      ? (planner?.cpc ?? (cpcLow && cpcHigh ? (cpcLow + cpcHigh) / 2 : cpcHigh || cpcLow || 0))
      : undefined;
    const cpc = typeof rawCpc === 'number' && rawCpc > 0 ? rawCpc : undefined;
    const cpcCurrency = hasDirectMetric ? (planner?.cpc_currency ?? 'THB') : undefined;
    const cpcOriginalCurrency = hasDirectMetric
      ? (planner?.cpc_original_currency ?? (volume_source === 'dataforseo' ? 'USD' : undefined))
      : undefined;
    const metricConfidence: PipelineKeyword['metric_confidence'] =
      volume_source === 'keyword_planner' || volume_source === 'dataforseo' ? 'high' :
      volume_source === 'planner_variant' ? 'medium' : 'low';

    return {
      keyword: gk.keyword,
      volume,
      estimated_volume: estimatedVolume,
      volume_source,
      competition,
      competition_index,
      organic_difficulty: planner?.organic_difficulty,
      cpc,
      cpc_low: cpcLow || undefined,
      cpc_high: cpcHigh || undefined,
      cpc_currency: cpcCurrency,
      cpc_original_currency: cpcOriginalCurrency,
      cpc_to_thb_rate: hasDirectMetric ? planner?.cpc_to_thb_rate : undefined,
      cpc_rate_as_of: hasDirectMetric ? planner?.cpc_rate_as_of : undefined,
      cpc_rate_source: hasDirectMetric ? planner?.cpc_rate_source : undefined,
      monthly_trend: hasDirectMetric && Array.isArray(planner?.monthly_trend) ? planner.monthly_trend : undefined,
      metric_source: volume_source,
      metric_as_of: new Date().toISOString().slice(0, 10),
      metric_confidence: metricConfidence,
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

function attachSupportingSuggestions(
  keywords: PipelineKeyword[],
  language: string
): PipelineKeyword[] {
  const primaryKeywords = keywords.filter(keyword => isDirectMetricSource(keyword.volume_source));
  const suggestions = keywords.filter(keyword => !isDirectMetricSource(keyword.volume_source));
  const primaryByName = new Map(primaryKeywords.map(keyword => [normalize(keyword.keyword), keyword]));

  for (const suggestion of suggestions) {
    let parent = suggestion.seed_keyword
      ? primaryByName.get(normalize(suggestion.seed_keyword))
      : undefined;

    if (!parent) {
      let best: { keyword: PipelineKeyword; score: number } | undefined;
      for (const candidate of primaryKeywords) {
        const directSubstring = normalize(suggestion.keyword).includes(normalize(candidate.keyword)) ? 1 : 0;
        const score = Math.max(
          directSubstring,
          tokenSimilarity(suggestion.keyword, candidate.keyword, language === 'th' ? 'th' : 'en')
        );
        if (!best || score > best.score) best = { keyword: candidate, score };
      }
      if (best && best.score >= 0.2) parent = best.keyword;
    }

    suggestion.topic_cluster_role = 'supporting_keyword';
    if (!parent) continue;
    suggestion.primary_keyword = parent.keyword;
    parent.secondary_keywords = [...new Set([...(parent.secondary_keywords ?? []), suggestion.keyword])];
    suggestion.notes = suggestion.notes
      ? `${suggestion.notes} | Supporting keyword for ${parent.keyword}`
      : `Supporting keyword for ${parent.keyword}`;
  }

  return primaryKeywords;
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

    // Few-shot (zero extra cost): reuse the top-5 competitor titles already
    // fetched in Step 3c so the model differentiates against what actually ranks.
    // Skip forum/social results so they're never held up as good examples.
    const BANNED_SERP_DOMAIN = /(pantip|sanook|wongnai|reddit|quora|twitter|facebook|youtube|tiktok|blockdit|medium)/i;
    const fewShotEntries = batch
      .filter(kw => kw.competitors && kw.competitors.length > 0)
      .map(kw => ({
        keyword: cleanKeywordForTitle(kw.keyword),
        competitorTitles: kw.competitors!
          .filter(c => !BANNED_SERP_DOMAIN.test(c.domain))
          .map(c => c.title),
      }));
    const fewShot = buildSerpFewShotBlock(fewShotEntries);
    if (fewShot) prompt = `${fewShot}\n\n${prompt}`;

    const BACKOFFS = [1000, 2000];
    let lastErr: any = null;
    let succeeded = false;

    for (let attempt = 0; attempt <= BACKOFFS.length; attempt++) {
      try {
        const result = await callGemini(prompt, {
          functionLabel: hasProblemContext
            ? 'problem_first_title_generation'
            : 'seo_title_generation',
        });
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
      : segmentWords(kw.keyword, /[\u0E00-\u0E7F]/.test(kw.keyword) ? 'th' : 'en')
          .some(w => w.length > 1 && titleLower.includes(w.toLowerCase()));

    if (ai && title && !isForbidden && hasKeyword) {
      // Independent, deterministic quality check (the AI's own seo/aeo/ctr scores
      // are self-reported). Additive: recorded in title_notes, no effect on which
      // titles are accepted vs. fall back.
      const quality = scoreTitle(title, kw.keyword, kw.intent);
      const qualityNote = quality.issues.length
        ? `คุณภาพ ${quality.score}/100: ${quality.issues.join('; ')}`
        : `คุณภาพ ${quality.score}/100`;
      return {
        ...kw,
        title,
        aeo_question: ai.aeo_question || `${cleanKeywordForTitle(kw.keyword)} คืออะไร และควรรู้อะไรบ้าง?`,
        seo_score: ai.seo_score || 0,
        aeo_score: ai.aeo_score || 0,
        ai_search_score: ai.ai_search_score || 0,
        ctr_score: ai.ctr_score || 0,
        title_quality_score: quality.score,
        title_notes: ai.notes ? `${ai.notes} | ${qualityNote}` : qualityNote,
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
  requestedCount: number,
  candidateCount: number,
  metricMode: KeywordMetricMode,
  warnings: string[]
): PipelineResult {
  const geminiCost = getSessionUsage();
  const sources = summarizeMetricSources(keywords);
  const cost = {
    ...geminiCost,
    gemini_cost_usd: geminiCost.cost_usd,
    gemini_cost_thb: geminiCost.cost_thb,
    dfs_keywords_called: 0,
    dfs_cost_usd: 0,
    dfs_cost_thb: 0,
    kp_keywords_fetched: sources.planner,
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
      requested_count: requestedCount,
      candidate_count: candidateCount,
      metric_mode: metricMode,
      api_backed_count: sources.apiBacked,
      derived_count: sources.derived,
      estimated_count: sources.estimated,
      shortfall_count: Math.max(requestedCount - keywords.length, 0),
      cpc_currency: 'THB',
      planner_count: sources.planner,
      dataforseo_count: sources.dataForSeo,
      gemini_count: sources.estimated,
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
  const metricMode: KeywordMetricMode = input.metricMode === 'api_first' ? 'api_first' : 'api_only';
  const candidateTarget = getCandidateTarget(input.targetCount);
  // Strategy is fixed — not user-selectable.
  // Ranking order: problem keywords with volume → volume keywords → problem keywords without volume.
  const strategyMode: StrategyMode = 'hybrid';
  const aiSearchOpt = input.ai_search_optimization !== false;
  const excludeSet = new Set<string>((input.excludeKeywords || []).map(normalize));
  // Domain's existing ranked keywords (DFS ranked_keywords), keyed by normalized
  // keyword → current position; populated in Step 0.7, applied after the Step 3 merge.
  const RANKED_SEED_INJECT_CAP = 80;
  const rankedKeywordMap = new Map<string, { rankGroup: number | null; rankAbsolute: number | null; url: string | null }>();
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

  // ── Step 0.7: Domain ranked-keyword base seeds (DFS ranked_keywords) ─────────
  // If a site URL + DFS creds are available, pull the keywords the domain already
  // ranks for and (a) inject the strongest as extra seeds so Step 1 KP fetches their
  // exact volume, and (b) remember each one's current position so the final keywords
  // can be tagged with the domain's existing rank. Fully guarded: with no site_url or
  // no DFS creds this block is a no-op and the pipeline behaves exactly as before.
  if (input.site_url) {
    try {
      const { hasDataForSeoCreds, getRankedKeywordsForDomain } = await import('../services/dataForSeoService');
      if (hasDataForSeoCreds()) {
        log('[0.7/4] Fetching keywords the domain already ranks for (DFS ranked_keywords)...');
        const ranked = await getRankedKeywordsForDomain(input.site_url, { limit: 200 });
        if (ranked.keywords.length > 0) {
          for (const rk of ranked.keywords) {
            const key = normalize(rk.keyword);
            if (key && !rankedKeywordMap.has(key)) {
              rankedKeywordMap.set(key, { rankGroup: rk.rankGroup, rankAbsolute: rk.rankAbsolute, url: rk.url });
            }
          }
          // Inject strongest-ranked keywords as new seeds (they arrive ordered by best
          // rank first), deduped against excluded + already-present seeds.
          const seenSeeds = new Set<string>(input.seeds.map(normalize));
          const rankedSeeds = ranked.keywords
            .slice(0, RANKED_SEED_INJECT_CAP)
            .map(rk => rk.keyword)
            .filter(kw => {
              const n = normalize(kw);
              if (!n || excludeSet.has(n) || seenSeeds.has(n)) return false;
              seenSeeds.add(n);
              return true;
            });
          if (rankedSeeds.length > 0) {
            input = { ...input, seeds: [...input.seeds, ...rankedSeeds] };
          }
          log(`[0.7/4] Domain ranks for ${ranked.keywords.length} keywords → ${rankedSeeds.length} new base seeds injected (existing ranks captured for ${rankedKeywordMap.size})`);
        } else {
          log(`[0.7/4] No ranked keywords returned (${ranked.note})`);
        }
      }
    } catch (err: any) {
      log(`[0.7/4] Ranked-keyword base seeding skipped: ${err.message}`);
    }
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
    plannerMap = await fetchPlannerVolumes(allPlannerSeeds, input, warnings);
    log(`[1/4] Keyword Planner: ${plannerMap.size} keywords with real volume`);
    if (plannerMap.size === 0) warnings.push('Google Keyword Planner returned 0 results — DataForSEO will be tried next and missing provider metrics will remain blank');

    // Build seedVolumeMap — short-tail KP anchors for annotating long-tail estimates
    // Planner sometimes inserts spaces into Thai keywords (e.g. "ประกัน เดินทาง")
    // so we match both with and without spaces
    const stripSpaces = (s: string) => s.replace(/\s+/g, '');

    // 1. User-supplied seeds: look up in plannerMap with space-insensitive matching
    for (const userSeed of userSuppliedSeeds) {
      const wordCount = countWords(userSeed, /[\u0E00-\u0E7F]/.test(userSeed) ? 'th' : 'en');
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
      const wordCount = countWords(kw, /[\u0E00-\u0E7F]/.test(kw) ? 'th' : 'en');
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
    let kpOffTopicCount = 0;
    const offTopicSamples: string[] = [];
    // Relevance anchors: seed + niche + crawled site vocabulary. KP ideas that
    // share no token with this set (e.g. "burger king") are dropped.
    const relevanceAnchors = buildRelevanceAnchors(
      [...userSuppliedSeeds, ...expandedSeeds],
      input.niche,
      resolvedSiteContextSummary
    );
    const FORUM_BLOCK = /\b(pantip|sanook|wongnai|reddit|quora|twitter|facebook|youtube|tiktok|blockdit|medium)\b/i;
    for (const [kpKey, kpData] of plannerMap.entries()) {
      if (kpData.volume === 0) continue;
      if (FORUM_BLOCK.test(kpKey)) continue; // block forum/aggregator keywords
      const reason = offTopicReason(kpKey, relevanceAnchors);
      if (reason) {
        kpOffTopicCount++;
        if (offTopicSamples.length < 8) offTopicSamples.push(`${kpKey} (${reason})`);
        continue;
      }
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
    if (kpOffTopicCount > 0) {
      log(`[1/4] Filtered ${kpOffTopicCount} off-topic KP keywords: ${offTopicSamples.join(', ')}`);
      warnings.push(`กรองคีย์เวิร์ดนอกหัวข้อออก ${kpOffTopicCount} รายการ (เช่น ${offTopicSamples.slice(0, 3).join(', ')})`);
    }
  } else {
    log('[1/4] Keyword Planner: credentials not configured — direct KP metrics unavailable');
    warnings.push('GOOGLE_ADS_* credentials not set — unmatched Volume/CPC will remain blank');
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
  log(`[2/4] Expanding ${candidateTarget} candidates for ${input.targetCount} final keywords... [${modeLabel}] Info ${intentRatio.informational}% / Com ${intentRatio.commercial}% / Trans ${intentRatio.transactional}% / Nav ${intentRatio.navigational}% / Update ${intentRatio.update}%`);

  // Build cache key from stable inputs (skip cache on forceRefresh)
  const geminiCacheKey = input.forceRefresh
    ? undefined
    : buildGeminiCacheKey(
        input.niche,
        userSuppliedSeeds.slice(0, 20),
        candidateTarget,
        intentRatio,
        isKnowledgeMode
      );

  const geminiExpandResult = await expandWithGemini(
    input.seeds,
    input.niche,
    candidateTarget,
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
  let dfsKdCalled = 0;
  let dfsKdCostUsd = 0;
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
    // Only send concise primary-keyword candidates to the metric provider.
    // Long-tail ideas remain supporting suggestions and never borrow a shorter
    // keyword's volume.
    const needsVolume = geminiKeywords.filter(k => {
      const p = plannerMap.get(normalize(k.keyword));
      return (!p || p.volume === 0) && isMetricLookupCandidate(k.keyword, lang);
    });
    const skippedLongTail = geminiKeywords.filter(k => {
      const p = plannerMap.get(normalize(k.keyword));
      return (!p || p.volume === 0) && !isMetricLookupCandidate(k.keyword, lang);
    }).length;
    if (skippedLongTail > 0) {
      log(`[2.5/4] DataForSEO: skipped ${skippedLongTail} long-tail suggestions; no proxy volume will be assigned`);
    }

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
      toCall.sort((a, b) => countWords(a, lang) - countWords(b, lang));
      dfsCalled += toCall.length;
      const dfsEstUsd = toCall.length * 0.0003;
      log(`[2.5/4] DataForSEO: ${needsVolume.length} concise candidates → ${cacheHits} cache hits, ${toCall.length} exact lookups | est. $${dfsEstUsd.toFixed(4)} (฿${(dfsEstUsd * 34).toFixed(2)})`);

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

          const rawMap = await getDataForSeoVolumes(
            dfsKeywords,
            isThai ? 'th' : 'en',
            locationCode,
            warning => {
              if (!warnings.includes(warning)) warnings.push(warning);
            }
          );
          let dfsHits = 0;

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
              const dummy = {
                volume: 0,
                competition: 'UNSPECIFIED' as const,
                competition_index: 0,
                cpc: 0,
                cpc_currency: 'THB' as const,
                cpc_original_currency: 'USD' as const,
                cpc_conversion_available: true,
                source: 'dataforseo' as const,
              };
              writeDFSCache(kw, dummy, kwMeta?.keyword_type ?? 'default', kwMeta?.intent ?? 'informational');
            }
          }
          log(`[2.5/4] DataForSEO: ${dfsHits}/${toCall.length} exact keywords enriched`);
        } catch (err: any) {
          log(`[2.5/4] DataForSEO error: ${err.message} — provider metrics will remain blank`);
        }
      }
    }
  }

  // ── Step 2.55: KP exact metrics for concise keywords still missing volume ───
  if (hasPlannerCreds && input.useKeywordPlanner !== false) {
    const stillNoVolume = geminiKeywords.filter(k => {
      const p = plannerMap.get(normalize(k.keyword));
      return (!p || p.volume === 0) && isMetricLookupCandidate(k.keyword, lang);
    });
    // Cap at 600 to stay within the existing API throughput boundary.
    const kpHistoricalBatch = stillNoVolume.slice(0, 600);
    if (kpHistoricalBatch.length > 0) {
      log(`[2.55/4] KP historical: ${kpHistoricalBatch.length}/${stillNoVolume.length} keywords → querying Keyword Planner (parallel)`);
      try {
        const { getHistoricalMetrics, loadGoogleAdsConfig, getAccessToken } = await import('../services/googleKeywordPlannerService');
        const kpConfig = loadGoogleAdsConfig();
        if (kpConfig) {
          const accessToken = await getAccessToken(kpConfig);
          const kpMetrics = await getHistoricalMetrics(
            kpHistoricalBatch.map(k => k.keyword),
            kpConfig,
            accessToken,
            input.targetLanguage || 'th',
            'Thailand',
            warning => {
              if (!warnings.includes(warning)) warnings.push(warning);
            }
          );
          let kpHits = 0;
          for (const [kw, metric] of kpMetrics.entries()) {
            if (metric.volume > 0) {
              plannerMap.set(normalize(kw), {
                volume: metric.volume,
                competition: metric.competition,
                competition_index: metric.competition_index,
                cpc: metric.cpc,
                cpc_low: metric.cpc_low,
                cpc_high: metric.cpc_high,
                cpc_currency: metric.cpc_currency,
                cpc_original_currency: metric.cpc_original_currency,
                cpc_to_thb_rate: metric.cpc_to_thb_rate,
                cpc_rate_as_of: metric.cpc_rate_as_of,
                cpc_rate_source: metric.cpc_rate_source,
                source: metric.source,
              });
              kpHits++;
            }
          }
          log(`[2.55/4] KP historical: ${kpHits}/${kpHistoricalBatch.length} enriched`);
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
  // Tag keywords the domain already ranks for (from Step 0.7) with their current position.
  if (rankedKeywordMap.size > 0) {
    let taggedRank = 0;
    for (const kw of merged) {
      const rankInfo = rankedKeywordMap.get(normalize(kw.keyword));
      if (rankInfo) {
        kw.existing_rank = rankInfo.rankGroup ?? rankInfo.rankAbsolute ?? undefined;
        kw.existing_rank_url = rankInfo.url ?? undefined;
        kw.existing_rank_source = 'dfs_ranked_keywords';
        kw.is_base_seed = true;
        taggedRank++;
      }
    }
    if (taggedRank > 0) log(`[3/4] Tagged ${taggedRank} keywords with the domain's existing rank`);
  }
  const candidateCount = merged.length;
  const candidateSources = summarizeMetricSources(merged);
  const plannerCount = candidateSources.planner;
  const dfsCount = candidateSources.dataForSeo;
  const geminiCount = candidateSources.estimated;
  log(`[3/4] Merged: ${merged.length} candidates (${plannerCount} KP exact, ${dfsCount} DFS exact, ${candidateSources.derived} derived, ${geminiCount} suggestions)`);

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
    if (isDirectMetricSource(kw.volume_source)) {
      kw.intent_bucket_score = (kw.intent_bucket_score ?? 0) + 15;
      kw.priority_score = (kw.priority_score ?? 0) + 15;
    }
  }

  // Select exact API-backed keywords first. The previous implementation capped
  // them at 60%, which forced estimates into otherwise healthy result sets.
  const directMetricKeywords = merged
    .filter(keyword => isDirectMetricSource(keyword.volume_source) && keyword.volume > 0)
    .sort((a, b) => b.volume - a.volume);
  const supportingSuggestions = merged.filter(keyword => !isDirectMetricSource(keyword.volume_source));
  const selectedDirect = applyIntentBucketAllocation(
    directMetricKeywords,
    intentRatio,
    input.presetKey ?? 'preset1',
    input.targetCount
  );

  let allocated: PipelineKeyword[] = selectedDirect;
  const remainingTarget = input.targetCount - selectedDirect.length;
  if (metricMode === 'api_first' && remainingTarget > 0) {
    const selectedSuggestions = applyIntentBucketAllocation(
      supportingSuggestions,
      intentRatio,
      input.presetKey ?? 'preset1',
      remainingTarget
    );
    allocated = [...selectedDirect, ...selectedSuggestions];
    if (selectedSuggestions.length > 0) {
      warnings.push(`${selectedSuggestions.length} supporting keyword suggestions have no direct API Volume/CPC; provider columns are intentionally blank`);
    }
  }

  if (selectedDirect.length < input.targetCount) {
    const shortage = input.targetCount - selectedDirect.length;
    warnings.push(`พบ Keyword ที่มี Volume API จริง ${selectedDirect.length}/${input.targetCount} คำ (ขาด ${shortage} คำ)`);
    if (metricMode === 'api_only') {
      warnings.push('โหมดเฉพาะข้อมูลจริงจะไม่เติม Keyword หรือ Volume ประมาณเพื่อให้ครบจำนวน');
    }
  }

  merged.length = 0;
  merged.push(...(allocated as Array<PipelineKeyword & { _title_pending: true }>));
  log(`[3b/4] Metric selection: ${selectedDirect.length} API-backed + ${merged.length - selectedDirect.length} supporting suggestions (${metricMode})`);

  // Organic KD is checked only for the selected output, not the entire raw
  // candidate pool, to keep DataForSEO cost proportional to the requested size.
  if (input.mode === 'full_plan' && hasDataForSeoCreds() && merged.length > 0) {
    log(`[3b/4] Organic KD: checking ${merged.length} selected keywords with DataForSEO Labs...`);
    try {
      const { getDataForSeoKeywordDifficulty } = await import('../services/dataForSeoService');
      const kdResult = await getDataForSeoKeywordDifficulty(
        merged.map(keyword => keyword.keyword),
        lang === 'th' ? 'th' : 'en',
        lang === 'th' ? 2764 : 2840
      );
      dfsKdCalled = kdResult.calledKeywords;
      dfsKdCostUsd = kdResult.costUsd;
      let kdHits = 0;
      for (const kw of merged) {
        const exact = kdResult.metrics.get(kw.keyword.toLowerCase().trim());
        const noSpace = kdResult.metrics.get(kw.keyword.toLowerCase().replace(/\s+/g, ''));
        const difficulty = exact ?? noSpace;
        if (typeof difficulty !== 'number') continue;
        kw.organic_difficulty = difficulty;
        const opportunity = computeOpportunity(
          kw.volume,
          kw.intent,
          kw.keyword_type,
          kw.keyword,
          difficulty,
          kw.competition_index
        );
        kw.opportunity_score = opportunity.score;
        kw.priority = opportunity.priority;
        kw.priority_score = Math.round((kw.priority_score ?? opportunity.score) * 0.8 + opportunity.score * 0.2);
        kdHits++;
      }
      log(`[3b/4] Organic KD: ${kdHits}/${merged.length} matched (cost $${dfsKdCostUsd.toFixed(4)})`);
    } catch (err: any) {
      warnings.push(`Organic KD unavailable: ${err.message}`);
      log(`[3b/4] Organic KD skipped: ${err.message}`);
    }
  }

  // ── Step 3c: SERP rank + top-5 competitors + multi-layer validation ──────────
  // Runs only for a site + full_plan + DFS creds, and only on the strongest selected
  // keywords (capped) so SERP cost stays proportional. L1 (DFS SERP) is the source of
  // truth; L2 (existing_rank from Step 0.7) cross-checks; a low-confidence result
  // triggers at most ONE re-fetch. Fully guarded → no site_url/creds = no-op.
  if (input.site_url && input.mode === 'full_plan' && hasDataForSeoCreds() && merged.length > 0) {
    try {
      const { getSerpTop } = await import('../services/dataForSeoService');
      const { buildRankAnalysis } = await import('./rankValidation');
      const SERP_RANK_MAX = 60;
      const serpOpts = {
        languageCode: lang === 'th' ? 'th' : 'en',
        locationCode: lang === 'th' ? 2764 : 2840,
      };
      // Prefer keywords the domain already ranks for, then highest priority.
      const rankTargets = [...merged]
        .sort((a, b) => {
          const aBase = a.is_base_seed ? 1 : 0;
          const bBase = b.is_base_seed ? 1 : 0;
          if (aBase !== bBase) return bBase - aBase;
          return (b.priority_score ?? 0) - (a.priority_score ?? 0);
        })
        .slice(0, SERP_RANK_MAX);
      log(`[3c/4] SERP rank check: ${rankTargets.length}/${merged.length} keywords (cap ${SERP_RANK_MAX})...`);
      let serpCalls = 0;
      let refetches = 0;
      let top5Hits = 0;
      let lowConf = 0;
      for (const kw of rankTargets) {
        if (checkAbort()) break;
        const targetDomain = input.site_url;
        let serp = await getSerpTop(kw.keyword, serpOpts);
        serpCalls++;
        let analysis = buildRankAnalysis({
          keyword: kw.keyword,
          serpResults: serp.results,
          targetDomain,
          rankedKeywordRank: kw.existing_rank ?? null,
          // L3 grounding intentionally omitted: Gemini grounding returns Vertex redirect
          // URLs, not resolvable publisher domains, so it cannot corroborate a domain.
        });
        // Bounded reconciliation: at most one re-fetch when confidence is low.
        if (analysis.needsRefetch) {
          serp = await getSerpTop(kw.keyword, serpOpts);
          serpCalls++;
          refetches++;
          analysis = buildRankAnalysis({
            keyword: kw.keyword,
            serpResults: serp.results,
            targetDomain,
            rankedKeywordRank: kw.existing_rank ?? null,
          });
        }
        kw.site_rank = analysis.siteRank;
        kw.rank_in_top5 = analysis.inTop5;
        kw.rank_confidence = analysis.rankConfidence;
        kw.rank_source = 'dfs_serp';
        kw.rank_checked_at = analysis.checkedAt;
        kw.competitors = analysis.top5Competitors;
        if (analysis.inTop5) top5Hits++;
        if (analysis.rankConfidence === 'low') lowConf++;
      }
      log(`[3c/4] SERP rank: ${serpCalls} calls (${refetches} re-fetch), ${top5Hits} in top-5, ${lowConf} low-confidence`);
      if (lowConf > 0) {
        warnings.push(`${lowConf} keyword มีความมั่นใจอันดับต่ำ (L1/L2 ขัดกัน) — ตรวจซ้ำแล้วยึด SERP จริงเป็นค่าหลัก`);
      }
    } catch (err: any) {
      warnings.push(`SERP rank check unavailable: ${err.message}`);
      log(`[3c/4] SERP rank check skipped: ${err.message}`);
    }
  }

  // ── Abort after step 3 ───────────────────────────────────────────────────────
  if (checkAbort()) {
    log(`Stopped — returning ${merged.length} keywords without titles`);
    const partial = merged.map(k => ({ ...k, title: k.keyword, aeo_question: '', seo_score: 0, aeo_score: 0, ai_search_score: 0, ctr_score: 0, title_notes: '' })) as PipelineKeyword[];
    return makePartialResult(partial, input.targetCount, candidateCount, metricMode, warnings);
  }

  // ── Step 4+6: Title generation + Clustering + Article grouping in parallel ──
  log('[4/4] Generating titles + clustering + article grouping in parallel...');
  const runArticleGrouping = hasProblemContext; // always true except volume_first (already filtered above)

  const [titleMap, clusters, articleGroupMap] = await Promise.all([
    generateAiTitles(merged, input.businessContext, input.category, lang, log, aiSearchOpt, warnings),
    clusterKeywords(merged as any, input.niche, log),
    runArticleGrouping
      ? runArticleGroupingDecisionEngine(
          merged.map(k => ({
            keyword: k.keyword,
            intent: k.intent,
            volume: k.volume,
            journey_stage: k.journey_stage,
            keyword_group: k.keyword_group,
            parent_topic: k.parent_topic,
            topic_cluster_role: k.topic_cluster_role,
          })),
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
    return makePartialResult(final, input.targetCount, candidateCount, metricMode, warnings);
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
  const dfsVolumeCostUsd = dfsCalled * DFS_PRICE_PER_KW;
  const dfsCostUsd = dfsVolumeCostUsd + dfsKdCostUsd;
  const dfsCostThb = dfsCostUsd * USD_TO_THB;
  const dfsKdCostThb = dfsKdCostUsd * USD_TO_THB;
  const totalCostUsd = geminiCost.cost_usd + dfsCostUsd;
  const totalCostThb = geminiCost.cost_thb + dfsCostThb;

  log(`Done: ${final.length} keywords | KP: ${plannerCount} (฿0) | DFS: ${dfsCount} + KD ${dfsKdCalled} ($${dfsCostUsd.toFixed(4)}/฿${dfsCostThb.toFixed(2)}) | Gemini: $${geminiCost.cost_usd.toFixed(4)}/฿${geminiCost.cost_thb.toFixed(2)} | Total: $${totalCostUsd.toFixed(4)}/฿${totalCostThb.toFixed(2)}`);

  const cost = {
    ...geminiCost,
    gemini_cost_usd: geminiCost.cost_usd,
    gemini_cost_thb: geminiCost.cost_thb,
    dfs_keywords_called: dfsCalled,
    dfs_kd_keywords_called: dfsKdCalled,
    dfs_cost_usd: dfsCostUsd,
    dfs_cost_thb: dfsCostThb,
    dfs_kd_cost_usd: dfsKdCostUsd,
    dfs_kd_cost_thb: dfsKdCostThb,
    kp_keywords_fetched: plannerCount,
    kp_cost_usd: 0,
    kp_cost_thb: 0,
    total_cost_usd: totalCostUsd,
    total_cost_thb: totalCostThb,
  };

  const planPrimaryKeywords = attachSupportingSuggestions(final, lang);
  const supportingOnlyCount = final.length - planPrimaryKeywords.length;
  if (supportingOnlyCount > 0) {
    warnings.push(`${supportingOnlyCount} Keyword suggestions were kept as Secondary Keywords and were not scheduled as Primary Keywords`);
  }

  const plan = input.mode === 'full_plan'
    ? buildContentPlan(planPrimaryKeywords, clusters, {
        mode: 'full_plan',
        months: Math.min(Math.max(input.planMonths ?? 12, 1), 12),
        articlesPerMonth: Math.min(Math.max(input.articlesPerMonth ?? 12, 1), 50),
        startMonth: input.planStartMonth || new Date().toISOString().slice(0, 7),
        niche: input.niche,
        siteUrl: input.site_url,
        pillars: input.planPillars,
      })
    : undefined;

  if (plan) {
    const itemLookup = new Map(plan.contentItems.map(item => [normalize(item.primaryKeyword), item]));
    for (const keyword of final) {
      const item = itemLookup.get(normalize(keyword.keyword));
      if (!item) continue;
      keyword.parent_topic = item.pillar;
      keyword.internal_link_target = item.moneyPage || item.internalLinks[0];
      keyword.suggested_anchor_text = item.suggestedAnchorText;
    }
    warnings.push(...plan.qa.warnings.map(warning => `Content plan: ${warning}`));
  }

  const finalSources = summarizeMetricSources(final);

  return {
    keywords: final,
    clusters,
    plan,
    meta: {
      total: final.length,
      requested_count: input.targetCount,
      candidate_count: candidateCount,
      metric_mode: metricMode,
      api_backed_count: finalSources.apiBacked,
      derived_count: finalSources.derived,
      estimated_count: finalSources.estimated,
      shortfall_count: Math.max(input.targetCount - final.length, 0),
      cpc_currency: 'THB',
      planner_count: finalSources.planner,
      dataforseo_count: finalSources.dataForSeo,
      gemini_count: finalSources.estimated,
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
