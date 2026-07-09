import { callGeminiWithGrounding, callGemini } from './gemini';
import { KEYWORD_RESEARCH_PROMPT } from './skills/keywordResearchSkill';
import { SEO_TITLE_PROMPT } from './skills/seoExpertSkill';

export interface KeywordResult {
  keyword: string;
  volume_estimate: number;
  volume_score: number;
  competition: string;
  opportunity_score: number;
  combined_score: number;
  intent: string;
  content_type: string;
  reason: string;
}

export interface TitleResult {
  title: string;
  ctr_score: number;
  seo_score: number;
  readability: number;
  notes: string;
}

export interface ResultRow {
  no: string;
  original_keyword: string;
  keyword: string;
  title: string;
  volume_estimate: number | string;
  volume_score: number | string;
  competition: string;
  opportunity_score: number | string;
  combined_score: string;
  intent: string;
  content_type: string;
  ctr_score: number | string;
  seo_score: number | string;
  readability: number | string;
  is_best: string;
  reason: string;
  title_notes: string;
}

const BATCH_SIZE = 30; // max keywords per Gemini call
const MAX_RETRIES = 2;

function normalize(kw: string) {
  return kw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Fetch keywords in batches until we reach targetCount unique results.
 * excludeKeywords = existing keywords from uploaded file (always exclude).
 * alreadyFound = keywords found in this session so far (rolling).
 */
export async function fetchUniqueKeywords(
  niche: string,
  seedKeyword: string,
  targetCount: number,
  excludeKeywords: string[],
  onProgress: (msg: string) => void
): Promise<KeywordResult[]> {
  const excludeSet = new Set(excludeKeywords.map(normalize));
  const collected: KeywordResult[] = [];
  let attempts = 0;
  const maxAttempts = Math.ceil(targetCount / BATCH_SIZE) + MAX_RETRIES;

  while (collected.length < targetCount && attempts < maxAttempts) {
    attempts++;
    const need = Math.min(BATCH_SIZE, targetCount - collected.length);
    const alreadyFound = collected.map(k => k.keyword);

    onProgress(`Batch ${attempts}: requesting ${need} keywords (got ${collected.length}/${targetCount} so far)...`);

    try {
      const prompt = KEYWORD_RESEARCH_PROMPT(niche, seedKeyword, need, excludeKeywords, alreadyFound);
      const result = await callGeminiWithGrounding(prompt, false, {
        functionLabel: 'legacy_keyword_research',
      });
      const batch: KeywordResult[] = result.keywords || [];

      let added = 0;
      for (const kw of batch) {
        const norm = normalize(kw.keyword);
        if (!excludeSet.has(norm)) {
          excludeSet.add(norm); // prevent future batches from repeating this
          collected.push(kw);
          added++;
          if (collected.length >= targetCount) break;
        }
      }

      onProgress(`Batch ${attempts}: added ${added} unique keywords`);

      // If batch returned nothing new, stop early
      if (added === 0) {
        onProgress(`No new keywords found in batch ${attempts} — stopping early at ${collected.length}`);
        break;
      }
    } catch (err: any) {
      onProgress(`Batch ${attempts} error: ${err.message}`);
      if (attempts >= maxAttempts) break;
    }

    // Small delay between batches
    if (collected.length < targetCount) {
      await new Promise(r => setTimeout(r, 800));
    }
  }

  return collected;
}

export async function processRow(
  no: string,
  seedTitle: string,
  seedKeyword: string,
  niche: string,
  onProgress: (msg: string) => void,
  keywordCount: number = 5,
  excludeKeywords: string[] = []
): Promise<ResultRow[]> {
  onProgress(`Researching "${seedKeyword}" — target: ${keywordCount} unique keywords`);

  let keywords: KeywordResult[] = [];
  try {
    keywords = await fetchUniqueKeywords(niche, seedKeyword, keywordCount, excludeKeywords, onProgress);
  } catch (err: any) {
    onProgress(`Research failed: ${err.message}`);
  }

  // Score: combined = vol*0.4 + opp*0.6
  const scored = keywords.map(k => ({
    ...k,
    combined_score: (k.volume_score || 5) * 0.4 + (k.opportunity_score || 5) * 0.6,
  }));
  scored.sort((a, b) => b.combined_score - a.combined_score);

  const best = scored[0] || {
    keyword: seedKeyword,
    volume_estimate: 500,
    volume_score: 5,
    competition: 'Medium',
    opportunity_score: 5,
    intent: 'Informational',
    content_type: 'Article',
    reason: 'Fallback to seed',
    combined_score: 5,
  };

  onProgress(`Best: "${best.keyword}" (vol:${best.volume_score} opp:${best.opportunity_score}) — generating title...`);

  let titleData: TitleResult = { title: seedTitle, ctr_score: 5, seo_score: 5, readability: 5, notes: 'Fallback' };
  try {
    const prompt = SEO_TITLE_PROMPT(best.keyword, niche, best.intent, best.content_type);
    titleData = await callGemini(prompt, {
      functionLabel: 'legacy_title_generation',
    });
  } catch (err: any) {
    onProgress(`Title generation failed: ${err.message}`);
  }

  const rows: ResultRow[] = scored.map((kw, idx) => ({
    no: idx === 0 ? no : `${no}.${idx + 1}`,
    original_keyword: seedKeyword,
    keyword: kw.keyword,
    title: idx === 0 ? (titleData.title || seedTitle) : '',
    volume_estimate: kw.volume_estimate || '',
    volume_score: kw.volume_score || '',
    competition: kw.competition || '',
    opportunity_score: kw.opportunity_score || '',
    combined_score: kw.combined_score?.toFixed(1) || '',
    intent: kw.intent || '',
    content_type: kw.content_type || '',
    ctr_score: idx === 0 ? (titleData.ctr_score || '') : '',
    seo_score: idx === 0 ? (titleData.seo_score || '') : '',
    readability: idx === 0 ? (titleData.readability || '') : '',
    is_best: idx === 0 ? 'YES' : '',
    reason: kw.reason || '',
    title_notes: idx === 0 ? (titleData.notes || '') : '',
  }));

  if (rows.length === 0) {
    rows.push({
      no,
      original_keyword: seedKeyword,
      keyword: seedKeyword,
      title: titleData.title || seedTitle,
      volume_estimate: '', volume_score: '', competition: '',
      opportunity_score: '', combined_score: '', intent: '', content_type: '',
      ctr_score: titleData.ctr_score || '', seo_score: titleData.seo_score || '',
      readability: titleData.readability || '', is_best: 'YES',
      reason: 'No variations found', title_notes: titleData.notes || '',
    });
  }

  return rows;
}
