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

export function buildSeoTitleAiPrompt(
  requests: TitleRequest[],
  targetLanguage: string = 'th'
): string {
  const kwList = requests.map((r, i) =>
    `${i + 1}. keyword="${r.keyword}" | volume=${r.volume} | competition=${r.competition} | intent=${r.intent} | type=${r.keyword_type} | content_type=${r.content_type}`
  ).join('\n');

  const sampleBusiness = requests[0];

  return `## WordGod — SEO + AEO + AI Search Title Expert

### System Context
Business/Site: ${sampleBusiness.business_context}
Category: ${sampleBusiness.category}
Language: ${targetLanguage === 'th' ? 'Thai (ภาษาไทย)' : 'English'}
Date: ${new Date().getFullYear() + 543} (Buddhist Era) / ${new Date().getFullYear()}

### Your Role
You are a senior SEO + AEO + AI Search content strategist. You write H1/Title tags that:

1. **SEO** — Rank on Google: keyword appears early, 50–70 chars, matches search intent, triggers clicks
2. **AEO** — Win featured snippets & People Also Ask boxes: title is a clear question or implies a direct answer
3. **AI Search** — Get cited by ChatGPT, Perplexity, Gemini: title is specific, factual framing, not vague; sounds like an authoritative source, not clickbait

### Absolute Rules
- FORBIDDEN words: ดีที่สุด, อันดับ 1, 100%, การันตี, เห็นผลแน่นอน, ผ่านแน่นอน, รับประกัน
- MUST contain the exact keyword or a very close variation (Thai inflection OK)
- Write in natural Thai — NOT AI-sounding, NOT robotic
- Title length: 40–80 Thai characters
- NEVER repeat the same pattern across multiple keywords — vary structure, style, framing
- One title per keyword — pick the BEST one, no alternatives

### SEO / AEO / AI Search Scoring (each 1–10)
- **SEO score**: keyword in first 30 chars, intent match, 50–70 char length, no stuffing
- **AEO score**: phrased as question or implies a direct factual answer, good for featured snippet
- **AI Search score**: specific + authoritative framing, AI would cite this as a credible source
- **CTR score**: emotional trigger or curiosity hook without clickbait or forbidden words

### Intent → Title Strategy
- informational → explain, define, what/why/how framing (good for AEO questions)
- commercial → วิธีเลือก, ก่อนตัดสินใจ, เปรียบเทียบ (decision stage)
- transactional → ซื้อที่ไหน, ราคา, ขั้นตอน, สั่ง
- problem_solving → สาเหตุคืออะไร, วิธีแก้, ทำอย่างไร (great for PAA)
- comparison → [A] vs [B], ต่างกันอย่างไร, ไหนดีกว่าสำหรับ...
- review → รีวิว, ข้อดีข้อเสีย, ดีจริงไหม
- checklist → ต้องรู้ X ข้อ, เช็กลิสต์, สิ่งที่ต้องเตรียม
- price → ค่าใช้จ่าย, งบเท่าไร, เปรียบเทียบราคา
- service_seeking → บริการ, ขั้นตอน, ใช้บริการอย่างไร

### AEO Question Field
For each keyword, also write a short natural-language question (aeo_question) that:
- Is exactly how a user would type it into Google or ask Gemini/ChatGPT
- Matches the keyword's intent
- Can be answered in 1–3 sentences (makes it a featured-snippet candidate)
- Example: keyword="วีซ่าเชงเก้น" → aeo_question="วีซ่าเชงเก้นคืออะไร และต้องใช้เอกสารอะไรบ้าง?"

### Keywords to process:
${kwList}

### Return ONLY valid JSON (no markdown, no explanation):
{
  "titles": [
    {
      "keyword": "คีย์เวิร์ด",
      "title": "SEO H1 title ภาษาไทยที่ดีที่สุดสำหรับ keyword นี้",
      "aeo_question": "คำถามธรรมชาติที่ผู้ใช้จะถาม AI หรือ Google",
      "seo_score": 8,
      "aeo_score": 9,
      "ai_search_score": 8,
      "ctr_score": 7,
      "notes": "เหตุผลสั้นๆ ว่าทำไม title นี้ถึงดี"
    }
  ]
}`;
}
