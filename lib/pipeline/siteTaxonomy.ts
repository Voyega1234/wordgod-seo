/**
 * WordGod — Site Taxonomy & Money-Page Derivation
 *
 * Pure, deterministic. Turns a deep-crawl result into the site's REAL business
 * taxonomy: the actual service/product pillars and their canonical money pages,
 * as `PlanPillarInput[]` the content planner already understands.
 *
 * Why: the pipeline otherwise invents pillars by clustering keywords, so it does
 * not know a site's true services or money-page URLs (e.g. /th/savings-account/).
 * A human-supplied `planPillars` always wins; this module fills that gap
 * automatically from what was actually crawled when no override is given.
 *
 * No network, no LLM, no randomness — same crawl in ⇒ same taxonomy out.
 */

import type { DeepCrawlResult } from '../services/siteCrawlService';
import type { PlanPillarInput } from '../planning/contentPlan';

/** Minimal page shape money-page detection needs — a deep-crawl CrawledPage
 *  satisfies it, and so does a shallow `{ url }` from a sitemap/category list. */
export interface MoneyPageInput {
  url: string;
  ok?: boolean;        // default true (assume readable when unknown)
  wordCount?: number;  // default 1 (assume non-empty when unknown)
  eeat?: { hasStructuredData?: boolean; hasContactInfo?: boolean };
}

/** Structural category shape shared by deep-crawl and shallow SiteContext. */
type CategoryInput = { slug: string; label?: string; url: string; count?: number };

// ─── Money-page detection ──────────────────────────────────────────────────────

// Strong intent: the page IS a conversion / lead / purchase action. Universal
// across industries — ecommerce (checkout, cart), services & agencies (contact,
// quote), booking (book, reserve, appointment), SaaS (trial, demo), education
// (enrol), non-profit (donate), finance (apply, open-account). EN path words +
// bare Thai terms (Thai has no \b word boundary, so match as substrings).
const APPLY_STRONG_RE =
  /\/(apply|register|sign-?up|signup|open-?account|checkout|orders?|subscribe|get-?started|buy|purchase|add-to-cart|cart|book(ing)?|reserve|reservation|quote|get-?a-?quote|request-?(a-?)?quote|consultation|contact|enquir(e|y)|inquiry|appointment|schedule|demos?|free-?trial|trial|donate|enrol(l)?|join)\b|สมัคร|เปิดบัญชี|สั่งซื้อ|สั่งจอง|จอง|ขอใบเสนอราคา|ขอราคา|ติดต่อเรา|ติดต่อ|นัดหมาย|ปรึกษา|สั่งทำ|จ้าง|ทดลองใช้|ลงทะเบียน/i;

// Product / service / catalog / offer landing — universal commercial signals
// across ecommerce, services, hospitality, real estate, education, health,
// SaaS, plus the original finance terms (backward-compatible).
const PRODUCT_PATH_RE =
  /\/(products?|shop|store|pricing|price|plans?|packages?|deals?|offers?|promo|promotions?|services?|solutions?|catalog|catalogue|collections?|items?|menus?|delivery|membership|subscription|courses?|class|classes|programs?|programme|lessons?|rooms?|property|properties|listings?|rentals?|sales?|portfolio|works|projects?|case-stud(y|ies)|treatments?|clinics?|tickets?|tours?|vehicles?|cars?|downloads?|buy|accounts?|cards?|credit|credit-line|loans?|deposit|savings|insurance|mortgage)\b|สินค้า|ร้านค้า|ราคา|แพ็กเกจ|บริการ|โซลูชัน|คอร์ส|เรียน|ผลงาน|โปรโมชั่น|โปรโมชัน|ห้องพัก|เมนู|อสังหา|คอนโด|รับทำ|ออกแบบ|ทัวร์|ตั๋ว|บัตร|สินเชื่อ|ประกัน|เงินฝาก|บัญชี/i;

// Blog / informational / policy signals — these are NOT money pages.
const INFO_PATH_RE = /\/(blog|articles?|news|guides?|how-to|tips|faq|help|support|category|tag|author|about|privacy|terms|cookie|sitemap|careers?|jobs)\b|บทความ|ข่าว|คู่มือ|เกี่ยวกับ|นโยบาย/i;

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, '') || '/';
  } catch {
    return url;
  }
}

function depthOf(url: string): number {
  const p = pathOf(url);
  if (p === '/') return 0;
  return p.split('/').filter(Boolean).length;
}

export interface MoneyPageSignal {
  url: string;
  score: number;
  reasons: string[];
}

/**
 * Score every readable crawled page on how strongly it reads as a money/service
 * page (not a blog post), returning candidates sorted best-first.
 */
export function detectMoneyPages(pages: MoneyPageInput[]): MoneyPageSignal[] {
  const out: MoneyPageSignal[] = [];
  for (const page of pages) {
    if (page.ok === false || (page.wordCount ?? 1) <= 0) continue; // never judge an unread page
    const path = pathOf(page.url);
    const reasons: string[] = [];
    let score = 0;

    if (INFO_PATH_RE.test(path)) {
      // Informational URL — disqualify from money-page role.
      continue;
    }
    if (APPLY_STRONG_RE.test(path)) { score += 5; reasons.push('apply/convert path'); }
    if (PRODUCT_PATH_RE.test(path)) { score += 3; reasons.push('product/service path'); }

    const depth = depthOf(page.url);
    if (depth === 1) { score += 2; reasons.push('top-level landing'); }
    else if (depth === 2) { score += 1; reasons.push('shallow landing'); }
    else if (depth >= 4) { score -= 1; reasons.push('deep page'); }

    // Structured data / contact cues correlate with real product pages.
    if (page.eeat?.hasStructuredData) { score += 1; reasons.push('structured data'); }
    if (page.eeat?.hasContactInfo) { score += 1; reasons.push('contact/CTA cue'); }

    if (score > 0) out.push({ url: page.url, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score || depthOf(a.url) - depthOf(b.url) || a.url.localeCompare(b.url));
}

// ─── Pillar derivation ─────────────────────────────────────────────────────────

export interface DerivePillarsOptions {
  maxPillars?: number;         // default 6
  totalArticlesPerMonth?: number; // distributed across pillars (default 12)
  minPagesPerPillar?: number;  // ignore trivial categories (default 1)
}

function firstSegment(url: string): string {
  return pathOf(url).split('/').filter(Boolean)[0] ?? '';
}

/** Distribute a monthly article total across weights, min 1 each, summing exactly. */
function distributeQuota(weights: number[], total: number): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0) || n;
  // Largest-remainder method on (total - n) after guaranteeing 1 per pillar.
  const pool = Math.max(0, total - n);
  const raw = weights.map(w => (w / sum) * pool);
  const base = raw.map(r => Math.floor(r));
  let remaining = pool - base.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < order.length && remaining > 0; k++, remaining--) base[order[k].i] += 1;
  return base.map(b => b + 1);
}

/**
 * Derive the site's pillars + money pages from a deep crawl.
 * Prefers the crawl's own `categories` (real top-level sections); for each, the
 * best-scoring money page under that section becomes the pillar's money page.
 * Falls back to grouping pages by their first path segment when categories are
 * absent. Returns [] when there is nothing crawlable — the caller then keeps
 * whatever pillars it already had.
 */
export function derivePillarsFromCrawl(
  result: DeepCrawlResult,
  options: DerivePillarsOptions = {},
): PlanPillarInput[] {
  const pages = (result.pages || []).filter(p => p.ok && p.wordCount > 0);
  if (pages.length === 0) return [];
  return derivePillars(result.baseUrl, result.categories, pages, options);
}

/**
 * Shallow-crawl variant: derive pillars from a SiteContext (sitemap categories +
 * key pages) when a full deep crawl isn't available — this is what the dashboard's
 * `/api/crawl-site` produces. Money-page detection runs on URL-path signals only
 * (no eeat), which still surfaces apply/product landings. Returns [] when there
 * are no categories, so the caller keeps whatever pillars it already had.
 */
export function derivePillarsFromSiteContext(
  ctx: {
    url: string;
    categories: CategoryInput[];
    key_pages?: { url: string }[];
  },
  options: DerivePillarsOptions = {},
): PlanPillarInput[] {
  const categories = ctx.categories || [];
  if (categories.length === 0) return [];
  // Candidate money pages: each category landing + any key pages, de-duplicated.
  const seen = new Set<string>();
  const pages: MoneyPageInput[] = [];
  for (const url of [...categories.map(c => c.url), ...(ctx.key_pages || []).map(k => k.url)]) {
    if (url && !seen.has(url)) { seen.add(url); pages.push({ url }); }
  }
  return derivePillars(ctx.url, categories, pages, options);
}

/** Shared core: group crawled pages into pillars and attach the best money page. */
function derivePillars(
  baseUrl: string,
  categoryList: CategoryInput[] | undefined,
  pages: MoneyPageInput[],
  options: DerivePillarsOptions,
): PlanPillarInput[] {
  const maxPillars = options.maxPillars ?? 6;
  const totalPerMonth = options.totalArticlesPerMonth ?? 12;
  const minPages = options.minPagesPerPillar ?? 1;

  const money = detectMoneyPages(pages);
  const moneyBySegment = new Map<string, MoneyPageSignal>();
  for (const m of money) {
    const seg = firstSegment(m.url);
    if (seg && !moneyBySegment.has(seg)) moneyBySegment.set(seg, m); // best-first, keep first
  }

  // Build (slug, label, count) groups — from crawl categories if present, else
  // by first path segment.
  type Group = { slug: string; label: string; count: number; url: string };
  let groups: Group[] = [];
  if (categoryList && categoryList.length > 0) {
    groups = categoryList.map(c => ({
      slug: c.slug,
      label: c.label || c.slug,
      count: c.count ?? pages.filter(p => firstSegment(p.url) === c.slug).length,
      url: c.url,
    }));
  } else {
    const bySeg = new Map<string, Group>();
    for (const p of pages) {
      const seg = firstSegment(p.url);
      if (!seg) continue;
      const g = bySeg.get(seg);
      if (g) g.count += 1;
      else bySeg.set(seg, { slug: seg, label: labelFromSlug(seg), count: 1, url: `${baseUrl.replace(/\/+$/, '')}/${seg}` });
    }
    groups = [...bySeg.values()];
  }

  const selected = groups
    .filter(g => g.slug && g.count >= minPages)
    .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug))
    .slice(0, maxPillars);

  if (selected.length === 0) return [];

  const quotas = distributeQuota(selected.map(g => g.count), totalPerMonth);

  return selected.map((g, i) => {
    const moneyPage = moneyBySegment.get(g.slug)?.url ?? g.url;
    return {
      name: g.label,
      seed: g.label,
      moneyPage,
      articlesPerMonth: quotas[i],
    };
  });
}

/** Turn a URL slug into a human-ish label (English title-case; Thai passthrough). */
export function labelFromSlug(slug: string): string {
  const cleaned = decodeURIComponent(slug).replace(/[-_]+/g, ' ').trim();
  if (!cleaned) return slug;
  // Leave Thai/non-latin as-is; title-case latin words.
  return cleaned.replace(/\b([a-z])(\w*)/gi, (_, a: string, b: string) => a.toUpperCase() + b.toLowerCase());
}
