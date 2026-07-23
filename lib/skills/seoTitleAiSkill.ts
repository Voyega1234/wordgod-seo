/**
 * WordGod — SEO Title AI Skill
 *
 * Generates titles optimized for:
 *   - Classic SEO (crawlers, meta title, H1)
 *   - AEO (Answer Engine Optimization — featured snippets, PAA)
 *   - AI Search (ChatGPT, Perplexity, Gemini AI overview)
 *
 * Uses Gemini to write titles — NOT rule-based templates.
 * Server-side only. Never expose to client.
 */

export interface TitleRequest {
  keyword: string;
  volume: number;
  competition: string;     // LOW | MEDIUM | HIGH
  intent: string;
  keyword_type: string;
  content_type: string;
  business_context: string;
  category: string;
}

export interface TitleAiResult {
  keyword: string;
  title: string;
  aeo_question?: string;  // Natural-language question for featured snippet / AI answer
  seo_score: number;
  aeo_score: number;
  ai_search_score: number;
  ctr_score: number;
  notes: string;
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

// Opening structures to rotate so Gemini doesn't fall back to the same template
const TITLE_OPENERS = [
  'เปิดเผย', 'เจาะลึก', 'ไขข้อข้องใจ', 'แนะนำ', 'วิเคราะห์',
  'คู่มือ', 'เทคนิค', 'วิธี', 'เปรียบเทียบ', 'ถอดรหัส',
  'รู้จัก', 'เช็ก', 'ทำความเข้าใจ', 'สรุป', 'อัปเดต',
];

export function buildSeoTitleAiPrompt(
  requests: TitleRequest[],
  targetLanguage: string = 'th'
): string {
  const kwList = requests.map((r, i) =>
    `${i + 1}|${r.keyword}|${r.intent}|${r.keyword_type}`
  ).join('\n');

  const sampleBusiness = requests[0];
  // Pick a rotating set of openers to hint diversity
  const openerHint = TITLE_OPENERS.slice(0, 8).join(', ');

  return `WordGod Title Expert — ${targetLanguage === 'th' ? 'Thai' : 'English'}
Business: ${sampleBusiness.business_context} | Category: ${sampleBusiness.category}

Write one SEO+AEO+AI-Search optimised H1 title per keyword. Rules:
- Contains the exact keyword (Thai inflection OK)
- 40–80 Thai characters
- FORBIDDEN: ดีที่สุด, อันดับ 1, 100%, การันตี, รับประกัน, เห็นผลแน่นอน, pantip, sanook, wongnai, reddit, facebook, youtube, tiktok, blockdit, medium
- DIVERSITY: every title must open differently — rotate openers like: ${openerHint} — never use "คืออะไร? รวมข้อควรรู้" more than once per batch
- intent→style: informational=explain/define, commercial=compare/choose, transactional=buy/price/step, review=pros-cons, comparison=A vs B

Format: index|keyword|intent|type
${kwList}

Return JSON only:
{"titles":[{"keyword":"...","title":"...","aeo_question":"...","seo_score":8,"aeo_score":8,"ai_search_score":8,"ctr_score":7,"notes":"..."}]}`;
}

/**
 * Compact few-shot block of REAL competitor titles already ranking on Google's
 * first page — reused from the SERP rank-check step, so it costs no extra API
 * call. Prepend it to a title prompt so the model differentiates against what's
 * ranking instead of echoing it. Returns '' when there is nothing usable, so
 * callers can prepend unconditionally.
 */
export function buildSerpFewShotBlock(
  entries: Array<{ keyword: string; competitorTitles: string[] }>,
): string {
  const lines: string[] = [];
  for (const entry of entries) {
    const titles = (entry.competitorTitles || [])
      .map(t => (t || '').trim())
      .filter(Boolean)
      .slice(0, 5);
    if (titles.length === 0) continue;
    lines.push(`- "${entry.keyword}": ${titles.map(t => `“${t}”`).join(' | ')}`);
  }
  if (lines.length === 0) return '';
  return `### บริบทคู่แข่งจาก Google (title ที่ติดหน้าแรกจริงของคีย์เวิร์ดนี้)
ใช้เป็นข้อมูลอ้างอิงเชิงมุมเท่านั้น — เขียน title ที่ "ต่าง" และ "ดีกว่า" ห้ามลอกหรือดัดแปลงเพียงเล็กน้อย และห้ามใส่ชื่อแบรนด์คู่แข่ง:
${lines.join('\n')}`;
}
