/**
 * WordGod — Gemini Grounding Prompt for Keyword Research & SEO Title Expert
 *
 * Used when caller wants Gemini to GENERATE or EXPAND keyword ideas
 * with real search volume signals via Google Search grounding.
 */

import type { BusinessContext } from './types';

export function buildKeywordExpansionPrompt(
  seedKeywords: string[],
  ctx: BusinessContext,
  count: number,
  excludeKeywords: string[] = []
): string {
  const excludeSection = excludeKeywords.length > 0
    ? `### EXCLUDE LIST — DO NOT return these or near-duplicates:\n${excludeKeywords.map(k => `- ${k}`).join('\n')}\n`
    : '';

  return `
## WordGod — Keyword Research & SEO Title Expert

### Role
You are an expert Thai SEO keyword researcher for WordGod system.
Business: ${ctx.business_name || 'N/A'} | Type: ${ctx.business_type} | Category: ${ctx.category}
Target: Thai language, Thailand market

### Task
Using Google Search grounding, generate ${count} unique Thai keywords for this business.

Seed topics: ${seedKeywords.join(', ')}

${excludeSection}

### Keyword Requirements
- Mix types: seed, long_tail, question, commercial, comparison, problem, checklist
- Mix intents: informational, commercial, transactional, problem_solving, comparison
- Prioritize keywords with real Thai search volume signals
- Avoid brand-specific terms unless highly relevant
- All keywords must be in Thai (unless brand name is English)
- ABSOLUTE BAN: never generate keywords containing pantip, sanook, wongnai, reddit, quora, twitter, facebook, youtube, tiktok, blockdit, medium

### Volume Scoring
Estimate monthly search volume based on Google Search signals:
- 10,000+ = very high
- 5,000–10,000 = high
- 1,000–5,000 = medium
- 100–1,000 = low
- <100 = very low

### Return JSON ONLY (no markdown):
{
  "keywords": [
    {
      "keyword": "คีย์เวิร์ดภาษาไทย",
      "volume_estimate": 5000,
      "volume_score": 6,
      "competition": "Low",
      "opportunity_score": 75,
      "intent": "informational",
      "keyword_type": "long_tail",
      "reason": "เหตุผลสั้นๆ"
    }
  ]
}
`;
}

export function buildTitleGenerationPrompt(
  keywords: Array<{ keyword: string; intent: string; keyword_type: string }>,
  ctx: BusinessContext
): string {
  const kwList = keywords.map((k, i) =>
    `${i + 1}. keyword="${k.keyword}" intent="${k.intent}" type="${k.keyword_type}"`
  ).join('\n');

  return `
## WordGod — SEO Title (H1) Generator

### Role
You are an expert Thai SEO copywriter for WordGod system.
Business: ${ctx.business_name || 'N/A'} | Category: ${ctx.category}

### Rules
1. Title MUST contain the keyword or a natural variation
2. Write in natural Thai — NOT AI-sounding or robotic
3. FORBIDDEN words: ดีที่สุด, อันดับ 1, 100%, การันตี, เห็นผลแน่นอน, ผ่านแน่นอน
4. ABSOLUTE BAN in title: pantip, sanook, wongnai, reddit, facebook, youtube, tiktok, blockdit, medium
5. Match the search intent exactly
6. No keyword stuffing
7. Length: 40–100 Thai characters
8. Vary patterns — don't use the same structure for every title

### Intent → Title Style
- informational: explain what it is, benefits, how it works
- commercial: วิธีเลือก, ก่อนซื้อ, เหมาะกับใคร
- problem_solving: สาเหตุ, วิธีแก้, วิธีรับมือ
- comparison: เปรียบเทียบ, ต่างกันอย่างไร, ไหนดีกว่า
- transactional: ซื้อที่ไหน, ราคา, สั่ง
- checklist: เช็กลิสต์, ต้องรู้อะไรบ้าง
- review: รีวิว, ดีไหม, ข้อดีข้อเสีย

### Keywords to process:
${kwList}

### Return JSON ONLY:
{
  "titles": [
    {
      "keyword": "คีย์เวิร์ด",
      "title": "SEO Title ภาษาไทย"
    }
  ]
}
`;
}
