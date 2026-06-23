import type {
  BusinessContext, EnrichedKeyword, KeywordRow, KeywordType,
  OutputMode, Priority, SearchIntent, SortBy, VolumeSource,
  FullRow, SimpleRow,
} from './types';

// ─── 1. BusinessContextAnalyzer ──────────────────────────────────────────────
export function analyzeBusinessContext(input: {
  business_name?: string;
  business_type?: string;
  category?: string;
  target_language?: string;
  target_country?: string;
  notes?: string;
}): BusinessContext {
  return {
    business_name: input.business_name || '',
    business_type: input.business_type || 'general',
    category: input.category || 'general',
    target_language: (input.target_language as any) || 'th',
    target_country: input.target_country || 'Thailand',
    notes: input.notes || '',
  };
}

// ─── 2. VolumeNormalizer ─────────────────────────────────────────────────────
export function normalizeVolume(value: unknown): { volume: number; missing: boolean } {
  if (value === null || value === undefined || value === '') {
    return { volume: 0, missing: true };
  }
  if (typeof value === 'number') {
    return { volume: Math.round(value), missing: false };
  }
  const str = String(value).trim().toLowerCase();
  // "90,500" → 90500
  const noComma = str.replace(/,/g, '');
  // "90.5k" or "90k"
  const kMatch = noComma.match(/^([\d.]+)k$/);
  if (kMatch) return { volume: Math.round(parseFloat(kMatch[1]) * 1000), missing: false };
  const mMatch = noComma.match(/^([\d.]+)m$/);
  if (mMatch) return { volume: Math.round(parseFloat(mMatch[1]) * 1_000_000), missing: false };
  const parsed = parseInt(noComma, 10);
  if (!isNaN(parsed)) return { volume: parsed, missing: false };
  return { volume: 0, missing: true };
}

// ─── 3. KeywordDeduplicationEngine ───────────────────────────────────────────
export function deduplicateKeywords(keywords: KeywordRow[]): KeywordRow[] {
  const seen = new Set<string>();
  return keywords.filter(kw => {
    const key = kw.keyword.trim().toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── 4. SearchIntentClassifier ────────────────────────────────────────────────
export function classifySearchIntent(keyword: string, ctx: BusinessContext): SearchIntent {
  const kw = keyword.toLowerCase();

  if (/ราคา|ค่า|เท่าไร|ถูก|แพง/.test(kw)) return 'price';
  if (/เปรียบเทียบ|vs\.|ดีกว่า|ต่างกัน|ไหนดี/.test(kw)) return 'comparison';
  if (/เช็คลิสต์|checklist|รายการ|ต้องมี/.test(kw)) return 'checklist';
  if (/รีวิว|review|ดีไหม|คุ้มไหม|น่าซื้อ/.test(kw)) return 'review';
  if (/ซื้อ|สั่ง|จอง|order|book/.test(kw)) return 'transactional';
  if (/บริการ|รับจัด|agency|ช่วย|จัดการ/.test(kw)) return 'service_seeking';
  if (/ใกล้ฉัน|ใน กรุงเทพ|ในเชียงใหม่|local/.test(kw)) return 'local';
  if (/แก้|รักษา|ป้องกัน|วิธีแก้|ปัญหา/.test(kw)) return 'problem_solving';
  if (/วิธีเลือก|ก่อนซื้อ|แนะนำ|ควรรู้/.test(kw)) return 'commercial';
  if (/คืออะไร|หมายถึง|คือ|ทำไม|เหตุผล|วิธี|ข้อมูล/.test(kw)) return 'informational';

  // infer from business type
  const bt = ctx.business_type.toLowerCase();
  if (bt.includes('ecommerce') || bt.includes('store')) return 'commercial';
  if (bt.includes('agency') || bt.includes('service')) return 'service_seeking';
  return 'informational';
}

// ─── 5. KeywordTypeClassifier ─────────────────────────────────────────────────
export function classifyKeywordType(keyword: string, ctx: BusinessContext): KeywordType {
  const kw = keyword.toLowerCase();
  const words = kw.trim().split(/\s+/);

  if (/เปรียบเทียบ|vs\.|ดีกว่า|ไหนดี/.test(kw)) return 'comparison';
  if (/ราคา|ค่า|เท่าไร/.test(kw)) return 'price';
  if (/เช็คลิสต์|checklist/.test(kw)) return 'checklist';
  if (/รีวิว|review/.test(kw)) return 'review';
  if (/ซื้อ|สั่ง|จอง/.test(kw)) return 'transactional';
  if (/ใกล้ฉัน|ในกรุงเทพ|local/.test(kw)) return 'local';
  if (/ปัญหา|แก้|รักษา/.test(kw)) return 'problem';
  if (/คืออะไร|หมายถึง|ทำไม/.test(kw)) return 'question';
  if (/แนะนำ|ก่อนซื้อ|วิธีเลือก/.test(kw)) return 'commercial';
  if (words.length >= 4) return 'long_tail';
  if (words.length === 1) return 'seed';
  return 'supporting_keyword';
}

// ─── 6. OpportunityScoringEngine ─────────────────────────────────────────────
export function scoreKeywordOpportunity(
  kw: { keyword: string; volume: number; intent: SearchIntent; keyword_type: KeywordType },
  ctx: BusinessContext
): { score: number; priority: Priority } {
  // Volume score (0-10 normalized to 0-100)
  const vol = kw.volume;
  const volumeScore =
    vol >= 100000 ? 10 :
    vol >= 50000  ? 9 :
    vol >= 20000  ? 8 :
    vol >= 10000  ? 7 :
    vol >= 5000   ? 6 :
    vol >= 1000   ? 5 :
    vol >= 500    ? 4 :
    vol >= 100    ? 3 :
    vol > 0       ? 2 : 1;

  // Business value by intent
  const intentValue: Record<SearchIntent, number> = {
    transactional: 10, commercial: 9, service_seeking: 8, price: 8,
    comparison: 7, review: 7, problem_solving: 6, local: 6,
    checklist: 5, informational: 5, navigational: 4,
  };
  const businessValue = intentValue[kw.intent] ?? 5;

  // Conversion potential
  const conversionMap: Record<SearchIntent, number> = {
    transactional: 10, commercial: 9, service_seeking: 8, price: 7,
    comparison: 7, review: 6, problem_solving: 5, local: 6,
    checklist: 5, informational: 3, navigational: 2,
  };
  const conversionPotential = conversionMap[kw.intent] ?? 5;

  // Relevance (keyword type)
  const typeRelevance: Record<KeywordType, number> = {
    money_keyword: 10, commercial: 9, transactional: 9, comparison: 8,
    price: 8, review: 7, long_tail: 7, problem: 7, question: 6,
    checklist: 6, seed: 6, supporting_keyword: 5, local: 5,
    seasonal: 4, brand: 4,
  };
  const relevanceScore = typeRelevance[kw.keyword_type] ?? 5;

  // Content gap: longer tail = lower competition assumed
  const words = kw.keyword.trim().split(/\s+/).length;
  const contentGapScore = words >= 4 ? 9 : words >= 3 ? 7 : words >= 2 ? 5 : 3;

  // Estimated difficulty penalty (shorter = harder)
  const difficultyPenalty = words === 1 ? 15 : words === 2 ? 8 : words === 3 ? 4 : 0;

  const raw =
    volumeScore * 10 * 0.30 +
    businessValue * 10 * 0.25 +
    conversionPotential * 10 * 0.20 +
    relevanceScore * 10 * 0.15 +
    contentGapScore * 10 * 0.10 -
    difficultyPenalty;

  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const priority: Priority = score >= 80 ? 'high' : score >= 60 ? 'medium' : 'low';

  return { score, priority };
}

// ─── 7. SeoH1TitleGenerator ──────────────────────────────────────────────────
const FORBIDDEN_PHRASES = [
  'ดีที่สุด', 'อันดับ 1', '100%', 'การันตี', 'เห็นผลแน่นอน',
  'ผ่านแน่นอน', 'รับประกัน', 'เก่งที่สุด', 'ถูกที่สุดในไทย',
];

const CONTENT_TYPE_MAP: Record<SearchIntent, string> = {
  informational:  'pillar_article',
  commercial:     'buying_guide',
  transactional:  'product_page',
  navigational:   'landing_page',
  local:          'local_seo_page',
  problem_solving:'problem_solution_article',
  comparison:     'comparison_article',
  price:          'price_guide',
  checklist:      'checklist_article',
  review:         'review_article',
  service_seeking:'service_page',
};

// Patterns vary by intent to avoid repetition
const TITLE_PATTERNS: Record<SearchIntent, string[]> = {
  informational: [
    '{kw} คืออะไร? รวมข้อควรรู้ที่ควรเข้าใจก่อนเริ่มใช้',
    '{kw} ช่วยเรื่องอะไร เหมาะกับใคร และควรรู้อะไรก่อนเลือกใช้',
    'รู้จัก {kw} ให้ครบ พร้อมข้อมูลที่มือใหม่ควรทราบ',
    '{kw} คืออะไร มีกี่แบบ และเลือกใช้อย่างไรให้เหมาะสม',
    'ทำความรู้จัก {kw} ตั้งแต่พื้นฐานจนถึงวิธีใช้ให้ได้ผล',
  ],
  commercial: [
    'วิธีเลือก {kw} ให้เหมาะกับความต้องการและงบประมาณ',
    'ก่อนซื้อ {kw} ควรรู้อะไรบ้าง? เช็กลิสต์สำหรับมือใหม่',
    '{kw} แบบไหนดี? วิธีเปรียบเทียบก่อนตัดสินใจซื้อ',
    'เลือก {kw} อย่างไรให้คุ้มค่า สำหรับผู้เริ่มต้น',
  ],
  transactional: [
    '{kw} ซื้อที่ไหนดี? รวมช่องทางและสิ่งที่ควรตรวจสอบก่อนสั่ง',
    'สั่ง {kw} อย่างไรให้ได้ของดีและไม่เสียเงินฟรี',
  ],
  navigational: [
    '{kw} ทุกอย่างที่ควรรู้ในหน้าเดียว',
  ],
  local: [
    '{kw} ในไทย มีที่ไหนบ้าง และเลือกอย่างไรให้เหมาะสม',
    'บริการ {kw} ใกล้บ้าน รวมสิ่งที่ต้องรู้ก่อนใช้บริการ',
  ],
  problem_solving: [
    '{kw} เกิดจากอะไร? รวมสาเหตุที่หลายคนมองข้าม',
    'วิธีรับมือกับ {kw} พร้อมข้อควรระวังที่ควรรู้',
    '{kw} แก้ได้ไหม? วิธีจัดการปัญหานี้อย่างถูกต้อง',
    'ปัญหา {kw} มีวิธีแก้อย่างไร รวมแนวทางที่ได้ผลจริง',
  ],
  comparison: [
    '{kw} ต่างกันอย่างไร เลือกแบบไหนดีสำหรับคุณ',
    'เปรียบเทียบ {kw} แต่ละแบบ เหมาะกับใครและควรเลือกอย่างไร',
    '{kw} ไหนดีกว่า? วิเคราะห์ข้อดีข้อเสียอย่างละเอียด',
  ],
  price: [
    '{kw} ราคาเท่าไร? รวมข้อมูลค่าใช้จ่ายที่ควรรู้ก่อนตัดสินใจ',
    'งบเท่าไรสำหรับ {kw}? เปรียบเทียบราคาและความคุ้มค่า',
  ],
  checklist: [
    'เช็กลิสต์ก่อนเลือก {kw} ดูอะไรบ้างไม่ให้พลาด',
    'เตรียมตัวก่อนใช้ {kw} ต้องรู้อะไรบ้าง?',
  ],
  review: [
    '{kw} ดีไหม? รีวิวตรงไปตรงมาพร้อมข้อดีข้อเสีย',
    'รีวิว {kw} จากประสบการณ์จริง เหมาะกับใครบ้าง',
  ],
  service_seeking: [
    'บริการ {kw} มีอะไรบ้าง? รวมสิ่งที่ควรรู้ก่อนใช้บริการ',
    '{kw} บริการครบ สิ่งที่ต้องเตรียมและขั้นตอนโดยละเอียด',
  ],
};

// Track used patterns per run to avoid repetition
const usedPatternIndices: Map<SearchIntent, number> = new Map();

export function generateSeoH1Title(
  keyword: string,
  intent: SearchIntent,
  _ctx: BusinessContext
): string {
  const patterns = TITLE_PATTERNS[intent] || TITLE_PATTERNS.informational;
  const currentIdx = usedPatternIndices.get(intent) ?? 0;
  const pattern = patterns[currentIdx % patterns.length];
  usedPatternIndices.set(intent, currentIdx + 1);
  return pattern.replace(/{kw}/g, keyword);
}

export function resetPatternRotation() {
  usedPatternIndices.clear();
}

// ─── 8. TitleQualityGuard ─────────────────────────────────────────────────────
export function validateTitleQuality(
  title: string,
  keyword: string,
  _intent: SearchIntent
): boolean {
  const kw = keyword.toLowerCase();
  const t = title.toLowerCase();

  // Must contain keyword or significant part of it
  const kwWords = kw.split(/\s+/);
  const hasKeyword = kwWords.some(w => t.includes(w));
  if (!hasKeyword) return false;

  // Must not contain forbidden phrases
  if (FORBIDDEN_PHRASES.some(f => title.includes(f))) return false;

  // Must not be too short or too long
  if (title.length < 10 || title.length > 120) return false;

  return true;
}

// ─── 9. ContentTypeResolver ───────────────────────────────────────────────────
export function resolveContentType(intent: SearchIntent): string {
  return CONTENT_TYPE_MAP[intent] || 'article';
}

// ─── 10. SortKeywordRows ──────────────────────────────────────────────────────
export function sortKeywordRows(rows: EnrichedKeyword[], sortBy: SortBy): EnrichedKeyword[] {
  return [...rows].sort((a, b) => {
    if (sortBy === 'opportunity_score') {
      if (b.opportunity_score !== a.opportunity_score) return b.opportunity_score - a.opportunity_score;
      if (b.volume !== a.volume) return b.volume - a.volume;
    } else {
      if (b.volume !== a.volume) return b.volume - a.volume;
      if (b.opportunity_score !== a.opportunity_score) return b.opportunity_score - a.opportunity_score;
    }
    if (b.opportunity_score !== a.opportunity_score) return b.opportunity_score - a.opportunity_score;
    return a.keyword.localeCompare(b.keyword, 'th');
  });
}

// ─── 11. CsvFormatter ─────────────────────────────────────────────────────────
function escapeCsvField(value: string | number): string {
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const SIMPLE_COLS = ['No.', 'Title (H1)', 'Keyword', 'Volume'];
const FULL_COLS = [
  'No.', 'Title (H1)', 'Keyword', 'Volume',
  'Competition', 'Competition Index', 'Low CPC', 'High CPC',
  'Intent', 'Keyword Type', 'Priority', 'Opportunity Score', 'Content Type', 'Notes',
];

export function buildCsvString(rows: EnrichedKeyword[], outputMode: OutputMode): {
  csv_string: string;
  csv_columns: string[];
  exported_rows: SimpleRow[] | FullRow[];
} {
  const cols = outputMode === 'full_csv' ? FULL_COLS : SIMPLE_COLS;

  const exported: any[] = rows.map((r, i) => {
    const base: SimpleRow = {
      'No.': i + 1,
      'Title (H1)': r.title,
      'Keyword': r.keyword,
      'Volume': r.volume,
    };
    if (outputMode === 'full_csv') {
      return {
        ...base,
        'Competition': r.competition ?? '',
        'Competition Index': r.competition_index ?? '',
        'Low CPC': r.low_cpc ?? '',
        'High CPC': r.high_cpc ?? '',
        'Intent': r.intent,
        'Keyword Type': r.keyword_type,
        'Priority': r.priority,
        'Opportunity Score': r.opportunity_score,
        'Content Type': r.content_type,
        'Notes': r.notes,
      } as FullRow;
    }
    return base;
  });

  const header = cols.join(',');
  const body = exported.map(row =>
    cols.map(col => escapeCsvField(row[col] ?? '')).join(',')
  ).join('\n');

  // UTF-8 BOM prefix for Excel Thai compatibility
  const BOM = '﻿';
  const csv_string = BOM + header + '\n' + body;

  return { csv_string, csv_columns: cols, exported_rows: exported };
}

// ─── 12. FinalRecommendationBuilder ──────────────────────────────────────────
export function buildVolumeSourceNote(rows: EnrichedKeyword[]): string {
  const sources = [...new Set(rows.map(r => r.volume_source))];
  const missingCount = rows.filter(r => r.volume_missing).length;
  let note = `Volume sources: ${sources.join(', ')}`;
  if (missingCount > 0) note += ` | ${missingCount} keywords have no volume data (set to 0)`;
  return note;
}

export function collectWarnings(rows: EnrichedKeyword[]): string[] {
  const warnings: string[] = [];
  const missingVol = rows.filter(r => r.volume_missing);
  if (missingVol.length > 0) {
    warnings.push(`${missingVol.length} keywords missing volume — set to 0. Consider adding real data.`);
  }
  const invalidTitles = rows.filter(r => !r.title_valid);
  if (invalidTitles.length > 0) {
    warnings.push(`${invalidTitles.length} titles did not pass quality check and were kept as fallback.`);
  }
  return warnings;
}
