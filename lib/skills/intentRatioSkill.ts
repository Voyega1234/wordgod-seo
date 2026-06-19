export interface IntentRatio {
  informational: number;
  commercial: number;
  transactional: number;
  navigational: number;
  update: number;
}

export type PresetKey = 'preset1' | 'preset2' | 'preset3' | 'preset4' | 'preset6' | 'manual';

export interface Preset {
  key: PresetKey;
  name: string;
  description: string;
  ratio: IntentRatio;
}

export const PRESETS: Preset[] = [
  {
    key: 'preset1',
    name: 'Balanced SEO + Conversion',
    description: 'เหมาะกับเว็บทั่วไปที่ต้องการ traffic และ conversion ไปพร้อมกัน',
    ratio: { informational: 50, commercial: 30, transactional: 15, navigational: 5, update: 0 },
  },
  {
    key: 'preset2',
    name: 'New Website / Topical Authority',
    description: 'เว็บใหม่ที่ต้องการสร้าง topical authority และ traffic foundation ก่อน',
    ratio: { informational: 60, commercial: 25, transactional: 10, navigational: 5, update: 0 },
  },
  {
    key: 'preset3',
    name: 'Lead Generation / Service Business',
    description: 'เว็บบริการที่ต้องการ lead, โทรศัพท์, LINE, หรือการ consult',
    ratio: { informational: 40, commercial: 35, transactional: 20, navigational: 5, update: 0 },
  },
  {
    key: 'preset4',
    name: 'Affiliate / Review Website',
    description: 'เว็บ affiliate ที่เน้น review, เปรียบเทียบ, และ buying guide',
    ratio: { informational: 40, commercial: 40, transactional: 15, navigational: 5, update: 0 },
  },
  {
    key: 'preset6',
    name: 'Knowledge Website / Pure Educational',
    description: 'เว็บความรู้ที่ไม่ขายสินค้า/บริการ เน้นให้ความรู้ อธิบาย และอ้างอิงข้อมูลที่น่าเชื่อถือ',
    ratio: { informational: 85, commercial: 0, transactional: 0, navigational: 5, update: 10 },
  },
  {
    key: 'manual',
    name: 'Manual Custom Ratio',
    description: 'ปรับ ratio เองได้ทุก intent',
    ratio: { informational: 50, commercial: 30, transactional: 15, navigational: 5, update: 0 },
  },
];

export const DEFAULT_RATIO: IntentRatio = PRESETS[0].ratio;

export const INTENT_LABELS: Record<keyof IntentRatio, string> = {
  informational: 'Informational Intent',
  commercial:    'Commercial Investigation',
  transactional: 'Transactional / Service Intent',
  navigational:  'Navigational / Brand Intent',
  update:        'Update / News / Freshness Intent',
};

export const INTENT_DESCRIPTIONS: Record<keyof IntentRatio, string> = {
  informational: 'ดึง traffic, ตอบคำถาม, สร้าง topical authority',
  commercial:    'เปรียบเทียบ, แนะนำทางเลือก, ช่วยคนตัดสินใจ',
  transactional: 'ดัน lead, conversion, ติดต่อ, ซื้อ, ใช้บริการ',
  navigational:  'บทความเกี่ยวกับแบรนด์ บริการ ขั้นตอน ติดต่อ รีวิว',
  update:        'อัปเดตกฎใหม่ ราคาใหม่ เงื่อนไขใหม่ เทรนด์ใหม่',
};

export function rebalanceRatio(
  current: IntentRatio,
  changedKey: keyof IntentRatio,
  newValue: number
): IntentRatio {
  const clamped = Math.max(0, Math.min(100, newValue));
  const others = (Object.keys(current) as (keyof IntentRatio)[]).filter(k => k !== changedKey);
  const remainingTotal = 100 - clamped;
  const currentOthersTotal = others.reduce((s, k) => s + current[k], 0);

  const result = { ...current, [changedKey]: clamped };

  if (currentOthersTotal === 0) {
    // distribute evenly
    const each = Math.floor(remainingTotal / others.length);
    const leftover = remainingTotal - each * others.length;
    others.forEach((k, i) => { result[k] = each + (i === 0 ? leftover : 0); });
  } else {
    // proportional rebalance
    let allocated = 0;
    others.forEach((k, i) => {
      if (i === others.length - 1) {
        result[k] = remainingTotal - allocated;
      } else {
        const v = Math.round((current[k] / currentOthersTotal) * remainingTotal);
        result[k] = v;
        allocated += v;
      }
    });
  }

  return result;
}

export function totalRatio(r: IntentRatio): number {
  return r.informational + r.commercial + r.transactional + r.navigational + r.update;
}

export function buildIntentPromptSection(r: IntentRatio, count: number, isKnowledgeMode = false): string {
  const intents: { key: keyof IntentRatio; desc: string }[] = [
    {
      key: 'informational',
      desc: isKnowledgeMode
        ? 'ให้ความรู้ อธิบาย สาธิต เช่น "คืออะไร", "หมายถึงอะไร", "ขั้นตอน", "วิธีทำงาน", "ประกอบด้วย", "หลักการ" — ห้ามมี CTA ขายหรือโฆษณา'
        : 'ดึง traffic, ตอบคำถาม เช่น "คืออะไร", "วิธี", "ทำไม", "ประโยชน์", how-to guides, checklist, guide, FAQ',
    },
    {
      key: 'commercial',
      desc: isKnowledgeMode
        ? 'เปรียบเทียบเชิงความรู้ เช่น "ต่างกันอย่างไร", "เหมือนกันอย่างไร", "ข้อดีข้อเสีย" — ห้ามเปรียบเทียบเพื่อขายหรือผลักดันให้ซื้อ'
        : 'เปรียบเทียบ, ช่วยตัดสินใจ เช่น "รีวิว", "เปรียบเทียบ", "ดีที่สุด", "แนะนำ", "ยี่ห้อไหนดี", "vs", pros and cons',
    },
    {
      key: 'transactional',
      desc: 'ดัน lead/conversion เช่น "บริการ", "รับยื่น", "รับทำ", "ราคา", "ติดต่อ", "สมัคร", "จอง", "ขอใบเสนอราคา"',
    },
    {
      key: 'navigational',
      desc: isKnowledgeMode
        ? 'นำทางในเว็บความรู้ เช่น "คู่มือเริ่มต้น", "คลังความรู้", "คำศัพท์", "หมวดหมู่", "แหล่งอ้างอิง", "เกี่ยวกับ" — ห้ามขายบริการ'
        : 'แบรนด์/บริการ เช่น "รีวิว[แบรนด์]", "ขั้นตอน", "เกี่ยวกับ", "ติดต่อ", "case study", "ทำไมเลือก"',
    },
    {
      key: 'update',
      desc: 'อัปเดต/Freshness เช่น "ล่าสุด", "2026", "กฎใหม่", "ราคาใหม่", "อัปเดต", "เงื่อนไขใหม่"',
    },
  ];

  const lines = intents
    .filter(({ key }) => r[key] > 0)
    .map(({ key, desc }) => {
      const n = Math.round(count * r[key] / 100);
      return `- ${INTENT_LABELS[key]} (${r[key]}%): ~${n} keywords — ${desc}`;
    });

  return lines.join('\n');
}
