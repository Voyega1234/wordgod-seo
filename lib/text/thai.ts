/**
 * Thai-aware text helpers shared by keyword scoring, grouping, and planning.
 * Intl.Segmenter understands Thai word boundaries without relying on spaces.
 */

const THAI_CHARACTER = /[\u0E00-\u0E7F]/;

const segmenters = new Map<string, Intl.Segmenter>();

function getSegmenter(locale: string): Intl.Segmenter | null {
  if (typeof Intl.Segmenter !== 'function') return null;
  const cached = segmenters.get(locale);
  if (cached) return cached;
  const segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
  segmenters.set(locale, segmenter);
  return segmenter;
}

export function segmentWords(value: string, locale = 'th'): string[] {
  const text = value.trim().toLowerCase();
  if (!text) return [];

  const segmenter = getSegmenter(locale);
  if (segmenter) {
    const words = [...segmenter.segment(text)]
      .filter(part => part.isWordLike)
      .map(part => part.segment.trim())
      .filter(Boolean);
    if (words.length > 0) return words;
  }

  return text
    .split(/[^\p{L}\p{N}]+/u)
    .map(word => word.trim())
    .filter(Boolean);
}

export function countWords(value: string, locale = 'th'): number {
  return segmentWords(value, locale).length;
}

export function containsThai(value: string): boolean {
  return THAI_CHARACTER.test(value);
}

export function keywordTokens(value: string, locale = 'th'): Set<string> {
  return new Set(
    segmentWords(value, locale).filter(token => token.length > 1 || /\d/.test(token))
  );
}

export function tokenSimilarity(a: string, b: string, locale = 'th'): number {
  const aTokens = keywordTokens(a, locale);
  const bTokens = keywordTokens(b, locale);
  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection++;
  }
  const union = new Set([...aTokens, ...bTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

export function truncateWords(value: string, maxWords: number, locale = 'th'): string {
  if (maxWords <= 0) return '';
  const words = segmentWords(value, locale);
  if (words.length <= maxWords) return value.trim();
  return words.slice(0, maxWords).join(containsThai(value) ? '' : ' ');
}

