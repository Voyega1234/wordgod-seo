/**
 * WordGod — Trend / Seasonal Detection
 *
 * Classifies keywords by trend type to guide content refresh cadence.
 * Uses rule-based pattern matching — first match wins.
 */

export type TrendType = 'evergreen' | 'seasonal' | 'trending' | 'declining' | 'cyclical';

export interface TrendSignal {
  trend_type: TrendType;
  trend_score: number;        // 0-100 (higher = more time-sensitive)
  refresh_priority: 'urgent' | 'regular' | 'low';
  content_notes: string;
}

const CONTENT_NOTES: Record<TrendType, string> = {
  trending: 'ตรวจสอบข้อมูลล่าสุดก่อนเผยแพร่ — เนื้อหาอาจเปลี่ยนแปลงบ่อย',
  seasonal: 'เนื้อหาตามฤดูกาล — อัปเดตและโปรโมทก่อน peak season',
  cyclical: 'ราคา/อัตราเปลี่ยนได้ — ใส่วันที่อัปเดตล่าสุดในบทความ',
  evergreen: 'Evergreen content — เน้น depth, internal linking, และ topical authority',
  declining: 'เนื้อหากำลังหมดความนิยม — พิจารณา redirect หรือ update',
};

export function detectTrendSignal(keyword: string, intent: string, keyword_type: string): TrendSignal {
  const kw = keyword.toLowerCase();

  // 1. Year/recency words → trending, urgent
  if (/2025|2026|2027|ล่าสุด|ใหม่ล่าสุด|อัปเดต/.test(kw)) {
    return {
      trend_type: 'trending',
      trend_score: 80,
      refresh_priority: 'urgent',
      content_notes: CONTENT_NOTES.trending,
    };
  }

  // 2. Law/regulation → trending, urgent
  if (/กฎหมาย|ระเบียบ|ประกาศ|นโยบาย|พ\.ร\.บ|regulation/.test(kw)) {
    return {
      trend_type: 'trending',
      trend_score: 85,
      refresh_priority: 'urgent',
      content_notes: CONTENT_NOTES.trending,
    };
  }

  // 3. Season words → seasonal, regular
  if (/หน้าร้อน|ฤดูหนาว|หน้าฝน|ปีใหม่|สงกรานต์|วาเลนไทน์|คริสต์มาส|ฮาโลวีน|เดือนธันวา|เดือนมกรา|เดือนเมษา/.test(kw)) {
    return {
      trend_type: 'seasonal',
      trend_score: 70,
      refresh_priority: 'regular',
      content_notes: CONTENT_NOTES.seasonal,
    };
  }

  // 4. Price/rate without time words + price/commercial intent → cyclical
  if (/ราคา|อัตรา|ค่า|fee|price/.test(kw) && (intent === 'price' || intent === 'commercial')) {
    return {
      trend_type: 'cyclical',
      trend_score: 50,
      refresh_priority: 'regular',
      content_notes: CONTENT_NOTES.cyclical,
    };
  }

  // 5. Education/evergreen without year/time words → evergreen, low
  const hasTimeWords = /2025|2026|2027|ล่าสุด|ใหม่|อัปเดต|หน้าร้อน|ฤดูหนาว|หน้าฝน/.test(kw);
  if (/คืออะไร|หมายถึง|ทำงานอย่างไร|วิธี|ขั้นตอน/.test(kw) && !hasTimeWords) {
    return {
      trend_type: 'evergreen',
      trend_score: 10,
      refresh_priority: 'low',
      content_notes: CONTENT_NOTES.evergreen,
    };
  }

  // 6. Default → evergreen
  return {
    trend_type: 'evergreen',
    trend_score: 20,
    refresh_priority: 'low',
    content_notes: CONTENT_NOTES.evergreen,
  };
}
