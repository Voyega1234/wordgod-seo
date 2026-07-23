/**
 * WordGod — Site Context Service (Step 0.1)
 *
 * Given a website URL:
 * 1. Fetch sitemap.xml (or sitemap_index.xml) → extract page URLs + categories
 * 2. Scrape Home, About, Contact pages → extract business context text
 * 3. Return structured SiteContext for use in pipeline keyword guidance
 *
 * Server-side only. Never expose to frontend directly.
 */

export interface SiteCategory {
  slug: string;       // URL path segment
  label: string;      // human-readable label
  url: string;        // full URL
  count?: number;     // number of pages in this category
}

export interface SiteContext {
  url: string;
  business_name?: string;
  business_description?: string;
  categories: SiteCategory[];
  key_pages: { url: string; title: string; snippet: string }[];
  sitemap_found: boolean;
  sitemap_url?: string;
  page_count: number;
  crawl_error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function normalizeUrl(input: string): string {
  let url = input.trim();
  if (!url.startsWith('http')) url = 'https://' + url;
  // Remove trailing slash
  return url.replace(/\/$/, '');
}

export function extractTextFromHtml(html: string, maxChars = 1500): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

export function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : '';
}

async function safeFetch(url: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'WordGod-SiteContext/1.0 (keyword research tool)' },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ─── Sitemap parser ───────────────────────────────────────────────────────────

export function parseSitemapUrls(xml: string): string[] {
  const urls: string[] = [];
  const matches = xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi);
  for (const m of matches) {
    urls.push(m[1].trim());
  }
  return urls;
}

async function fetchSitemap(baseUrl: string): Promise<{ urls: string[]; sitemapUrl: string } | null> {
  const candidates = [
    `${baseUrl}/sitemap.xml`,
    `${baseUrl}/sitemap_index.xml`,
    `${baseUrl}/sitemap`,
    `${baseUrl}/sitemap/sitemap.xml`,
  ];

  for (const url of candidates) {
    const xml = await safeFetch(url, 6000);
    if (!xml || xml.trim().length < 50) continue;
    if (!xml.includes('<url') && !xml.includes('<sitemap')) continue;

    let urls = parseSitemapUrls(xml);

    // Handle sitemap indexes broadly enough for real sites while keeping a
    // deterministic safety cap. Fetch independent child sitemaps in parallel.
    if (xml.includes('<sitemapindex') || xml.includes('<sitemap>')) {
      const childSitemaps = urls.filter(u => /\.xml(?:\?|$)/i.test(u)).slice(0, 25);
      const children = await Promise.all(childSitemaps.map(child => safeFetch(child, 6000)));
      const childUrls = children.flatMap(childXml => childXml ? parseSitemapUrls(childXml) : []);
      if (childUrls.length > 0) urls = childUrls;
    }

    if (urls.length > 0) return { urls, sitemapUrl: url };
  }

  return null;
}

// ─── Category extractor ────────────────────────────────────────────────────────

export function extractCategories(urls: string[], baseUrl: string): SiteCategory[] {
  const countMap = new Map<string, { count: number; url: string }>();

  for (const url of urls) {
    try {
      const path = new URL(url).pathname;
      const segments = path.split('/').filter(Boolean);
      if (segments.length === 0) continue;

      const localeSegments = new Set(['th', 'en', 'th-th', 'en-th', 'en-us']);
      const contentSegments = localeSegments.has(segments[0].toLowerCase()) ? segments.slice(1) : segments;
      const topSlug = contentSegments[0];
      if (!topSlug) continue;
      // Skip common non-content slugs
      if (['tag', 'tags', 'author', 'page', 'feed', 'wp-content', 'wp-admin', 'cdn', 'static', 'assets'].includes(topSlug)) continue;

      const existing = countMap.get(topSlug);
      if (existing) {
        existing.count++;
      } else {
        countMap.set(topSlug, { count: 1, url: `${baseUrl}/${topSlug}` });
      }
    } catch {}
  }

  // Sort by count desc, take top 20
  return [...countMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20)
    .map(([slug, { count, url }]) => ({
      slug,
      label: slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      url,
      count,
    }));
}

// ─── Key page scraper ─────────────────────────────────────────────────────────

function findKeyPages(urls: string[], baseUrl: string): string[] {
  const patterns = [
    /\/(about|about-us|เกี่ยวกับ|เกี่ยวกับเรา|about_us)\/?$/i,
    /\/(contact|contact-us|ติดต่อ|ติดต่อเรา)\/?$/i,
    /\/(product|products|service|services|loan|loans|credit|credit-line|insurance|saving|savings|account|accounts|card|cards|debit|pricing|ราคา)(?:\/|$)/i,
  ];

  const found: string[] = [baseUrl]; // always include home
  for (const url of urls) {
    try {
      const path = new URL(url).pathname;
      for (const pat of patterns) {
        if (pat.test(path) && !found.includes(url)) {
          found.push(url);
          break;
        }
      }
    } catch {}
    if (found.length >= 12) break;
  }
  return found.slice(0, 12);
}

// ─── Main function ────────────────────────────────────────────────────────────

export async function crawlSiteContext(rawUrl: string): Promise<SiteContext> {
  const baseUrl = normalizeUrl(rawUrl);
  const result: SiteContext = {
    url: baseUrl,
    categories: [],
    key_pages: [],
    sitemap_found: false,
    page_count: 0,
  };

  // Step 1: Fetch sitemap
  const sitemap = await fetchSitemap(baseUrl);
  if (sitemap) {
    result.sitemap_found = true;
    result.sitemap_url = sitemap.sitemapUrl;
    result.page_count = sitemap.urls.length;
    result.categories = extractCategories(sitemap.urls, baseUrl);

    // Step 2: Find key pages to scrape
    const keyPageUrls = findKeyPages(sitemap.urls, baseUrl);

    // Step 3: Scrape key pages in parallel (max 12)
    const scrapedPages = await Promise.all(
      keyPageUrls.map(async (url) => {
        const html = await safeFetch(url, 8000);
        if (!html) return null;
        const title = extractTitle(html);
        const snippet = extractTextFromHtml(html, 1500);
        return { url, title, snippet };
      })
    );

    result.key_pages = scrapedPages.filter(Boolean) as SiteContext['key_pages'];

    // Extract business name from home page title
    const homePage = result.key_pages.find(p => {
      try { return new URL(p.url).pathname === '/'; } catch { return false; }
    }) ?? result.key_pages[0];

    if (homePage?.title) {
      result.business_name = homePage.title.split(/[|\-–]/)[0].trim();
    }

    // Combine snippets for business description
    result.business_description = result.key_pages
      .map(p => p.snippet)
      .join(' ')
      .slice(0, 3000);
  } else {
    // No sitemap — try scraping home page directly
    result.crawl_error = 'Sitemap not found — scraped home page only';
    const html = await safeFetch(baseUrl, 8000);
    if (html) {
      const title = extractTitle(html);
      const snippet = extractTextFromHtml(html, 2000);
      result.key_pages = [{ url: baseUrl, title, snippet }];
      result.business_name = title.split(/[|\-–]/)[0].trim();
      result.business_description = snippet;
    }
  }

  return result;
}

// ─── Summarize for pipeline injection ────────────────────────────────────────

export function buildSiteContextSummary(ctx: SiteContext): string {
  const lines: string[] = [];

  if (ctx.business_name) lines.push(`Business: ${ctx.business_name}`);
  if (ctx.business_description) {
    lines.push(`About: ${ctx.business_description.slice(0, 800)}`);
  }
  if (ctx.categories.length > 0) {
    const cats = ctx.categories.slice(0, 15).map(c => `${c.label} (${c.count ?? '?'} pages)`).join(', ');
    lines.push(`Website categories: ${cats}`);
  }
  if (ctx.key_pages.length > 0) {
    const pages = ctx.key_pages
      .slice(0, 12)
      .map(page => `${page.title || 'Untitled'} — ${page.url}`)
      .join('\n');
    lines.push(`Existing important pages (avoid cannibalization and use as internal-link targets):\n${pages}`);
  }

  return lines.join('\n\n');
}

// ─── Niche-based category suggestion (no-website fallback) ───────────────────
// Called when user provides no site URL. Uses Gemini to suggest a realistic
// content category structure for the niche — same shape as sitemap-extracted
// categories, so the rest of the pipeline treats both paths identically.

export async function suggestCategoriesFromNiche(
  niche: string,
  businessContext: string,
  targetLanguage = 'th'
): Promise<SiteCategory[]> {
  const { callGemini } = await import('../gemini');

  const langHint = targetLanguage === 'th'
    ? 'Thai (use Thai words for labels, English for slugs)'
    : 'English';

  const prompt = `You are a content architect for a "${niche}" website (${businessContext}).
Suggest 10–15 realistic top-level content categories this site should have.
Language: ${langHint}

Rules:
- slug: English, lowercase, hyphens, max 3 words (e.g. "travel-insurance")
- label: human-readable in ${targetLanguage === 'th' ? 'Thai' : 'English'} (e.g. "ประกันการเดินทาง")
- Reflect real content pillars a "${niche}" site would need
- Cover a mix of: educational content, product/service categories, FAQs, comparison pages

Return JSON only:
{"categories":[{"slug":"example-slug","label":"ชื่อหมวด"},{"slug":"another","label":"หมวดอื่น"}]}`;

  try {
    const raw = await callGemini(prompt, {
      functionLabel: 'site_category_suggestion',
    });
    const items: Array<{ slug: string; label: string }> = raw.categories || [];
    return items
      .filter(c => c.slug && c.label)
      .slice(0, 15)
      .map(c => ({
        slug: c.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-'),
        label: c.label,
        url: `/${c.slug}`,
      }));
  } catch {
    return [];
  }
}
