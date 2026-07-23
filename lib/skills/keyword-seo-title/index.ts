/**
 * WordGod — Keyword Research & SEO Title Expert
 *
 * Main orchestrator. Accepts SkillInput, runs all sub-modules,
 * returns SkillOutput with CSV ready to export.
 *
 * Volume sources:
 *   google_keyword_planner_api → calls GoogleKeywordPlannerService
 *   manual | imported_csv | estimated → uses input data directly
 *
 * All API calls are server-side only. Never called from client components.
 */

import type {
  BusinessContext, EnrichedKeyword, KeywordPlannerRow,
  KeywordRow, SkillInput, SkillOutput, VolumeSource,
} from './types';
import {
  analyzeBusinessContext,
  buildCsvString,
  buildVolumeSourceNote,
  classifyKeywordType,
  classifySearchIntent,
  collectWarnings,
  deduplicateKeywords,
  generateSeoH1Title,
  normalizeVolume,
  resetPatternRotation,
  resolveContentType,
  scoreKeywordOpportunity,
  sortKeywordRows,
  validateTitleQuality,
} from './modules';

// ─── Seed Keyword Expander ────────────────────────────────────────────────────

function generateFromSeeds(seeds: string[], ctx: BusinessContext): Array<KeywordRow & { _missing: boolean }> {
  const expansions: Array<KeywordRow & { _missing: boolean }> = [];
  const questionPrefixes = ['คืออะไร', 'ดีไหม', 'ราคาเท่าไร', 'ใช้ยังไง', 'เหมาะกับใคร'];
  const commercialPrefixes = ['วิธีเลือก', 'ก่อนซื้อ', 'แนะนำ', 'ยี่ห้อไหนดี'];
  const problemPrefixes = ['ปัญหา', 'แก้', 'วิธีรักษา', 'สาเหตุ'];
  const comparisonPrefixes = ['เปรียบเทียบ', 'ต่างกันอย่างไร'];

  for (const seed of seeds) {
    expansions.push({ keyword: seed, volume: 0, source: 'estimated', _missing: true });
    for (const q of questionPrefixes.slice(0, 2)) {
      expansions.push({ keyword: `${seed} ${q}`, volume: 0, source: 'estimated', _missing: true });
    }
    for (const c of commercialPrefixes.slice(0, 2)) {
      expansions.push({ keyword: `${c} ${seed}`, volume: 0, source: 'estimated', _missing: true });
    }
    if (/beauty|health|visa|travel|skin/i.test(ctx.category)) {
      expansions.push({ keyword: `${seed}${problemPrefixes[0]}`, volume: 0, source: 'estimated', _missing: true });
    }
    expansions.push({ keyword: `${comparisonPrefixes[0]} ${seed}`, volume: 0, source: 'estimated', _missing: true });
  }
  return expansions;
}

// ─── Map Keyword Planner rows → internal rows ─────────────────────────────────

function mapPlannerRowsToInternal(rows: KeywordPlannerRow[]): Array<any> {
  return rows.map(r => ({
    keyword: r.keyword,
    volume: r.volume,
    source: 'google_keyword_planner_api' as VolumeSource,
    volume_missing: r.volume === 0,
    _missing: r.volume === 0,
    // pass-through extra metrics
    _competition: r.competition,
    _competition_index: r.competition_index,
    _low_cpc: r.low_cpc,
    _high_cpc: r.high_cpc,
    _cpc_currency: r.cpc_currency,
    _cpc_original_currency: r.cpc_original_currency,
    _cpc_to_thb_rate: r.cpc_to_thb_rate,
    _cpc_rate_as_of: r.cpc_rate_as_of,
    _cpc_rate_source: r.cpc_rate_source,
    _monthly_trend: r.monthly_trend,
  }));
}

// ─── Core enrichment pipeline (shared by all volume sources) ──────────────────

function enrichRows(rawRows: any[], ctx: BusinessContext): EnrichedKeyword[] {
  const normalizedRows = rawRows.map(r => {
    const { volume, missing } = normalizeVolume(r.volume ?? 0);
    const volume_missing = r._missing !== undefined ? r._missing : missing;
    return { ...r, volume, volume_missing, volume_source: r.source || 'manual' };
  });

  const dedupedRaw = deduplicateKeywords(normalizedRows as any);

  return dedupedRaw.map((row: any) => {
    const keyword = row.keyword;
    const intent = classifySearchIntent(keyword, ctx);
    const keyword_type = classifyKeywordType(keyword, ctx);
    const { score, priority } = scoreKeywordOpportunity({ keyword, volume: row.volume, intent, keyword_type }, ctx);
    const content_type = resolveContentType(intent);
    const title = generateSeoH1Title(keyword, intent, ctx);
    const title_valid = validateTitleQuality(title, keyword, intent);

    return {
      keyword,
      volume: row.volume,
      volume_source: row.volume_source || 'manual',
      volume_missing: row.volume_missing || false,
      intent,
      keyword_type,
      opportunity_score: score,
      priority,
      content_type,
      title,
      title_valid,
      notes: row.volume_missing ? 'Volume missing — set to 0' : '',
      competition: row._competition,
      competition_index: row._competition_index,
      low_cpc: row._low_cpc,
      high_cpc: row._high_cpc,
      cpc_currency: row._cpc_currency,
      cpc_original_currency: row._cpc_original_currency,
      cpc_to_thb_rate: row._cpc_to_thb_rate,
      cpc_rate_as_of: row._cpc_rate_as_of,
      cpc_rate_source: row._cpc_rate_source,
      monthly_trend: row._monthly_trend,
    } as EnrichedKeyword;
  });
}

// ─── Sync core (no API) ───────────────────────────────────────────────────────

export function runKeywordResearchSeoTitleSkill(input: SkillInput): SkillOutput {
  resetPatternRotation();
  const ctx = analyzeBusinessContext(input);

  let rawRows: any[] = [];

  if (input.keyword_rows && input.keyword_rows.length > 0) {
    rawRows = input.keyword_rows.map(r => {
      const { volume, missing } = normalizeVolume(r.volume);
      return { keyword: r.keyword.trim(), volume, source: r.source || 'manual', _missing: missing };
    });
    if (input.seed_keywords?.length) {
      rawRows.push(...generateFromSeeds(input.seed_keywords, ctx));
    }
  } else if (input.seed_keywords?.length) {
    rawRows = generateFromSeeds(input.seed_keywords, ctx);
  }

  return buildOutput(input, ctx, rawRows, null);
}

// ─── Async version — supports Google Keyword Planner API ─────────────────────

export async function runKeywordResearchSeoTitleSkillAsync(input: SkillInput): Promise<SkillOutput> {
  resetPatternRotation();
  const ctx = analyzeBusinessContext(input);
  const volumeSource = input.volume_source || 'estimated';

  let rawRows: any[] = [];
  let apiSuccess = false;
  let fallbackUsed = false;
  let fallbackSource: VolumeSource = 'estimated';
  let apiError: string | undefined;

  if (volumeSource === 'google_keyword_planner_api') {
    // Dynamic import so server builds don't bundle unless needed
    const { getKeywordPlannerRows } = await import('../../services/googleKeywordPlannerService');
    const result = await getKeywordPlannerRows(input);

    if (result.success && result.rows.length > 0) {
      apiSuccess = true;
      rawRows = mapPlannerRowsToInternal(result.rows);
    } else {
      apiError = result.error;
      fallbackUsed = true;
      fallbackSource = 'estimated';
      // Fallback: expand from seeds
      if (input.seed_keywords?.length) rawRows = generateFromSeeds(input.seed_keywords, ctx);
      if (input.keyword_rows?.length) {
        rawRows.push(...input.keyword_rows.map(r => ({
          ...r, _missing: true, source: 'estimated' as VolumeSource,
        })));
      }
    }
  } else {
    // Non-API mode — same as sync
    if (input.keyword_rows?.length) {
      rawRows = input.keyword_rows.map(r => {
        const { volume, missing } = normalizeVolume(r.volume);
        return { keyword: r.keyword.trim(), volume, source: r.source || volumeSource, _missing: missing };
      });
      if (input.seed_keywords?.length) rawRows.push(...generateFromSeeds(input.seed_keywords, ctx));
    } else if (input.seed_keywords?.length) {
      rawRows = generateFromSeeds(input.seed_keywords, ctx);
    }
    apiSuccess = false;
    fallbackUsed = false;
  }

  return buildOutput(input, ctx, rawRows, {
    volume_source: volumeSource,
    api_success: apiSuccess,
    fallback_used: fallbackUsed,
    fallback_source: fallbackSource,
    api_error: apiError,
  });
}

// ─── Output builder (shared) ──────────────────────────────────────────────────

function buildOutput(
  input: SkillInput,
  ctx: BusinessContext,
  rawRows: any[],
  apiMeta: {
    volume_source?: VolumeSource;
    api_success?: boolean;
    fallback_used?: boolean;
    fallback_source?: VolumeSource;
    api_error?: string;
  } | null
): SkillOutput {
  const enriched = enrichRows(rawRows, ctx);
  const sortBy = input.sort_by || 'volume';
  const sorted = sortKeywordRows(enriched, sortBy);
  const limit = input.number_of_results || 100;
  const limited = sorted.slice(0, limit);
  const outputMode = input.output_mode || 'simple_csv';
  const { csv_string, csv_columns, exported_rows } = buildCsvString(limited, outputMode);

  const hasMissingVolume = limited.some(r => r.volume_missing);
  const isVolumeEstimated = limited.some(r => r.volume_source === 'estimated');
  const missingData = limited.filter(r => r.volume_missing).map(r => r.keyword);
  const warnings = collectWarnings(limited);

  if (apiMeta?.api_error && apiMeta.fallback_used) {
    warnings.unshift(`Google Ads API failed: ${apiMeta.api_error}. Used ${apiMeta.fallback_source} volume instead.`);
  }

  const volumeSourceNote = buildVolumeSourceNote(limited);

  return {
    system_name: 'WordGod',
    skill_name: 'Keyword Research & SEO Title Expert',
    summary: {
      business_name: ctx.business_name,
      business_type: ctx.business_type,
      category: ctx.category,
      total_keywords: enriched.length,
      total_exported_rows: limited.length,
      sort_by: sortBy,
      output_mode: outputMode,
      volume_source_note: volumeSourceNote,
    },
    rows: exported_rows,
    csv_columns,
    csv_string,
    metadata: {
      is_volume_estimated: isVolumeEstimated,
      has_missing_volume: hasMissingVolume,
      missing_data: missingData,
      warnings,
      generated_at: new Date().toISOString(),
      ...(apiMeta ? {
        volume_source: apiMeta.volume_source,
        api_success: apiMeta.api_success,
        fallback_used: apiMeta.fallback_used,
        fallback_source: apiMeta.fallback_source,
      } : {}),
    },
  };
}

// ─── Re-exports ───────────────────────────────────────────────────────────────
export type { SkillInput, SkillOutput, KeywordRow, EnrichedKeyword } from './types';
export {
  normalizeVolume, deduplicateKeywords, classifySearchIntent,
  classifyKeywordType, scoreKeywordOpportunity, generateSeoH1Title,
  validateTitleQuality, buildCsvString,
} from './modules';
