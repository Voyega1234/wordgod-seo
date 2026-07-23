/**
 * WordGod — Deep Site Crawl + Rule-Based EEAT Signal Extraction (Phase 1)
 *
 * Given a website URL, discovers same-origin pages (sitemap first, BFS fallback),
 * fetches them with a bounded concurrency pool, and extracts rule-based
 * (regex-only, no LLM) EEAT (Experience, Expertise, Authoritativeness,
 * Trustworthiness) signals per page.
 *
 * Additive to the existing sitemap-only crawler (siteContextService.ts) —
 * reuses its pure helpers but never touches its exported API.
 *
 * Server-side only. Never expose to frontend directly.
 */

import {
  extractCategories,
  extractTextFromHtml,
  extractTitle,
  normalizeUrl,
  parseSitemapUrls,
  type SiteCategory,
} from './siteContextService';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface DeepCrawlOptions {
  maxPages?: number;
  crawlBudgetMs?: number;
  maxDepth?: number;
  concurrency?: number;
  perFetchTimeoutMs?: number;
  textMaxChars?: number;
}

export interface PageEeatSignals {
  wordCount: number;
  headingCount: number;
  hasAuthorByline: boolean;
  hasPublishDate: boolean;
  hasStructuredData: boolean;
  hasContactInfo: boolean;
}

export interface CrawledPage {
  url: string;
  status: number;
  ok: boolean;
  title: string;
  metaDescription: string;
  h1: string[];
  headings: string[];
  wordCount: number;
  text: string;
  category: string | null;
  eeat: PageEeatSignals;
  missingSignals: string[];
}

export interface CrawlCoverage {
  discovered: number;
  fetched: number;
  failed: number;
  capped: boolean;
  capReason?: 'pages' | 'time';
  durationMs: number;
  source: 'sitemap' | 'bfs' | 'mixed';
}

export interface EeatSummary {
  totalPages: number;
  avgWordCount: number;
  pagesThinContent: number;
  pagesMissingAuthor: number;
  pagesMissingDate: number;
  pagesMissingStructuredData: number;
}

export interface DeepCrawlResult {
  baseUrl: string;
  sitemapFound: boolean;
  sitemapUrl: string | null;
  pages: CrawledPage[];
  categories: SiteCategory[];
  coverage: CrawlCoverage;
  eeatSummary: EeatSummary;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<DeepCrawlOptions> = {
  maxPages: 150,
  crawlBudgetMs: 120_000,
  maxDepth: 3,
  concurrency: 8,
  perFetchTimeoutMs: 8000,
  textMaxChars: 4000,
};

const THIN_CONTENT_WORD_THRESHOLD = 300;
const MAX_CHILD_SITEMAPS = 10;

// ─── Regex signal detectors ───────────────────────────────────────────────────

const AUTHOR_RE = /rel=["']author["']|itemprop=["']author["']|class=["'][^"']*author|property=["']article:author|\bโดย\s|\bby\s+[A-Z]/i;
const DATE_RE = /itemprop=["']datePublished|property=["']article:published_time|datetime=|\bpublished\b|\bเผยแพร่\b/i;
const STRUCTURED_DATA_RE = /application\/ld\+json|itemscope|itemtype=/i;
const CONTACT_RE = /mailto:|tel:|ติดต่อ|\bcontact\b/i;

// ─── Fetch helper (injectable) ───────────────────────────────────────────────

async function safeFetchText(url: string, fetcher: FetchLike, timeoutMs: number): Promise<string | null> {
  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function safeFetchPage(
  url: string,
  fetcher: FetchLike,
  timeoutMs: number
): Promise<{ status: number; ok: boolean; html: string | null }> {
  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs) });
    const html = res.ok ? await res.text() : null;
    return { status: res.status, ok: res.ok, html };
  } catch {
    return { status: 0, ok: false, html: null };
  }
}

// ─── HTML extraction helpers (new, additive to service) ──────────────────────

function extractMetaDescription(html: string): string {
  const m = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i);
  return m ? m[1].trim() : '';
}

function extractH1(html: string): string[] {
  const matches = html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi);
  const out: string[] = [];
  for (const m of matches) {
    const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) out.push(text);
  }
  return out;
}

function extractHeadings(html: string): string[] {
  const matches = html.matchAll(/<h[123][^>]*>([\s\S]*?)<\/h[123]>/gi);
  const out: string[] = [];
  for (const m of matches) {
    const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) out.push(text);
  }
  return out;
}

function extractSameOriginLinks(html: string, origin: string): string[] {
  const links: string[] = [];
  const matches = html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi);
  for (const m of matches) {
    const href = m[1].trim();
    if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    try {
      const resolved = new URL(href, origin);
      if (resolved.origin === origin) {
        links.push(resolved.toString().replace(/\/$/, ''));
      }
    } catch {
      // ignore invalid URLs
    }
  }
  return links;
}

function matchCategoryForUrl(url: string, categories: SiteCategory[]): string | null {
  try {
    const path = new URL(url).pathname;
    const segments = path.split('/').filter(Boolean);
    for (const cat of categories) {
      if (segments.includes(cat.slug)) return cat.slug;
    }
  } catch {
    // ignore
  }
  return null;
}

// ─── EEAT signal extraction ──────────────────────────────────────────────────

function extractEeatSignals(html: string, text: string, headingCount: number): PageEeatSignals {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return {
    wordCount,
    headingCount,
    hasAuthorByline: AUTHOR_RE.test(html),
    hasPublishDate: DATE_RE.test(html),
    hasStructuredData: STRUCTURED_DATA_RE.test(html),
    hasContactInfo: CONTACT_RE.test(html) || CONTACT_RE.test(text),
  };
}

function computeMissingSignals(eeat: PageEeatSignals): string[] {
  const missing: string[] = [];
  if (!eeat.hasAuthorByline) missing.push('author');
  if (!eeat.hasPublishDate) missing.push('date');
  if (!eeat.hasStructuredData) missing.push('structuredData');
  if (eeat.wordCount < THIN_CONTENT_WORD_THRESHOLD) missing.push('thinContent');
  if (eeat.headingCount === 0) missing.push('noHeadings');
  return missing;
}

// ─── Discovery ────────────────────────────────────────────────────────────────

interface DiscoveryResult {
  urls: string[];
  sitemapFound: boolean;
  sitemapUrl: string | null;
  source: 'sitemap' | 'bfs' | 'mixed';
}

async function discoverViaSitemap(
  origin: string,
  fetcher: FetchLike,
  timeoutMs: number
): Promise<{ urls: string[]; sitemapUrl: string } | null> {
  const sitemapUrl = `${origin}/sitemap.xml`;
  const xml = await safeFetchText(sitemapUrl, fetcher, timeoutMs);
  if (!xml || xml.trim().length < 20) return null;

  let urls = parseSitemapUrls(xml);
  const looksLikeIndex = urls.length > 0 && urls.every(u => /\.xml(?:\?|$)/i.test(u));

  if (looksLikeIndex || xml.includes('<sitemapindex')) {
    const childSitemaps = urls.filter(u => /\.xml(?:\?|$)/i.test(u)).slice(0, MAX_CHILD_SITEMAPS);
    const children = await Promise.all(childSitemaps.map(child => safeFetchText(child, fetcher, timeoutMs)));
    const childUrls = children.flatMap(childXml => (childXml ? parseSitemapUrls(childXml) : []));
    if (childUrls.length > 0) urls = childUrls;
  }

  if (urls.length === 0) return null;
  return { urls, sitemapUrl };
}

async function discoverViaBfs(
  homeUrl: string,
  origin: string,
  fetcher: FetchLike,
  opts: Required<DeepCrawlOptions>,
  start: number
): Promise<string[]> {
  const visited = new Set<string>([homeUrl]);
  const discovered: string[] = [homeUrl];
  const frontier: { url: string; depth: number }[] = [{ url: homeUrl, depth: 0 }];

  while (frontier.length > 0) {
    if (discovered.length >= opts.maxPages) break;
    if (Date.now() - start > opts.crawlBudgetMs) break;

    const { url, depth } = frontier.shift()!;
    if (depth >= opts.maxDepth) continue;

    const html = await safeFetchText(url, fetcher, opts.perFetchTimeoutMs);
    if (!html) continue;

    const links = extractSameOriginLinks(html, origin);
    for (const link of links) {
      if (visited.has(link)) continue;
      visited.add(link);
      discovered.push(link);
      frontier.push({ url: link, depth: depth + 1 });
      if (discovered.length >= opts.maxPages) break;
    }

    if (Date.now() - start > opts.crawlBudgetMs) break;
  }

  return discovered;
}

async function discoverUrls(
  baseUrl: string,
  origin: string,
  fetcher: FetchLike,
  opts: Required<DeepCrawlOptions>,
  start: number
): Promise<DiscoveryResult> {
  const sitemapResult = await discoverViaSitemap(origin, fetcher, opts.perFetchTimeoutMs);

  if (sitemapResult && sitemapResult.urls.length > 0) {
    const sameOrigin = sitemapResult.urls.filter(u => {
      try {
        return new URL(u).origin === origin;
      } catch {
        return false;
      }
    });
    return {
      urls: sameOrigin.slice(0, opts.maxPages),
      sitemapFound: true,
      sitemapUrl: sitemapResult.sitemapUrl,
      source: 'sitemap',
    };
  }

  const bfsUrls = await discoverViaBfs(baseUrl, origin, fetcher, opts, start);
  return {
    urls: bfsUrls.slice(0, opts.maxPages),
    sitemapFound: false,
    sitemapUrl: null,
    source: 'bfs',
  };
}

// ─── Bounded concurrency pool ─────────────────────────────────────────────────

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runOne(): Promise<void> {
    while (true) {
      const idx = nextIndex++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runOne());
  await Promise.all(workers);
  return results;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function crawlSiteDeep(
  rawUrl: string,
  opts: DeepCrawlOptions = {},
  fetcher: FetchLike = fetch
): Promise<DeepCrawlResult> {
  const start = Date.now();
  const options: Required<DeepCrawlOptions> = { ...DEFAULT_OPTIONS, ...opts };

  const baseUrl = normalizeUrl(rawUrl);
  const origin = new URL(baseUrl).origin;

  const discovery = await discoverUrls(baseUrl, origin, fetcher, options, start);

  let capped = false;
  let capReason: 'pages' | 'time' | undefined;

  let urlsToFetch = discovery.urls;
  if (urlsToFetch.length >= options.maxPages) {
    capped = true;
    capReason = 'pages';
  }
  if (Date.now() - start > options.crawlBudgetMs) {
    capped = true;
    capReason = 'time';
  }
  urlsToFetch = urlsToFetch.slice(0, options.maxPages);

  const categories = extractCategories(discovery.urls, baseUrl);

  let failed = 0;

  const fetchResults = await runWithConcurrency(urlsToFetch, options.concurrency, async (url) => {
    if (Date.now() - start > options.crawlBudgetMs) {
      capped = true;
      capReason = capReason ?? 'time';
      return null;
    }

    const { status, ok, html } = await safeFetchPage(url, fetcher, options.perFetchTimeoutMs);
    if (!html) {
      failed++;
      return null;
    }

    const title = extractTitle(html);
    const metaDescription = extractMetaDescription(html);
    const h1 = extractH1(html);
    const headings = extractHeadings(html);
    const text = extractTextFromHtml(html, options.textMaxChars);
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const category = matchCategoryForUrl(url, categories);
    const eeat = extractEeatSignals(html, text, headings.length);
    const missingSignals = computeMissingSignals(eeat);

    const page: CrawledPage = {
      url,
      status,
      ok,
      title,
      metaDescription,
      h1,
      headings,
      wordCount,
      text,
      category,
      eeat,
      missingSignals,
    };
    return page;
  });

  const pages = fetchResults.filter((p): p is CrawledPage => p !== null);

  const durationMs = Date.now() - start;
  if (durationMs > options.crawlBudgetMs) {
    capped = true;
    capReason = capReason ?? 'time';
  }

  const totalPages = pages.length;
  const avgWordCount = totalPages > 0
    ? Math.round(pages.reduce((sum, p) => sum + p.wordCount, 0) / totalPages)
    : 0;
  const pagesThinContent = pages.filter(p => p.wordCount < THIN_CONTENT_WORD_THRESHOLD).length;
  const pagesMissingAuthor = pages.filter(p => !p.eeat.hasAuthorByline).length;
  const pagesMissingDate = pages.filter(p => !p.eeat.hasPublishDate).length;
  const pagesMissingStructuredData = pages.filter(p => !p.eeat.hasStructuredData).length;

  const eeatSummary: EeatSummary = {
    totalPages,
    avgWordCount,
    pagesThinContent,
    pagesMissingAuthor,
    pagesMissingDate,
    pagesMissingStructuredData,
  };

  const coverage: CrawlCoverage = {
    discovered: discovery.urls.length,
    fetched: totalPages,
    failed,
    capped,
    ...(capReason ? { capReason } : {}),
    durationMs,
    source: discovery.source,
  };

  return {
    baseUrl,
    sitemapFound: discovery.sitemapFound,
    sitemapUrl: discovery.sitemapUrl,
    pages,
    categories,
    coverage,
    eeatSummary,
  };
}
