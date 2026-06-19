import type { IntentRatio } from './intentRatioSkill';
import { buildIntentPromptSection, DEFAULT_RATIO } from './intentRatioSkill';

export type { IntentRatio };

const KEYWORD_RESEARCH_SKILL_BASE = `
## SKILL: Keyword Research Expert — No-Duplicate Mode

### Role
You are a professional keyword researcher. Your job is to find low-competition, high-opportunity Thai keywords that DO NOT DUPLICATE any existing keyword list provided.

### Core Criteria

**Volume Score (1-10):**
- 10 = 10,000+ / 8-9 = 5,000–10,000 / 6-7 = 1,000–5,000 / 4-5 = 500–1,000 / 2-3 = 100–500 / 1 = <100 monthly searches

**Opportunity Score (1-10):**
- 10 = Very low competition, high intent, easy to rank
- 7-9 = Moderate competition, clear intent, rankable with quality content
- 4-6 = Medium competition, rankable with effort
- 1-3 = High competition, dominated by authority sites

### DEDUPLICATION RULES (CRITICAL)
- NEVER return a keyword that already exists in the "Exclude List" below
- Check both exact match AND near-match (same meaning, different spelling)
- If a keyword topic is already covered, find a DIFFERENT angle or sub-topic
- Aim for keyword DIVERSITY: mix intents, lengths, and sub-topics
`;

const KEYWORD_RESEARCH_SKILL_STANDARD = KEYWORD_RESEARCH_SKILL_BASE + `
### Priority Targets (Standard Mode)
1. Long-tail keywords (3-5 words Thai)
2. Question-based: "อะไรคือ", "วิธี", "ทำไม", "ดีไหม"
3. Comparison: "เทียบ", "vs", "ดีกว่า", "ยี่ห้อไหนดี"
4. Best-of: "ดีที่สุด", "แนะนำ", "รีวิว"
5. Transactional: "ราคา", "ซื้อ", "บริการ", "ติดต่อ", "รับทำ"
`;

const KEYWORD_RESEARCH_SKILL_KNOWLEDGE = KEYWORD_RESEARCH_SKILL_BASE + `
### Priority Targets (Knowledge Mode)
1. Long-tail educational keywords (3-5 words Thai)
2. Definition/explanation: "คืออะไร", "หมายถึง", "คือ"
3. How-it-works: "ทำงานอย่างไร", "ทำงานยังไง", "ทำอย่างไร"
4. Concept comparison: "ต่างกันอย่างไร", "เหมือนกันอย่างไร"
5. Process/checklist: "ขั้นตอน", "เช็กลิสต์", "ข้อควรรู้", "ต้องใช้อะไรบ้าง"
6. FAQ-style: "ทำไม", "เมื่อไหร่", "ใครควร"

### HARD FORBIDDEN in Knowledge Mode
NEVER generate keywords that contain or imply:
- ราคา, ค่าบริการ, โปรโมชั่น, แพ็กเกจ, ส่วนลด
- ซื้อ, สั่ง, จอง, สมัคร
- รับทำ, รับยื่น, รับแปล, บริการ (ในแง่การขาย)
- ติดต่อ, โทร, LINE, แอดไลน์, ขอใบเสนอราคา
- รีวิวสินค้า, รีวิวบริการ, ยี่ห้อไหนดี (เพื่อซื้อ), แนะนำสินค้า
- affiliate, commission, ลิงก์แนะนำ
`;

export const KEYWORD_RESEARCH_SKILL = KEYWORD_RESEARCH_SKILL_STANDARD;

export const KEYWORD_RESEARCH_PROMPT = (
  niche: string,
  seedKeyword: string,
  count: number,
  excludeKeywords: string[] = [],
  alreadyFound: string[] = [],
  intentRatio: IntentRatio = DEFAULT_RATIO,
  isKnowledgeMode = false
) => {
  const allExclude = [...new Set([...excludeKeywords, ...alreadyFound])];
  const excludeSection = allExclude.length > 0
    ? `### EXCLUDE LIST (DO NOT return any of these or similar keywords)\n${allExclude.map(k => `- ${k}`).join('\n')}\n`
    : '';

  const skill = isKnowledgeMode ? KEYWORD_RESEARCH_SKILL_KNOWLEDGE : KEYWORD_RESEARCH_SKILL_STANDARD;
  const intentLines = buildIntentPromptSection(intentRatio, count, isKnowledgeMode);

  return `
${skill}

### Task
Using Google Search grounding, find NEW unique keywords for:
- Niche: ${niche}
- Seed Topic: "${seedKeyword}"
- Number of NEW keywords needed: ${count}

### INTENT DISTRIBUTION (STRICT — must follow this ratio exactly)
${intentLines}

${excludeSection}
### Instructions
1. Use Google Search grounding to find real Thai search data
2. Generate exactly ${count} keywords that are NOT in the Exclude List above
3. Each keyword must be unique in topic/angle — no near-duplicates
4. STRICTLY follow the intent distribution above — do NOT over-produce any single intent
5. Vary lengths: mix short-tail (1-2 words) and long-tail (3-6 words)
6. For each keyword estimate: volume, competition, opportunity, intent, content type

### Return JSON format ONLY (no markdown, no explanation):
{
  "keywords": [
    {
      "keyword": "คำหลักภาษาไทย",
      "volume_estimate": 1000,
      "volume_score": 7,
      "competition": "Low",
      "opportunity_score": 8,
      "intent": "Informational",
      "content_type": "Article",
      "reason": "เหตุผลสั้นๆ ว่าทำไมเลือก keyword นี้"
    }
  ]
}
`;
};
