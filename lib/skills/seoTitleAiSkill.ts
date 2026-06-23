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
