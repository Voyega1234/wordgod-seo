import type { IntentRatio } from './intentRatioSkill';
import { buildIntentPromptSection, DEFAULT_RATIO } from './intentRatioSkill';

export type { IntentRatio };

// ─── Topic Cluster Role ────────────────────────────────────────────────────────
// Assigned per keyword. Determines its role in the content architecture.

export type TopicClusterRole =
  | 'parent_topic'       // broad pillar, can anchor a cluster
  | 'cluster_topic'      // supporting article within a cluster
  | 'faq_candidate'      // narrow question, best as FAQ entry or short article
  | 'supporting_keyword' // secondary keyword for an existing article
  | 'glossary'           // definition-only, encyclopedic
  | 'comparison'         // compares options, products, approaches
  | 'troubleshooting'    // problem/error/fix keyword
  | 'unknown';

// ─── Skill base (preserved) ────────────────────────────────────────────────────

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

### FORUM & SOCIAL PLATFORM BAN (ABSOLUTE — NO EXCEPTIONS)
NEVER generate any keyword that contains: pantip, sanook, wongnai, reddit, quora, twitter, facebook, youtube, tiktok, blockdit, medium
These are forum/social sites — we cannot rank for them, they must not appear anywhere.
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

// ─── Problem-First Context Section (Gap-Fill — Area 1, 4) ─────────────────────
// Injected into the Gemini prompt when customer problem context is available.
// Adds problem-first framing so Gemini prioritizes problem-solving keywords
// over high-volume generic terms.

export function buildProblemContextSection(opts: {
  customerProblems?: string[];
  painPoints?: string[];
  realCustomerQuestions?: string[];
  faqFromSalesTeam?: string[];
}): string {
  const lines: string[] = [];
  if (opts.customerProblems?.length) {
    lines.push('### Customer Problems (start here first)');
    opts.customerProblems.forEach(p => lines.push(`- ${p}`));
  }
  if (opts.painPoints?.length) {
    lines.push('### Pain Points');
    opts.painPoints.forEach(p => lines.push(`- ${p}`));
  }
  if (opts.realCustomerQuestions?.length) {
    lines.push('### Real Customer Questions');
    opts.realCustomerQuestions.forEach(q => lines.push(`- ${q}`));
  }
  if (opts.faqFromSalesTeam?.length) {
    lines.push('### FAQ from Sales Team');
    opts.faqFromSalesTeam.forEach(q => lines.push(`- ${q}`));
  }
  if (lines.length === 0) return '';

  return `
### CUSTOMER PROBLEM-FIRST CONTEXT
Use these real customer problems and questions as your PRIMARY source for keyword ideas.
Ask: "What search query would someone type when they have THIS problem?"
Do NOT rely on volume alone — prioritize keywords that address a real customer problem.

${lines.join('\n')}

### Problem-First Keyword Priority Rule
Prefer keywords that:
1. Address a specific customer problem or fear
2. Answer a real customer question
3. Help a customer make a buying decision with confidence
4. Resolve a usage problem or concern after purchase
5. Support a decision-maker (parent, caregiver, manager) choosing for someone else

Only use high-volume generic terms if they also connect to a real problem above.
`;
}

// ─── Topic Cluster Role Detection (Gap-Fill — Area 9) ─────────────────────────
// Rule-based classifier. Runs client-side / server-side, no Gemini needed.
// Complements the existing topicClusterSkill (which groups at cluster level).
// This assigns a per-keyword role before grouping.

export function detectTopicClusterRole(keyword: string, intent: string): TopicClusterRole {
  const kw = keyword.toLowerCase();
  const words = kw.trim().split(/\s+/).length;

  // Troubleshooting
  if (/ปัญหา|error|ไม่ทำงาน|แก้ไข|วิธีแก้|ค้าง|ขึ้น error|ซ่อม/.test(kw)) return 'troubleshooting';

  // Comparison
  if (/เปรียบเทียบ|vs\.?|ต่างกัน|ดีกว่า|ยี่ห้อไหน|รุ่นไหน|แบบไหนดี|ข้อดีข้อเสีย/.test(kw)) return 'comparison';

  // Glossary / Definition — short, pure definition
  if (/คืออะไร|หมายถึง|แปลว่าอะไร|นิยาม/.test(kw) && words <= 4) return 'glossary';

  // FAQ candidate — narrow question, short
  if (/ทำไม|ต้อง|ควร|เมื่อไหร่|ใช้ได้ไหม|ปลอดภัยไหม|ดีไหม/.test(kw) && words <= 5) return 'faq_candidate';

  // Parent topic — broad, short seed
  if (words <= 2 && intent === 'informational') return 'parent_topic';

  // Cluster topic — medium specificity
  if (words >= 3 && words <= 5) return 'cluster_topic';

  // Long-tail supporting
  if (words >= 6) return 'supporting_keyword';

  return 'unknown';
}

// ─── Main Prompt (original signature preserved — backward compatible) ──────────

export const KEYWORD_RESEARCH_PROMPT = (
  niche: string,
  seedKeyword: string,
  count: number,
  excludeKeywords: string[] = [],
  alreadyFound: string[] = [],
  intentRatio: IntentRatio = DEFAULT_RATIO,
  isKnowledgeMode = false,
  // Gap-Fill: problem-first context (optional — backward compatible)
  problemContext?: {
    customerProblems?: string[];
    painPoints?: string[];
    realCustomerQuestions?: string[];
    faqFromSalesTeam?: string[];
  }
) => {
  const allExclude = [...new Set([...excludeKeywords, ...alreadyFound])];
  const excludeSection = allExclude.length > 0
    ? `### EXCLUDE LIST (DO NOT return any of these or similar keywords)\n${allExclude.map(k => `- ${k}`).join('\n')}\n`
    : '';

  const skill = isKnowledgeMode ? KEYWORD_RESEARCH_SKILL_KNOWLEDGE : KEYWORD_RESEARCH_SKILL_STANDARD;
  const intentLines = buildIntentPromptSection(intentRatio, count, isKnowledgeMode);
  const problemSection = problemContext ? buildProblemContextSection(problemContext) : '';

  return `
${skill}
${problemSection}
### Task
Using Google Search grounding, find NEW unique keywords for:
- Niche: ${niche}
- Seed Topic: "${seedKeyword}"
- Number of NEW keywords needed: ${count}

### INTENT DISTRIBUTION (STRICT — must follow this ratio exactly)
${intentLines}

${excludeSection}
### Instructions
1. FIRST use Google Search to research real Thai search queries for "${niche}" — you MUST search before generating keywords
2. Generate exactly ${count} keywords that are NOT in the Exclude List above
3. Each keyword must be unique in topic/angle — no near-duplicates
4. STRICTLY follow the intent distribution above — do NOT over-produce any single intent
5. Vary lengths: mix short-tail (1-2 words) and long-tail (3-6 words)
6. For each keyword estimate: volume, competition, opportunity, intent, content type
7. For each keyword, classify its topic cluster role and journey stage
8. Search Volume is a SUPPORTING signal only — do not rank keywords by volume alone

### Volume Estimation Rules (CRITICAL — must be realistic)
Use Google Search grounding to estimate Thai monthly search volume as accurately as possible:
- Search for the keyword in Thai and check how many results appear, autocomplete suggestions, and related searches
- Short-tail (1-2 words), well-known terms: 1,000–50,000+/mo
- Medium-tail (3-4 words), specific topics: 100–5,000/mo
- Long-tail (5+ words), very specific questions: 10–500/mo
- Niche or technical terms with few results: 10–100/mo
- DO NOT default to 1,000 for everything — vary realistically based on actual search demand signals
- If grounding shows very few search results or no autocomplete, estimate 10–100/mo

### Topic Cluster Role options
- parent_topic: broad keyword that can anchor a cluster
- cluster_topic: specific keyword supporting a parent topic
- faq_candidate: narrow question, best as FAQ or short answer article
- supporting_keyword: secondary keyword that belongs inside another article
- glossary: pure definition / concept explanation
- comparison: compares options, products, or approaches
- troubleshooting: problem / error / fix keyword

### Customer Journey Stage options
- pre_purchase: comparing, evaluating, choosing before buying
- during_use: setup, usage problems, troubleshooting
- result_interpretation: understanding results, readings, numbers
- caregiver: buying or managing for someone else
- post_purchase: maintenance, renewal, upgrade after buying
- general_education: background knowledge, definitions

### Output
After searching Google, return your findings as JSON ONLY (no markdown, no explanation):
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
      "topic_cluster_role": "cluster_topic",
      "journey_stage": "pre_purchase",
      "customer_problem": "ปัญหาหรือคำถามของลูกค้าที่ keyword นี้ตอบ (1 ประโยค)",
      "money_page_opportunity": false,
      "reason": "เหตุผลสั้นๆ ว่าทำไมเลือก keyword นี้"
    }
  ]
}
`;
};
