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
import { buildSeoTitleAiPrompt } from '../skills/seoTitleAiSkill';
import type { TitleRequest, TitleAiResult } from '../skills/seoTitleAiSkill';
import { KEYWORD_RESEARCH_PROMPT } from '../skills/keywordResearchSkill';
import { clusterKeywords } from '../skills/topicClusterSkill';
import type { ClusterResult } from '../skills/topicClusterSkill';
import { DEFAULT_RATIO as DEFAULT_INTENT_RATIO } from '../skills/intentRatioSkill';
import type { IntentRatio } from '../skills/intentRatioSkill';

export type { IntentRatio };
export { DEFAULT_INTENT_RATIO };

// ─── Types ─────────────────────────────────────────────────────────────────────

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
}

export interface PipelineKeyword {
  keyword: string;
  volume: number;                // real (from Planner) or estimated (from Gemini)
  volume_source: 'keyword_planner' | 'gemini_estimated';
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
}

export interface PipelineResult {
  keywords: PipelineKeyword[];
  clusters: ClusterResult;
  meta: {
    total: number;
    planner_count: number;
    gemini_count: number;
    title_ai_count: number;
    fallback_title_count: number;
    cluster_count: number;
    warnings: string[];
    generated_at: string;
    cost: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      cost_usd: number;
      cost_thb: number;
    };
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function normalize(kw: string) {
  return kw.trim().toLowerCase().replace(/\s+/g, ' ');
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

  const raw =
    volScore * 10 * 0.30 +
    (intentVal[intent] ?? 5) * 10 * 0.25 +
    (intentVal[intent] ?? 5) * 10 * 0.20 +
    (typeVal[keyword_type] ?? 5) * 10 * 0.15 +
    gap * 10 * 0.10 - diff;

  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const priority: 'high' | 'medium' | 'low' = score >= 80 ? 'high' : score >= 60 ? 'medium' : 'low';
  return { score, priority };
}

const TITLE_BATCH_SIZE = 50;

// ─── Step 1: Google Keyword Planner ───────────────────────────────────────────

async function fetchPlannerVolumes(
  seeds: string[],
  input: PipelineInput
): Promise<Map<string, { volume: number; competition: string; competition_index: number }>> {
  const map = new Map<string, any>();
  try {
    const { getKeywordPlannerRows } = await import('../services/googleKeywordPlannerService');
    const result = await getKeywordPlannerRows({
      seed_keywords: seeds,
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
  } catch {
    // Keyword Planner unavailable — will fall back to Gemini estimates
  }
  return map;
}

async function enrichWithHistoricalMetrics(
  keywords: string[],
  plannerMap: Map<string, any>,
  input: PipelineInput,
  log: (msg: string) => void
): Promise<void> {
  const missing = keywords.filter(kw => !plannerMap.has(normalize(kw)));
  if (missing.length === 0) return;

  try {
    const { loadGoogleAdsConfig, getAccessToken, getHistoricalMetrics } = await import('../services/googleKeywordPlannerService');
    const config = loadGoogleAdsConfig();
    if (!config) return;

    const accessToken = await getAccessToken(config);
    log(`[2.5/4] Fetching Keyword Planner volume for ${missing.length} Gemini-discovered keywords...`);

    const metricsMap = await getHistoricalMetrics(missing, config, accessToken, input.targetLanguage || 'th', 'Thailand');

    let enriched = 0;
    for (const [kw, metrics] of metricsMap.entries()) {
      plannerMap.set(kw, metrics);
      enriched++;
    }
    log(`[2.5/4] Enriched ${enriched}/${missing.length} keywords with real Planner volume`);
  } catch (err: any) {
    log(`[2.5/4] Historical metrics skipped: ${err.message}`);
  }
}

// ─── Step 2: Gemini keyword expansion ─────────────────────────────────────────

async function expandWithGemini(
  seeds: string[],
  niche: string,
  targetCount: number,
  excludeSet: Set<string>,
  onProgress: (msg: string) => void,
  intentRatio: IntentRatio = DEFAULT_INTENT_RATIO,
  isKnowledgeMode = false
): Promise<Array<{ keyword: string; volume_estimate: number; competition: string; intent: string; keyword_type: string; content_type: string }>> {
  const BATCH = 50;
  const PARALLEL = 3; // run up to 3 batches concurrently
  const totalBatches = Math.ceil(targetCount / BATCH);
  const allResults: any[][] = new Array(totalBatches).fill(null);

  onProgress(`WordGod: running ${totalBatches} keyword batches (${PARALLEL} parallel)...`);

  // Run in parallel waves
  for (let wave = 0; wave < totalBatches; wave += PARALLEL) {
    const waveIndexes = Array.from({ length: Math.min(PARALLEL, totalBatches - wave) }, (_, i) => wave + i);

    // snapshot of already-found keywords at wave start (for dedup prompt)
    const alreadyFound = allResults.flat().filter(Boolean).map((k: any) => k.keyword);

    await Promise.all(waveIndexes.map(async (bi) => {
      const need = bi === totalBatches - 1
        ? targetCount - bi * BATCH
        : BATCH;
      try {
        const prompt = KEYWORD_RESEARCH_PROMPT(niche, seeds[0], need, [...excludeSet], alreadyFound, intentRatio, isKnowledgeMode);
        const result = await callGeminiWithGrounding(prompt);
        allResults[bi] = result.keywords || [];
        onProgress(`WordGod batch ${bi + 1}/${totalBatches}: ${allResults[bi].length} keywords`);
      } catch (err: any) {
        onProgress(`WordGod batch ${bi + 1} error: ${err.message}`);
        allResults[bi] = [];
      }
    }));
  }

  // Merge, deduplicate, classify
  const collected: any[] = [];
  for (const batch of allResults) {
    for (const kw of (batch || [])) {
      if (!kw?.keyword) continue;
      const norm = normalize(kw.keyword);
      if (!excludeSet.has(norm) && collected.length < targetCount) {
        excludeSet.add(norm);
        const intent = kw.intent ? kw.intent.toLowerCase() : classifyIntent(kw.keyword);
        const keyword_type = classifyKeywordType(kw.keyword);
        collected.push({
          keyword: kw.keyword,
          volume_estimate: kw.volume_estimate || 0,
          competition: kw.competition || 'UNSPECIFIED',
          intent,
          keyword_type,
          content_type: resolveContentType(intent),
        });
      }
    }
  }

  onProgress(`WordGod: collected ${collected.length} unique keywords`);
  return collected;
}

// ─── Step 3: Merge Planner + Gemini ───────────────────────────────────────────

function mergeKeywords(
  geminiKeywords: any[],
  plannerMap: Map<string, any>
): Array<PipelineKeyword & { _title_pending: true }> {
  return geminiKeywords.map(gk => {
    const norm = normalize(gk.keyword);
    const planner = plannerMap.get(norm);
    const intent = gk.intent || classifyIntent(gk.keyword);
    const keyword_type = gk.keyword_type || classifyKeywordType(gk.keyword);

    const volume = planner?.volume ?? gk.volume_estimate ?? 0;
    const competition = planner?.competition ?? gk.competition ?? 'UNSPECIFIED';
    const competition_index = planner?.competition_index ?? 0;
    const volume_source = planner ? 'keyword_planner' : 'gemini_estimated';

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
      // placeholders — filled by AI title step
      title: '',
      aeo_question: '',
      seo_score: 0,
      aeo_score: 0,
      ai_search_score: 0,
      ctr_score: 0,
      title_notes: '',
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
  onProgress: (msg: string) => void
): Promise<Map<string, TitleAiResult>> {
  const resultMap = new Map<string, TitleAiResult>();
  const batches: PipelineKeyword[][] = [];

  for (let i = 0; i < keywords.length; i += TITLE_BATCH_SIZE) {
    batches.push(keywords.slice(i, i + TITLE_BATCH_SIZE));
  }

  onProgress(`Title AI: writing ${keywords.length} titles in ${batches.length} parallel batches...`);

  // Run all title batches in parallel for maximum speed
  await Promise.all(batches.map(async (batch, bi) => {
    const requests: TitleRequest[] = batch.map(kw => ({
      keyword: kw.keyword,
      volume: kw.volume,
      competition: kw.competition,
      intent: kw.intent,
      keyword_type: kw.keyword_type,
      content_type: kw.content_type,
      business_context: businessContext,
      category,
    }));

    try {
      const prompt = buildSeoTitleAiPrompt(requests, targetLanguage);
      const result = await callGemini(prompt);
      const titles: TitleAiResult[] = result.titles || [];
      for (const t of titles) {
        if (t.keyword) resultMap.set(normalize(t.keyword), t);
      }
      onProgress(`Title batch ${bi + 1}/${batches.length}: ${titles.length} titles done`);
    } catch (err: any) {
      onProgress(`Title batch ${bi + 1} error: ${err.message}`);
    }
  }));

  return resultMap;
}

// ─── Step 5: Apply titles + score ─────────────────────────────────────────────

function applyTitles(
  keywords: PipelineKeyword[],
  titleMap: Map<string, TitleAiResult>
): { keywords: PipelineKeyword[]; fallbackCount: number } {
  let fallbackCount = 0;

  const FORBIDDEN = ['ดีที่สุด', 'อันดับ 1', '100%', 'การันตี', 'เห็นผลแน่นอน', 'ผ่านแน่นอน', 'รับประกัน'];

  const updated = keywords.map(kw => {
    const ai = titleMap.get(normalize(kw.keyword));
    const title = ai?.title || '';
    const isForbidden = FORBIDDEN.some(f => title.includes(f));
    const hasKeyword = kw.keyword.split(/\s+/).some(w => title.toLowerCase().includes(w.toLowerCase()));

    if (ai && title && !isForbidden && hasKeyword) {
      return {
        ...kw,
        title,
        aeo_question: ai.aeo_question || '',
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
  const cost = getSessionUsage();
  return {
    keywords,
    clusters: { clusters: [], ungrouped: [] },
    meta: {
      total: keywords.length,
      planner_count: plannerCount,
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
  const excludeSet = new Set<string>((input.excludeKeywords || []).map(normalize));
  input.seeds.forEach(s => excludeSet.add(normalize(s)));

  const checkAbort = () => sig?.aborted ?? false;

  // ── Step 1: Keyword Planner ──────────────────────────────────────────────────
  log('[1/4] Fetching Keyword Planner volumes...');
  let plannerMap = new Map<string, any>();
  const hasPlannerCreds = !!(
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
    process.env.GOOGLE_ADS_CLIENT_ID &&
    process.env.GOOGLE_ADS_REFRESH_TOKEN &&
    process.env.GOOGLE_ADS_CUSTOMER_ID
  );

  if (hasPlannerCreds && input.useKeywordPlanner !== false) {
    plannerMap = await fetchPlannerVolumes(input.seeds, input);
    log(`[1/4] Keyword Planner: ${plannerMap.size} keywords with real volume`);
    if (plannerMap.size === 0) warnings.push('Google Keyword Planner returned 0 results — using WordGod estimates only');
  } else {
    log('[1/4] Keyword Planner: credentials not configured — using WordGod AI estimates');
    warnings.push('GOOGLE_ADS_* credentials not set — volumes are WordGod AI estimates, not real data');
  }

  // ── Step 2: WordGod keyword expansion ───────────────────────────────────────
  const intentRatio: IntentRatio = input.intentRatio ?? DEFAULT_INTENT_RATIO;
  const isKnowledgeMode = input.presetKey === 'preset6';
  const modeLabel = isKnowledgeMode ? 'Knowledge Mode' : 'Standard';
  log(`[2/4] Expanding keywords with WordGod AI... [${modeLabel}] Info ${intentRatio.informational}% / Com ${intentRatio.commercial}% / Trans ${intentRatio.transactional}% / Nav ${intentRatio.navigational}% / Update ${intentRatio.update}%`);
  const geminiKeywords = await expandWithGemini(
    input.seeds,
    input.niche,
    input.targetCount,
    excludeSet,
    log,
    intentRatio,
    isKnowledgeMode
  );
  log(`[2/4] WordGod: found ${geminiKeywords.length} unique keywords`);
  if (geminiKeywords.length === 0) {
    warnings.push('WordGod returned 0 keywords — check API key and availability');
  }

  // ── Step 2.5: Enrich Gemini keywords with real Planner volume ───────────────
  if (hasPlannerCreds && input.useKeywordPlanner !== false && geminiKeywords.length > 0) {
    await enrichWithHistoricalMetrics(
      geminiKeywords.map(k => k.keyword),
      plannerMap,
      input,
      log
    );
  }

  // ── Step 3: Merge ────────────────────────────────────────────────────────────
  log('[3/4] Merging Keyword Planner + WordGod data...');
  const merged = mergeKeywords(geminiKeywords, plannerMap);
  merged.sort((a, b) => b.opportunity_score - a.opportunity_score);

  const plannerCount = merged.filter(k => k.volume_source === 'keyword_planner').length;
  const geminiCount = merged.filter(k => k.volume_source === 'gemini_estimated').length;
  log(`[3/4] Merged: ${merged.length} keywords (${plannerCount} with Planner volume, ${geminiCount} WordGod estimated)`);

  // ── Abort after step 3 ───────────────────────────────────────────────────────
  if (checkAbort()) {
    log(`Stopped — returning ${merged.length} keywords without titles`);
    const partial = merged.map(k => ({ ...k, title: k.keyword, aeo_question: '', seo_score: 0, aeo_score: 0, ai_search_score: 0, ctr_score: 0, title_notes: '' })) as PipelineKeyword[];
    return makePartialResult(partial, plannerCount, geminiCount, warnings);
  }

  // ── Step 4+6: Title generation & Clustering in parallel ─────────────────────
  log('[4/4] Generating titles + clustering in parallel...');

  const [titleMap, clusters] = await Promise.all([
    generateAiTitles(merged, input.businessContext, input.category, lang, log),
    clusterKeywords(merged as any, input.niche, log),
  ]);

  log(`[4/4] Titles: ${titleMap.size}/${merged.length} | Clusters: ${clusters.clusters.length}`);

  // ── Step 5: Apply titles ─────────────────────────────────────────────────────
  const { keywords: final, fallbackCount } = applyTitles(merged as any, titleMap);
  if (fallbackCount > 0) warnings.push(`${fallbackCount} titles used fallback (AI title failed quality check)`);

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

  const cost = getSessionUsage();
  log(`Done: ${final.length} keywords | ${clusters.clusters.length} clusters | Cost: $${cost.cost_usd.toFixed(4)} (฿${cost.cost_thb.toFixed(2)})`);

  return {
    keywords: final,
    clusters,
    meta: {
      total: final.length,
      planner_count: plannerCount,
      gemini_count: geminiCount,
      title_ai_count: titleMap.size,
      fallback_title_count: fallbackCount,
      cluster_count: clusters.clusters.length,
      warnings,
      generated_at: new Date().toISOString(),
      cost,
    },
  };
}
