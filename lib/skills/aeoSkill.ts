/**
 * WordGod — AEO / AI Search / GEO Skill
 *
 * Supplement layer for keyword research. Adds AEO, AI Overview Risk,
 * GEO Opportunity, Question Pattern, Answer Format, and AI Search Priority Score
 * to each keyword — WITHOUT replacing existing SEO scoring.
 *
 * All functions are rule-based (no API calls). Zero extra latency.
 */

import type { JourneyStage, AISearchRisk } from '../pipeline/wordgodPipeline';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type AEOOpportunity = 'high' | 'medium' | 'low';
export type GEOOpportunity = 'high' | 'medium' | 'low';
export type AISearchPriorityLevel = 'high' | 'medium' | 'low' | 'weak';

export type QuestionPattern =
  | 'what_is'
  | 'how_to'
  | 'why'
  | 'which_is_better'
  | 'best_recommended'
  | 'how_much'
  | 'how_long'
  | 'checklist'
  | 'step_by_step'
  | 'problem_error'
  | 'comparison'
  | 'risk_warning'
  | 'should_i'
  | 'near_me_local'
  | 'requirement_document'
  | 'cost_price'
  | 'timeline_duration'
  | 'troubleshooting'
  | 'buying_decision'
  | 'post_purchase'
  | 'none';

export type AnswerFormat =
  | 'short_direct_answer'
  | 'checklist'
  | 'comparison_table'
  | 'step_by_step'
  | 'decision_guide'
  | 'faq_block'
  | 'troubleshooting_guide'
  | 'pros_cons'
  | 'definition_example'
  | 'risk_explanation'
  | 'case_based_explanation'
  | 'cost_breakdown'
  | 'requirement_list'
  | 'timeline_table';

export interface AEOFields {
  aeo_opportunity: AEOOpportunity;
  aeo_opportunity_score: number;         // 0–100
  ai_overview_risk: AISearchRisk;        // reuse existing type
  ai_overview_risk_score: number;        // 0–100 (higher = riskier for organic)
  geo_opportunity: GEOOpportunity;
  geo_opportunity_score: number;         // 0–100
  direct_answer_potential: boolean;
  featured_snippet_potential: boolean;
  people_also_ask_potential: boolean;
  conversational_query_potential: boolean;
  entity_based_query: boolean;
  question_pattern: QuestionPattern;
  answer_format_recommendation: AnswerFormat;
  ai_search_priority_score: number;      // 0–100 composite
  ai_search_priority_level: AISearchPriorityLevel;
  ai_search_notes: string;
}

// ─── Question Pattern Classifier ──────────────────────────────────────────────

export function classifyQuestionPattern(keyword: string): QuestionPattern {
  const kw = keyword.toLowerCase();

  if (/คืออะไร|หมายถึง|แปลว่า|ความหมาย|definition|what is/.test(kw)) return 'what_is';
  if (/วิธี|how to|ทำอย่างไร|ทำยังไง|ขั้นตอน/.test(kw)) return 'how_to';
  if (/ทำไม|เพราะอะไร|สาเหตุ|why/.test(kw)) return 'why';
  if (/แบบไหนดีกว่า|ไหนดีกว่า|อันไหนดีกว่า|which is better/.test(kw)) return 'which_is_better';
  if (/เปรียบเทียบ|vs\.?|ต่างกัน|เทียบ/.test(kw)) return 'comparison';
  if (/ดีที่สุด|แนะนำ|อันดับ|best|top/.test(kw)) return 'best_recommended';
  if (/ราคาเท่าไร|ค่าใช้จ่าย|ค่าธรรมเนียม|ราคา|ค่า|how much|cost/.test(kw)) return 'cost_price';
  if (/นานแค่ไหน|ใช้เวลา|กี่วัน|กี่เดือน|กี่ปี|how long/.test(kw)) return 'timeline_duration';
  if (/ต้องใช้เอกสาร|เอกสารอะไร|requirement|ต้องเตรียม/.test(kw)) return 'requirement_document';
  if (/checklist|เช็กลิสต์|เช็คลิสต์|รายการ/.test(kw)) return 'checklist';
  if (/ทีละขั้น|step by step|step-by-step/.test(kw)) return 'step_by_step';
  if (/error|ไม่ทำงาน|พัง|แก้ไข|troubleshoot|วิธีแก้/.test(kw)) return 'troubleshooting';
  if (/ปัญหา|อาการ|แก้ปัญหา/.test(kw)) return 'problem_error';
  if (/อันตราย|เสี่ยง|ผลข้างเคียง|ควรกังวล|risk|warning/.test(kw)) return 'risk_warning';
  if (/ควรไหม|ดีไหม|should i|ควรเลือก|ควรซื้อ/.test(kw)) return 'should_i';
  if (/ใกล้ฉัน|near me|ในกรุงเทพ|ในเมือง|local/.test(kw)) return 'near_me_local';
  if (/ก่อนซื้อ|ซื้อ|เลือก|buying|เลือกซื้อ/.test(kw)) return 'buying_decision';
  if (/หลังใช้|ดูแล|บำรุง|ต่ออายุ|post purchase/.test(kw)) return 'post_purchase';

  return 'none';
}

// ─── Answer Format Recommender ─────────────────────────────────────────────────

export function recommendAnswerFormat(
  pattern: QuestionPattern,
  keyword: string
): AnswerFormat {
  const kw = keyword.toLowerCase();

  switch (pattern) {
    case 'what_is':       return 'definition_example';
    case 'how_to':        return 'step_by_step';
    case 'step_by_step':  return 'step_by_step';
    case 'why':           return 'short_direct_answer';
    case 'which_is_better': return 'comparison_table';
    case 'comparison':    return 'comparison_table';
    case 'best_recommended': return /เลือก|ซื้อ/.test(kw) ? 'decision_guide' : 'checklist';
    case 'cost_price':    return 'cost_breakdown';
    case 'timeline_duration': return 'timeline_table';
    case 'requirement_document': return 'requirement_list';
    case 'checklist':     return 'checklist';
    case 'troubleshooting': return 'troubleshooting_guide';
    case 'problem_error': return 'troubleshooting_guide';
    case 'risk_warning':  return 'risk_explanation';
    case 'should_i':      return 'decision_guide';
    case 'near_me_local': return 'short_direct_answer';
    case 'buying_decision': return 'decision_guide';
    case 'post_purchase': return 'faq_block';
    default:              return 'faq_block';
  }
}

// ─── AEO Opportunity Classifier ───────────────────────────────────────────────

export function classifyAEOOpportunity(
  keyword: string,
  pattern: QuestionPattern,
  intent: string
): { aeo_opportunity: AEOOpportunity; aeo_opportunity_score: number } {
  const highPatterns: QuestionPattern[] = [
    'how_to', 'what_is', 'comparison', 'which_is_better', 'checklist',
    'step_by_step', 'should_i', 'how_much', 'how_long', 'problem_error',
    'troubleshooting', 'requirement_document', 'risk_warning', 'cost_price',
    'timeline_duration',
  ];

  const kw = keyword.toLowerCase();
  let score = 30;

  if (highPatterns.includes(pattern)) score += 40;
  if (/\?|ไหม|อะไร|ยังไง|อย่างไร|เท่าไร|กี่/.test(kw)) score += 15;
  if (['informational', 'comparison', 'problem_solving', 'commercial'].includes(intent)) score += 10;
  if (kw.split(/\s+/).length >= 4) score += 5; // long-tail = more specific = higher AEO

  score = Math.min(100, score);

  return {
    aeo_opportunity: score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low',
    aeo_opportunity_score: score,
  };
}

// ─── AI Overview Risk Classifier ──────────────────────────────────────────────
// Separate from existing classifyAISearchRisk — this focuses on overview risk
// specifically in terms of whether AI will satisfy the query without a click.

export function classifyAIOverviewRisk(
  keyword: string,
  pattern: QuestionPattern,
  intent: string
): { ai_overview_risk: AISearchRisk; ai_overview_risk_score: number } {
  const kw = keyword.toLowerCase();
  const wordCount = kw.trim().split(/\s+/).length;

  // Very high risk — AI can give a complete answer with no brand/context needed
  if (pattern === 'what_is' && wordCount <= 3) {
    return { ai_overview_risk: 'high', ai_overview_risk_score: 90 };
  }

  let riskScore = 40;

  // High risk signals
  if (intent === 'informational' && wordCount <= 3) riskScore += 30;
  if (/^[ก-๙a-z\s]{0,20}คืออะไร\??$/.test(kw)) riskScore += 25;
  if (/ข้อเท็จจริง|สถิติ|fact|definition/.test(kw)) riskScore += 20;

  // Low risk signals — requires click, context, or decision
  if (/ราคา|ซื้อ|บริการ|ติดต่อ|รับทำ/.test(kw)) riskScore -= 30;
  if (/เปรียบเทียบ|vs\.?|ยี่ห้อไหน|รุ่นไหน/.test(kw)) riskScore -= 25;
  if (/ปัญหา|error|แก้ไข|ไม่ทำงาน/.test(kw)) riskScore -= 20;
  if (/อันตราย|เสี่ยง|ผลข้างเคียง/.test(kw)) riskScore -= 20;
  if (/ควรเลือก|ก่อนซื้อ|วิธีเลือก/.test(kw)) riskScore -= 20;
  if (/ประสบการณ์|รีวิว|pantip/.test(kw)) riskScore -= 25;
  if (['transactional', 'commercial', 'service_seeking', 'comparison', 'price', 'review', 'problem_solving'].includes(intent)) riskScore -= 20;
  if (wordCount >= 5) riskScore -= 15; // long-tail → more specific context needed

  riskScore = Math.max(0, Math.min(100, riskScore));

  return {
    ai_overview_risk: riskScore >= 65 ? 'high' : riskScore >= 35 ? 'medium' : 'low',
    ai_overview_risk_score: riskScore,
  };
}

// ─── GEO Opportunity Classifier ───────────────────────────────────────────────

export function classifyGEOOpportunity(
  keyword: string,
  pattern: QuestionPattern,
  intent: string,
  answerFormat: AnswerFormat
): { geo_opportunity: GEOOpportunity; geo_opportunity_score: number } {
  const kw = keyword.toLowerCase();
  let score = 30;

  // High GEO formats — AI loves to reference structured content
  const highGEOFormats: AnswerFormat[] = [
    'checklist', 'comparison_table', 'step_by_step', 'decision_guide',
    'requirement_list', 'cost_breakdown', 'timeline_table', 'troubleshooting_guide',
  ];
  if (highGEOFormats.includes(answerFormat)) score += 30;

  // Structured query patterns give better GEO opportunities
  const highGEOPatterns: QuestionPattern[] = [
    'how_to', 'step_by_step', 'checklist', 'comparison', 'requirement_document',
    'troubleshooting', 'cost_price', 'timeline_duration', 'risk_warning',
  ];
  if (highGEOPatterns.includes(pattern)) score += 20;

  // Depth and specificity signals
  if (/ขั้นตอน|วิธีการ|คู่มือ|guide/.test(kw)) score += 15;
  if (/ครบ|สมบูรณ์|ทั้งหมด|complete/.test(kw)) score += 10;
  if (kw.split(/\s+/).length >= 4) score += 10;
  if (['comparison', 'problem_solving', 'commercial'].includes(intent)) score += 10;

  score = Math.min(100, score);

  return {
    geo_opportunity: score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low',
    geo_opportunity_score: score,
  };
}

// ─── Feature Potential Flags ───────────────────────────────────────────────────

export function computeFeaturePotentials(
  keyword: string,
  pattern: QuestionPattern,
  intent: string
): {
  direct_answer_potential: boolean;
  featured_snippet_potential: boolean;
  people_also_ask_potential: boolean;
  conversational_query_potential: boolean;
  entity_based_query: boolean;
} {
  const kw = keyword.toLowerCase();

  const direct_answer_potential =
    pattern === 'what_is' ||
    pattern === 'how_long' ||
    pattern === 'how_much' ||
    /เท่าไร|กี่|นานแค่ไหน|ปกติคือ/.test(kw);

  const featured_snippet_potential =
    ['how_to', 'step_by_step', 'checklist', 'comparison', 'what_is', 'risk_warning'].includes(pattern);

  const people_also_ask_potential =
    /\?|ไหม|อะไร|ยังไง|ทำไม|ควร|เหมาะ/.test(kw) ||
    ['what_is', 'how_to', 'why', 'should_i', 'which_is_better'].includes(pattern);

  const conversational_query_potential =
    kw.split(/\s+/).length >= 5 ||
    /ถาม|ช่วย|อยาก|ต้องการ|แนะนำ/.test(kw) ||
    pattern === 'should_i';

  const entity_based_query =
    /ยี่ห้อ|แบรนด์|brand|รุ่น|model|ชื่อ|บริษัท|สถานที่/.test(kw) ||
    pattern === 'near_me_local';

  return {
    direct_answer_potential,
    featured_snippet_potential,
    people_also_ask_potential,
    conversational_query_potential,
    entity_based_query,
  };
}

// ─── AI Search Notes Builder ───────────────────────────────────────────────────

function buildAISearchNotes(
  aeoOpp: AEOOpportunity,
  aiRisk: AISearchRisk,
  geoOpp: GEOOpportunity,
  pattern: QuestionPattern,
  answerFormat: AnswerFormat,
  flags: ReturnType<typeof computeFeaturePotentials>
): string {
  const notes: string[] = [];

  if (aeoOpp === 'high') notes.push('Strong AEO target');
  if (aiRisk === 'high') notes.push('AI Overview may reduce clicks — go deeper than basic answer');
  if (aiRisk === 'low') notes.push('Low AI risk — click-worthy intent');
  if (geoOpp === 'high') notes.push('Good GEO source candidate — structure with ' + answerFormat.replace(/_/g, ' '));
  if (flags.featured_snippet_potential) notes.push('Featured snippet opportunity');
  if (flags.people_also_ask_potential) notes.push('PAA opportunity');
  if (flags.conversational_query_potential) notes.push('Conversational/voice search compatible');
  if (flags.direct_answer_potential) notes.push('Direct answer candidate');
  if (flags.entity_based_query) notes.push('Entity-based — include brand/product entity');

  return notes.join(' · ');
}

// ─── AI Search Priority Score ──────────────────────────────────────────────────

export function computeAISearchPriorityScore(
  aeoScore: number,
  geoScore: number,
  aiResilienceScore: number,       // from existing classifyAISearchRisk
  salesImpactScore: number,        // from existing computeSalesImpactScore
  pattern: QuestionPattern,
  flags: ReturnType<typeof computeFeaturePotentials>
): { ai_search_priority_score: number; ai_search_priority_level: AISearchPriorityLevel } {
  // Weighted formula per spec (AEO:20, GEO:20, Resilience:20, Sales:20, Question:10, Entity:10)
  const questionScore = [
    'how_to', 'comparison', 'which_is_better', 'checklist', 'step_by_step',
    'problem_error', 'troubleshooting', 'should_i', 'requirement_document',
  ].includes(pattern) ? 80 : pattern !== 'none' ? 55 : 20;

  const entityScore =
    flags.entity_based_query ? 80 :
    flags.conversational_query_potential ? 65 :
    flags.people_also_ask_potential ? 55 : 30;

  const score = Math.round(
    aeoScore        * 0.20 +
    geoScore        * 0.20 +
    aiResilienceScore * 0.20 +
    salesImpactScore  * 0.20 +
    questionScore   * 0.10 +
    entityScore     * 0.10
  );

  const level: AISearchPriorityLevel =
    score >= 80 ? 'high' :
    score >= 60 ? 'medium' :
    score >= 40 ? 'low' : 'weak';

  return { ai_search_priority_score: score, ai_search_priority_level: level };
}

// ─── Main enrichment function ──────────────────────────────────────────────────

export function enrichWithAEO(
  keyword: string,
  intent: string,
  ai_resilience_score: number,
  sales_impact_score: number
): AEOFields {
  const pattern = classifyQuestionPattern(keyword);
  const answerFormat = recommendAnswerFormat(pattern, keyword);
  const { aeo_opportunity, aeo_opportunity_score } = classifyAEOOpportunity(keyword, pattern, intent);
  const { ai_overview_risk, ai_overview_risk_score } = classifyAIOverviewRisk(keyword, pattern, intent);
  const { geo_opportunity, geo_opportunity_score } = classifyGEOOpportunity(keyword, pattern, intent, answerFormat);
  const flags = computeFeaturePotentials(keyword, pattern, intent);
  const { ai_search_priority_score, ai_search_priority_level } = computeAISearchPriorityScore(
    aeo_opportunity_score,
    geo_opportunity_score,
    ai_resilience_score,
    sales_impact_score,
    pattern,
    flags
  );

  const ai_search_notes = buildAISearchNotes(aeo_opportunity, ai_overview_risk, geo_opportunity, pattern, answerFormat, flags);

  return {
    aeo_opportunity,
    aeo_opportunity_score,
    ai_overview_risk,
    ai_overview_risk_score,
    geo_opportunity,
    geo_opportunity_score,
    direct_answer_potential: flags.direct_answer_potential,
    featured_snippet_potential: flags.featured_snippet_potential,
    people_also_ask_potential: flags.people_also_ask_potential,
    conversational_query_potential: flags.conversational_query_potential,
    entity_based_query: flags.entity_based_query,
    question_pattern: pattern,
    answer_format_recommendation: answerFormat,
    ai_search_priority_score,
    ai_search_priority_level,
    ai_search_notes,
  };
}
