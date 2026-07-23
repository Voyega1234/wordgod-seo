/**
 * WordGod — Title Quality Scoring (pure, deterministic)
 *
 * The AI title skill self-reports seo/aeo/ctr scores — the model grading its own
 * work. This module is an INDEPENDENT, deterministic check of the same rules the
 * title prompt states (keyword presence, forbidden phrases, banned platforms,
 * length band, pattern repetition), so the pipeline has a trustworthy quality
 * signal that costs nothing and never lies.
 *
 * No network, no LLM, no randomness — same title in ⇒ same score out.
 */

// Mirrors the FORBIDDEN list in seoTitleAiSkill / wordgodPipeline title guard.
const FORBIDDEN_PHRASES = [
  'ดีที่สุด', 'อันดับ 1', 'อันดับ1', '100%', 'การันตี', 'รับประกัน',
  'เห็นผลแน่นอน', 'ผ่านแน่นอน',
];

const BANNED_PLATFORM_RE =
  /\b(pantip|sanook|wongnai|reddit|quora|twitter|facebook|youtube|tiktok|blockdit|medium)\b/i;

// The rule-based fallback shape the pipeline emits — overuse reads as low effort.
const GENERIC_OPENER_RE = /คืออะไร\??\s*รวมข้อควรรู้/;

const THAI_CHAR_RE = /[฀-๿]/;

// Intent → lexical cues a well-matched title tends to carry. Only intents with a
// clear lexical signature are checked; informational (and anything unlisted) is
// never penalised, since a good explainer title need not carry a marker word.
const INTENT_CUES: Record<string, RegExp> = {
  comparison: /เปรียบเทียบ|ต่างกัน|ไหนดี(กว่า)?|\bvs\b|ดีกว่า/i,
  commercial: /วิธีเลือก|ก่อนซื้อ|เหมาะกับใคร|แนะนำ|ตัวไหนดี|รุ่นไหน/i,
  transactional: /ราคา|ซื้อ|สั่ง|สมัคร|โปรโมชั่น|ที่ไหน/i,
  problem_solving: /วิธีแก้|สาเหตุ|วิธีรับมือ|ปัญหา|แก้ไข/i,
  review: /รีวิว|ดีไหม|ข้อดีข้อเสีย|ประสบการณ์/i,
};

export interface TitleQuality {
  score: number;    // 0–100 (deterministic)
  valid: boolean;   // passes the hard rules (keyword present, no forbidden, sane length)
  issues: string[]; // Thai-language flags, most-severe first
}

/** Keyword-presence check matching the pipeline: Thai = substring, English = any word token. */
function titleHasKeyword(title: string, keyword: string): boolean {
  const t = title.toLowerCase();
  const k = keyword.toLowerCase().trim();
  if (!k) return false;
  if (THAI_CHAR_RE.test(keyword)) return t.includes(k);
  return k.split(/\s+/).filter(w => w.length > 1).some(w => t.includes(w));
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

/**
 * Score a generated title against the deterministic quality rules.
 * `valid` is false when a hard rule is broken (missing keyword, forbidden phrase,
 * banned platform, or absurd length); such titles are also capped to a low score.
 */
export function scoreTitle(title: string, keyword: string, intent?: string): TitleQuality {
  const trimmed = (title || '').trim();
  const issues: string[] = [];

  if (!trimmed) return { score: 0, valid: false, issues: ['ไม่มี title'] };

  const len = [...trimmed].length; // count Thai characters by code point
  let valid = true;

  // ── Hard rules ──────────────────────────────────────────────────────────────
  if (!titleHasKeyword(trimmed, keyword)) {
    valid = false;
    issues.push('ไม่มี keyword ใน title');
  }
  const forbidden = FORBIDDEN_PHRASES.filter(f => trimmed.includes(f));
  if (forbidden.length > 0) {
    valid = false;
    issues.push(`มีคำต้องห้าม: ${forbidden.join(', ')}`);
  }
  if (BANNED_PLATFORM_RE.test(trimmed)) {
    valid = false;
    issues.push('มีชื่อแพลตฟอร์มต้องห้าม');
  }
  if (len < 10 || len > 120) {
    valid = false;
    issues.push(`ความยาวผิดปกติ (${len} ตัวอักษร)`);
  }

  // ── Soft scoring ─────────────────────────────────────────────────────────────
  let score = 100;
  if (len < 40) { score -= 15; issues.push('สั้นกว่า 40 ตัวอักษร'); }
  else if (len > 80) { score -= 10; issues.push('ยาวกว่า 80 ตัวอักษร'); }

  if (GENERIC_OPENER_RE.test(trimmed)) {
    score -= 20;
    issues.push('ใช้รูปแบบซ้ำ "คืออะไร? รวมข้อควรรู้"');
  }

  const occ = countOccurrences(trimmed.toLowerCase(), keyword.toLowerCase().trim());
  if (occ >= 3) { score -= 20; issues.push('keyword ซ้ำมากเกินไป'); }

  // Soft intent alignment: only for intents with a clear lexical signature.
  const cue = intent ? INTENT_CUES[intent] : undefined;
  if (cue && !cue.test(trimmed)) {
    score -= 5;
    issues.push(`title อาจไม่ตรง intent (${intent})`);
  }

  if (!valid) score = Math.min(score, 40); // hard-rule breakers can never score well
  score = Math.max(0, Math.min(100, score));

  return { score, valid, issues };
}
