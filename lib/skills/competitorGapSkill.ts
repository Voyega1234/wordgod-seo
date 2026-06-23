/**
 * WordGod — Competitor Gap Scoring
 *
 * Scores how much of a "gap" exists for a keyword — i.e. how likely large
 * competitors are to have missed or under-served this keyword.
 *
 * Higher scores = more opportunity to rank without head-to-head competition.
 */

export interface CompetitorGapScore {
  gap_score: number;            // 0-100
  gap_level: 'high' | 'medium' | 'low';
  gap_reasons: string[];
}

export function scoreCompetitorGap(
  keyword: string,
  keyword_type: string,
  intent: string,
  volume: number,
  aeo_opportunity_score: number,
  topic_cluster_role?: string
): CompetitorGapScore {
  const kw = keyword.toLowerCase();
  const wordCount = keyword.trim().split(/\s+/).length;
  const gap_reasons: string[] = [];

  let score = 30; // base

  // Word count bonuses (long-tail = harder for large sites to target)
  if (wordCount >= 5) {
    score += 30;
    gap_reasons.push('Long-tail keyword (5+ words) — hard for large sites to target');
  } else if (wordCount >= 4) {
    score += 20;
    gap_reasons.push('Long-tail keyword (4+ words) — often under-served by major competitors');
  } else if (wordCount >= 3) {
    score += 10;
    gap_reasons.push('Mid-tail keyword (3 words) — moderate competition gap');
  }

  // Thai-local context
  if (/ไทย|ภาษาไทย|ในไทย|ประเทศไทย|กรุงเทพ/.test(kw)) {
    score += 20;
    gap_reasons.push('Thai-local context — international competitors unlikely to rank');
  }

  // Problem/troubleshooting keyword type
  if (keyword_type === 'problem' || keyword_type === 'troubleshooting') {
    score += 25;
    gap_reasons.push('Problem/troubleshooting intent — often skipped by competitors chasing volume');
  }

  // Topic cluster role
  if (topic_cluster_role === 'faq_candidate' || topic_cluster_role === 'troubleshooting') {
    score += 20;
    gap_reasons.push('FAQ/troubleshooting cluster role — niche content large sites rarely publish');
  }

  // Problem-solving intent
  if (intent === 'problem_solving') {
    score += 15;
    gap_reasons.push('Problem-solving intent — high specificity reduces competitor overlap');
  }

  // Question pattern
  if (/คืออะไร|ยังไง|ทำไม|อย่างไร/.test(kw)) {
    score += 15;
    gap_reasons.push('Question-pattern keyword — conversational queries competitors often miss');
  }

  // Volume sweet spot (100–2000: enough traffic, low enough to have a gap)
  if (volume >= 100 && volume <= 2000) {
    score += 20;
    gap_reasons.push('Low-to-medium volume (100–2000/mo) — sweet spot for gap opportunities');
  } else if (volume >= 2001 && volume <= 5000) {
    score += 10;
    gap_reasons.push('Medium volume (2001–5000/mo) — moderate gap potential');
  }

  // AEO opportunity bonus
  if (aeo_opportunity_score >= 70) {
    score += 15;
    gap_reasons.push('High AEO opportunity — structured answer format reduces big-site advantage');
  }

  // Penalties
  if (volume > 10000) {
    score -= 20;
    gap_reasons.push('High volume (10000+/mo) — large competitors likely already targeting this');
  }

  if (keyword_type === 'seed') {
    score -= 15;
    gap_reasons.push('Seed/head keyword — dominated by established high-authority sites');
  }

  if (intent === 'transactional' || intent === 'commercial') {
    score -= 10;
    gap_reasons.push('Transactional/commercial intent — high advertiser and competitor density');
  }

  const gap_score = Math.max(0, Math.min(100, score));
  const gap_level: 'high' | 'medium' | 'low' =
    gap_score >= 65 ? 'high' : gap_score >= 40 ? 'medium' : 'low';

  return { gap_score, gap_level, gap_reasons };
}
