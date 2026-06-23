/**
 * WordGod — Competitor URL Keyword Extractor
 *
 * Parses competitor URLs and page titles from Gemini grounding citations
 * to extract additional keyword signals — zero extra API cost.
 *
 * Sources:
 *   - URL path segments → keyword candidates
 *   - Page titles → keyword phrases
 *   - Deduped against existing keyword set
 */

export interface CompetitorSignal {
  keyword: string;
  source: 'url_path' | 'page_title';
  url: string;
}

// Slug patterns to skip — navigation, boilerplate, non-keyword paths
const SKIP_SEGMENTS = new Set([
  'www', 'http', 'https', 'com', 'th', 'co', 'net', 'org',
  'index', 'page', 'category', 'tag', 'blog', 'news', 'article',
  'articles', 'post', 'posts', 'search', 'feed', 'rss', 'amp',
  'en', 'home', 'main', 'default', 'null', 'undefined',
  '1', '2', '3', '4', '5', 'p', 'id',
]);

const MIN_SLUG_LEN = 4;

function extractFromUrl(url: string): string[] {
  try {
    const u = new URL(url);
    // Decode path and split into segments
    const path = decodeURIComponent(u.pathname);
    const segments = path.split(/[\/\-_]+/).map(s => s.toLowerCase().trim()).filter(s => {
      if (s.length < MIN_SLUG_LEN) return false;
      if (SKIP_SEGMENTS.has(s)) return false;
      if (/^\d+$/.test(s)) return false;  // pure numbers
      if (/\.(html|php|asp|jsp|xml|json|css|js|png|jpg)$/.test(s)) return false;
      return true;
    });

    // Also try combining adjacent segments into phrases (max 4 words)
    const phrases: string[] = [...segments];
    for (let i = 0; i < segments.length - 1; i++) {
      phrases.push(`${segments[i]} ${segments[i + 1]}`);
      if (i < segments.length - 2) {
        phrases.push(`${segments[i]} ${segments[i + 1]} ${segments[i + 2]}`);
      }
    }
    return phrases;
  } catch {
    return [];
  }
}

function extractFromTitle(title: string): string[] {
  if (!title || title.length < 5) return [];
  // Split on common title separators
  const parts = title.split(/[\|\-–—:,]+/).map(p => p.trim()).filter(p => p.length >= 4 && p.length <= 80);
  // Return full title + each part as a candidate
  const results: string[] = [];
  if (title.length <= 80) results.push(title.trim());
  for (const p of parts) {
    if (!results.includes(p)) results.push(p);
  }
  return results;
}

export function extractCompetitorKeywords(
  urls: string[],
  titles: string[],
  existingKeywords: Set<string>
): CompetitorSignal[] {
  const signals: CompetitorSignal[] = [];
  const seen = new Set<string>(existingKeywords);

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const title = titles[i] ?? '';

    // URL path extraction
    for (const kw of extractFromUrl(url)) {
      const key = kw.toLowerCase().replace(/\s+/g, ' ');
      if (!seen.has(key)) {
        seen.add(key);
        signals.push({ keyword: kw, source: 'url_path', url });
      }
    }

    // Title extraction
    for (const kw of extractFromTitle(title)) {
      const key = kw.toLowerCase().replace(/\s+/g, ' ');
      if (!seen.has(key)) {
        seen.add(key);
        signals.push({ keyword: kw, source: 'page_title', url });
      }
    }
  }

  return signals;
}
