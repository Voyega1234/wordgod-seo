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

// ─── Thai → Latin transliteration (RTGS) ──────────────────────────────────────
// Used for URL slugs when no crawled path and no AI-supplied slug is available.
// Approximates the Royal Thai General System: readable and stable, not reversible.
// Tone marks and the silent mark are dropped, matching RTGS.

// Consonants differ in initial vs final position (ส = s / t, ล = l / n, ...).
const THAI_CONSONANTS: Record<string, { initial: string; final: string }> = {
  'ก': { initial: 'k', final: 'k' },
  'ข': { initial: 'kh', final: 'k' },
  'ฃ': { initial: 'kh', final: 'k' },
  'ค': { initial: 'kh', final: 'k' },
  'ฅ': { initial: 'kh', final: 'k' },
  'ฆ': { initial: 'kh', final: 'k' },
  'ง': { initial: 'ng', final: 'ng' },
  'จ': { initial: 'ch', final: 't' },
  'ฉ': { initial: 'ch', final: 't' },
  'ช': { initial: 'ch', final: 't' },
  'ซ': { initial: 's', final: 't' },
  'ฌ': { initial: 'ch', final: 't' },
  'ญ': { initial: 'y', final: 'n' },
  'ฎ': { initial: 'd', final: 't' },
  'ฏ': { initial: 't', final: 't' },
  'ฐ': { initial: 'th', final: 't' },
  'ฑ': { initial: 'th', final: 't' },
  'ฒ': { initial: 'th', final: 't' },
  'ณ': { initial: 'n', final: 'n' },
  'ด': { initial: 'd', final: 't' },
  'ต': { initial: 't', final: 't' },
  'ถ': { initial: 'th', final: 't' },
  'ท': { initial: 'th', final: 't' },
  'ธ': { initial: 'th', final: 't' },
  'น': { initial: 'n', final: 'n' },
  'บ': { initial: 'b', final: 'p' },
  'ป': { initial: 'p', final: 'p' },
  'ผ': { initial: 'ph', final: 'p' },
  'ฝ': { initial: 'f', final: 'p' },
  'พ': { initial: 'ph', final: 'p' },
  'ฟ': { initial: 'f', final: 'p' },
  'ภ': { initial: 'ph', final: 'p' },
  'ม': { initial: 'm', final: 'm' },
  'ย': { initial: 'y', final: 'i' },
  'ร': { initial: 'r', final: 'n' },
  'ล': { initial: 'l', final: 'n' },
  'ว': { initial: 'w', final: 'o' },
  'ศ': { initial: 's', final: 't' },
  'ษ': { initial: 's', final: 't' },
  'ส': { initial: 's', final: 't' },
  'ห': { initial: 'h', final: '' },
  'ฬ': { initial: 'l', final: 'n' },
  'อ': { initial: '', final: '' },
  'ฮ': { initial: 'h', final: '' },
};

// Vowel patterns keyed on the placeholder ๐ for the consonant slot. Ordered
// longest-first so multi-character vowels win over their own prefixes.
const THAI_VOWEL_PATTERNS: Array<[string, string]> = [
  ['เ๐ียะ', 'ia'], ['เ๐ือะ', 'uea'], ['เ๐าะ', 'o'], ['เ๐ีย', 'ia'],
  ['เ๐ือ', 'uea'], ['เ๐อะ', 'oe'], ['๐ัวะ', 'ua'], ['เ๐็อ', 'oe'],
  ['แ๐ะ', 'ae'], ['โ๐ะ', 'o'], ['เ๐อ', 'oe'], ['เ๐ะ', 'e'],
  ['๐ัว', 'ua'], ['๐ือ', 'ue'], ['๐ำ', 'am'], ['ไ๐', 'ai'],
  ['ใ๐', 'ai'], ['เ๐า', 'ao'], ['เ๐ิ', 'oe'], ['แ๐', 'ae'],
  ['โ๐', 'o'], ['เ๐', 'e'], ['๐ิ', 'i'], ['๐ี', 'i'],
  ['๐ึ', 'ue'], ['๐ื', 'ue'], ['๐ุ', 'u'], ['๐ู', 'u'],
  ['๐า', 'a'], ['๐อ', 'o'], ['๐ะ', 'a'], ['๐ั', 'a'],
  ['๐็', 'e'], ['ฤ', 'rue'], ['ฦ', 'lue'],
];

const THAI_TONE_MARKS = /[็-๎]/g;   // ็ ่ ้ ๊ ๋ ์ ํ ๎
const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

/**
 * Transliterate a Thai string to Latin characters using RTGS conventions.
 * Non-Thai characters pass through unchanged, so mixed strings such as
 * "วิธีสมัคร mobile app" become "withismak mobile app".
 */
export function romanizeThai(value: string): string {
  if (!containsThai(value)) return value;

  // Split on Thai runs so Latin/digit segments survive untouched.
  return value.replace(/[฀-๿]+/g, run => romanizeThaiRun(run));
}

function romanizeThaiRun(run: string): string {
  // ์ (thanthakhat) silences the consonant before it — drop both, per RTGS.
  let text = run.replace(/.์/g, '');
  text = text.replace(/[่-๋]/g, ''); // tone marks carry no letters
  text = text.replace(/ๆ/g, '');          // ๆ repetition mark
  text = text.replace(/๏|๚|๛/g, ''); // ๏ ๚ ๛
  // Trailing ร in a final cluster is silent: บัตร → bat, สมัคร → samak.
  text = text.replace(/([ก-ฮ])ร$/, '$1');

  let out = '';
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    const digitIndex = THAI_DIGITS.indexOf(ch);
    if (digitIndex !== -1) {
      out += String(digitIndex);
      i += 1;
      continue;
    }

    const matched = matchVowelCluster(text, i);
    if (matched) {
      out += matched.latin;
      i += matched.length;
      continue;
    }

    const consonant = THAI_CONSONANTS[ch];
    if (consonant) {
      const isLast = i === text.length - 1;
      if (isLast) {
        out += consonant.final || consonant.initial;
        i += 1;
        continue;
      }

      out += consonant.initial;
      // Two bare consonants in a row form a closed syllable with an unwritten
      // "o": คน → khon, รถ → rot, ยนต์ → yon.
      const next = text[i + 1];
      if (THAI_CONSONANTS[next] && !matchVowelCluster(text, i + 1)) {
        out += 'o';
      }
      i += 1;
      continue;
    }

    i += 1; // unmapped Thai codepoint (leftover mark) — skip
  }

  return out;
}

/** Match the longest vowel pattern anchored at `index`; returns null if none. */
function matchVowelCluster(
  text: string,
  index: number
): { latin: string; length: number } | null {
  for (const [pattern, latin] of THAI_VOWEL_PATTERNS) {
    const slot = pattern.indexOf('๐');

    if (slot === -1) {
      // Standalone vowel letter (ฤ, ฦ)
      if (text.startsWith(pattern, index)) {
        return { latin, length: pattern.length };
      }
      continue;
    }

    const before = pattern.slice(0, slot);
    const after = pattern.slice(slot + 1);

    if (before && !text.startsWith(before, index)) continue;

    const consonantIndex = index + before.length;
    const consonant = THAI_CONSONANTS[text[consonantIndex]];
    if (!consonant) continue;

    if (after && !text.startsWith(after, consonantIndex + 1)) continue;

    return {
      latin: consonant.initial + latin,
      length: before.length + 1 + after.length,
    };
  }

  return null;
}

/**
 * Build a URL-safe slug. Thai text is transliterated rather than stripped —
 * `\p{L}` excludes Thai vowel/tone marks (Unicode category Mn), so a plain
 * character-class filter would mangle "คือ" into "ค-อ".
 */
export function slugifyLatin(value: string, maxLength = 90): string {
  // Segment first: Thai has no spaces, so romanizing the raw string yields one
  // run-on blob ("yuemngoenoonlai"). Per-word romanization keeps the hyphens
  // that make a slug readable ("yuem-ngoen-onlai").
  const words = segmentWords(value, containsThai(value) ? 'th' : 'en');
  const source = words.length > 0 ? words.map(romanizeThai).join('-') : romanizeThai(value);

  return source
    .normalize('NFKD')
    .replace(THAI_TONE_MARKS, '')
    .replace(/[̀-ͯ]/g, '')  // strip Latin combining accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/, '');
}

