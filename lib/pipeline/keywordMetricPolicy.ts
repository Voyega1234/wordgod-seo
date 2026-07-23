import { countWords } from '../text/thai';

export type KeywordMetricMode = 'api_only' | 'api_first';
export type KeywordMetricSource = 'keyword_planner' | 'planner_variant' | 'dataforseo' | 'gemini_estimated';

export interface MetricSourceSummary {
  apiBacked: number;
  planner: number;
  dataForSeo: number;
  derived: number;
  estimated: number;
}

export function isDirectMetricSource(source: string | undefined): boolean {
  return source === 'keyword_planner' || source === 'dataforseo';
}

export function getCandidateTarget(requestedCount: number): number {
  const safeRequested = Math.min(Math.max(Math.round(requestedCount) || 1, 1), 3000);
  return Math.min(3000, safeRequested * 3);
}

export function isMetricLookupCandidate(keyword: string, language = 'th'): boolean {
  const words = countWords(keyword, language === 'th' ? 'th' : 'en');
  // Intl.Segmenter splits Thai compounds more finely than visible whitespace
  // (for example "ต่างประเทศ" can be multiple tokens), so Thai needs a
  // slightly wider boundary than English for the same concise phrase.
  const maxWords = language === 'th' ? 6 : 4;
  return words > 0 && words <= maxWords;
}

export function summarizeMetricSources(
  keywords: Array<{ volume_source?: string }>
): MetricSourceSummary {
  let planner = 0;
  let dataForSeo = 0;
  let derived = 0;
  let estimated = 0;

  for (const keyword of keywords) {
    if (keyword.volume_source === 'keyword_planner') planner++;
    else if (keyword.volume_source === 'dataforseo') dataForSeo++;
    else if (keyword.volume_source === 'planner_variant') derived++;
    else estimated++;
  }

  return {
    apiBacked: planner + dataForSeo,
    planner,
    dataForSeo,
    derived,
    estimated,
  };
}
