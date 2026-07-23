/**
 * WordGod — Rank Validation
 *
 * Pure, deterministic multi-layer confidence model for whether a domain
 * actually ranks for a keyword. No network calls happen in this module.
 *
 * Layers:
 *   L1 — DataForSEO live SERP fetch (source of truth for this analysis)
 *   L2 — DataForSEO ranked_keywords position for the domain (cross-check)
 *   L3 — Gemini-grounding domain presence for the keyword (cross-check)
 *
 * L1 is always available (it's the input). L2/L3 are optional corroborating
 * signals; when present and they agree with L1, confidence rises to 'high'.
 * When they disagree, confidence drops to 'low' and a refetch is recommended.
 */

import type { SerpResultItem } from '../services/dataForSeoService';

/**
 * Compare two hostnames/domains/URLs for equality after normalizing away
 * protocol, path, and a leading "www." — true if equal or one is a
 * subdomain of the other.
 */
export function domainMatches(a: string, b: string): boolean {
  const normalize = (value: string): string => {
    const raw = (value || '').trim();
    if (!raw) return '';
    try {
      const withProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(raw) ? raw : `https://${raw}`;
      const parsed = new URL(withProtocol);
      return parsed.hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return raw.toLowerCase().replace(/^www\./, '');
    }
  };

  const hostA = normalize(a);
  const hostB = normalize(b);
  if (!hostA || !hostB) return false;
  if (hostA === hostB) return true;
  return hostA.endsWith(`.${hostB}`) || hostB.endsWith(`.${hostA}`);
}

export interface CompetitorEntry {
  position: number;
  domain: string;
  url: string;
  title: string;
}

export type RankConfidence = 'high' | 'medium' | 'low';

export interface RankAnalysis {
  keyword: string;
  siteRank: number | null;          // L1: target domain's position in SERP, null = not in fetched SERP
  inTop5: boolean;                  // siteRank !== null && siteRank <= 5
  top5Competitors: CompetitorEntry[]; // first 5 organic results (always, so user sees who ranks 1-5)
  rankConfidence: RankConfidence;
  needsRefetch: boolean;            // true only when rankConfidence === 'low'
  rankSource: 'dfs_serp';
  layers: { l1Rank: number | null; l2Rank: number | null; l3Present: boolean | null };
  checkedAt: string;
}

export function buildRankAnalysis(params: {
  keyword: string;
  serpResults: SerpResultItem[];
  targetDomain: string;
  rankedKeywordRank?: number | null;
  groundingDomains?: string[];
}): RankAnalysis {
  const { keyword, serpResults, targetDomain, rankedKeywordRank, groundingDomains } = params;

  const sortedResults = [...serpResults].sort((a, b) => a.position - b.position);

  // L1: first matching result's position
  const match = sortedResults.find(item => domainMatches(item.domain, targetDomain));
  const siteRank: number | null = match ? match.position : null;

  const top5Competitors: CompetitorEntry[] = sortedResults.slice(0, 5).map(item => ({
    position: item.position,
    domain: item.domain,
    url: item.url,
    title: item.title,
  }));

  // L2
  const l2Rank: number | null = rankedKeywordRank ?? null;
  const l2Available = l2Rank !== null;

  // L3
  const l3Present: boolean | null = groundingDomains === undefined
    ? null
    : groundingDomains.some(d => domainMatches(d, targetDomain));

  let agree = 0;
  let corroboratingLayers = 0;

  if (l2Available) {
    corroboratingLayers += 1;
    const l2Agrees = (siteRank !== null && Math.abs(siteRank - (l2Rank as number)) <= 3)
      || (siteRank === null && (l2Rank as number) > 10);
    agree += l2Agrees ? 1 : -1;
  }

  if (l3Present !== null) {
    corroboratingLayers += 1;
    const l3Agrees = (l3Present === true && siteRank !== null)
      || (l3Present === false && siteRank === null);
    agree += l3Agrees ? 1 : -1;
  }

  let rankConfidence: RankConfidence;
  if (corroboratingLayers === 0) {
    rankConfidence = 'medium';
  } else if (agree > 0) {
    rankConfidence = 'high';
  } else if (agree === 0) {
    rankConfidence = 'medium';
  } else {
    rankConfidence = 'low';
  }

  const needsRefetch = rankConfidence === 'low';
  const inTop5 = siteRank !== null && siteRank <= 5;

  return {
    keyword,
    siteRank,
    inTop5,
    top5Competitors,
    rankConfidence,
    needsRefetch,
    rankSource: 'dfs_serp',
    layers: { l1Rank: siteRank, l2Rank, l3Present },
    checkedAt: new Date().toISOString(),
  };
}
