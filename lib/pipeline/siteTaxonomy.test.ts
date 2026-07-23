/**
 * Tests for siteTaxonomy — money-page detection + pillar derivation from both a
 * deep crawl and a shallow SiteContext. Pure module, no network.
 * Run: npx ts-node --project tsconfig.test.json lib/pipeline/siteTaxonomy.test.ts
 */
import type { DeepCrawlResult, CrawledPage } from '../services/siteCrawlService';
import {
  detectMoneyPages,
  derivePillarsFromCrawl,
  derivePillarsFromSiteContext,
  labelFromSlug,
  type MoneyPageInput,
} from './siteTaxonomy';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

/** Build a minimal CrawledPage for the deep-crawl path. */
function page(url: string, extra: Partial<CrawledPage> = {}): CrawledPage {
  return {
    url,
    status: 200,
    ok: true,
    title: '',
    metaDescription: '',
    h1: [],
    headings: [],
    wordCount: 500,
    text: '',
    category: null,
    eeat: {
      hasAuthorByline: false,
      hasPublishDate: false,
      hasStructuredData: false,
      hasContactInfo: false,
    } as CrawledPage['eeat'],
    missingSignals: [],
    ...extra,
  };
}

function main(): void {
  console.log('siteTaxonomy');

  // ── detectMoneyPages ──────────────────────────────────────────────────────
  console.log(' detectMoneyPages');
  const signals = detectMoneyPages([
    page('https://x.com/loan/apply'),          // apply + product + depth2
    page('https://x.com/loan'),                // product + depth1
    page('https://x.com/blog/how-to-save'),    // info → excluded
    page('https://x.com/about'),               // no money signal
  ]);
  const urls = signals.map(s => s.url);
  assert(urls[0] === 'https://x.com/loan/apply', 'apply page scores highest');
  assert(!urls.includes('https://x.com/blog/how-to-save'), 'informational URL is excluded');
  assert(signals.find(s => s.url === 'https://x.com/loan/apply')!.score >
         signals.find(s => s.url === 'https://x.com/loan')!.score,
         'apply landing outscores the section landing');

  // Shallow inputs ({ url } only, no ok/wordCount) are still scored via defaults.
  const shallow: MoneyPageInput[] = [{ url: 'https://x.com/credit-card/apply' }];
  assert(detectMoneyPages(shallow).length === 1, 'scores a shallow {url} input with no ok/wordCount');

  // Universal industry coverage: money-page detection is not finance-specific.
  // Each conversion/commercial URL below must score > 0; each info/policy URL must not.
  const money = (url: string) => detectMoneyPages([{ url }]).length === 1;
  const notMoney = (url: string) => detectMoneyPages([{ url }]).length === 0;
  // Conversion actions across industries.
  assert(money('https://x.com/checkout'), 'ecommerce checkout is a money page');
  assert(money('https://x.com/cart'), 'ecommerce cart is a money page');
  assert(money('https://x.com/contact'), 'agency contact/lead is a money page');
  assert(money('https://x.com/get-a-quote'), 'quote request is a money page');
  assert(money('https://x.com/booking'), 'hotel booking is a money page');
  assert(money('https://x.com/appointment'), 'clinic appointment is a money page');
  assert(money('https://x.com/free-trial'), 'SaaS free trial is a money page');
  assert(money('https://x.com/donate'), 'non-profit donate is a money page');
  assert(money('https://x.com/บริการ/ขอใบเสนอราคา'), 'Thai quote-request path is a money page');
  // Commercial / product / service landings across industries.
  assert(money('https://x.com/shop'), 'ecommerce shop landing is a money page');
  assert(money('https://x.com/services'), 'agency services landing is a money page');
  assert(money('https://x.com/pricing'), 'SaaS pricing landing is a money page');
  assert(money('https://x.com/portfolio'), 'agency portfolio is a money page');
  assert(money('https://x.com/rooms'), 'hotel rooms landing is a money page');
  assert(money('https://x.com/menu'), 'restaurant menu is a money page');
  assert(money('https://x.com/property'), 'real-estate property landing is a money page');
  assert(money('https://x.com/courses'), 'education courses landing is a money page');
  assert(money('https://x.com/รับทำเว็บไซต์'), 'Thai web-agency service path is a money page');
  assert(money('https://x.com/tours'), 'travel tours landing is a money page');
  assert(money('https://x.com/tickets'), 'event tickets landing is a money page');
  assert(money('https://x.com/vehicles'), 'automotive vehicles landing is a money page');
  assert(money('https://x.com/download'), 'app download is a money page');
  assert(money('https://x.com/consultation'), 'consulting consultation is a money page');
  // Info / policy pages must never be treated as money pages.
  assert(notMoney('https://x.com/blog/how-to'), 'blog post is not a money page');
  assert(notMoney('https://x.com/about'), 'about page is not a money page');
  assert(notMoney('https://x.com/privacy'), 'privacy policy is not a money page');
  assert(notMoney('https://x.com/careers'), 'careers page is not a money page');
  // Finance terms still work (backward-compatible with the original client).
  assert(money('https://x.com/loan/apply') && money('https://x.com/insurance'),
         'original finance paths still score as money pages');

  // eeat is a bonus, not required.
  const withEeat = detectMoneyPages([page('https://x.com/savings', {
    eeat: { hasStructuredData: true, hasContactInfo: true } as CrawledPage['eeat'],
  })]);
  const noEeat = detectMoneyPages([{ url: 'https://x.com/savings' }]);
  assert(withEeat[0].score > noEeat[0].score, 'structured-data/contact cues add score');

  // ── derivePillarsFromCrawl (deep) ─────────────────────────────────────────
  console.log(' derivePillarsFromCrawl');
  const deep = {
    baseUrl: 'https://x.com',
    categories: [
      { slug: 'loan', label: 'Loan', url: 'https://x.com/loan', count: 6 },
      { slug: 'savings', label: 'Savings', url: 'https://x.com/savings', count: 3 },
    ],
    pages: [
      page('https://x.com/loan'),
      page('https://x.com/loan/apply'),
      page('https://x.com/savings'),
    ],
  } as unknown as DeepCrawlResult;

  const deepPillars = derivePillarsFromCrawl(deep);
  assert(deepPillars.length === 2, 'derives one pillar per category');
  const loan = deepPillars.find(p => p.name === 'Loan')!;
  assert(loan.moneyPage === 'https://x.com/loan/apply', 'loan pillar money page = best apply landing');
  assert(deepPillars.reduce((s, p) => s + (p.articlesPerMonth ?? 0), 0) === 12,
         'quotas sum to the monthly total (default 12)');
  assert(deepPillars.every(p => (p.articlesPerMonth ?? 0) >= 1), 'every pillar gets at least 1 article');

  assert(derivePillarsFromCrawl({ ...deep, pages: [] } as unknown as DeepCrawlResult).length === 0,
         'no crawlable pages → no pillars (caller keeps its own)');

  // ── derivePillarsFromSiteContext (shallow) ────────────────────────────────
  console.log(' derivePillarsFromSiteContext');
  const shallowPillars = derivePillarsFromSiteContext({
    url: 'https://x.com',
    categories: [
      { slug: 'loan', label: 'Loan', url: 'https://x.com/loan', count: 6 },
      { slug: 'savings', label: 'Savings', url: 'https://x.com/savings', count: 2 },
      { slug: 'insurance', label: 'Insurance', url: 'https://x.com/insurance', count: 2 },
    ],
    key_pages: [{ url: 'https://x.com/loan/apply' }],
  });
  assert(shallowPillars.length === 3, 'shallow: one pillar per category');
  assert(shallowPillars.find(p => p.name === 'Loan')!.moneyPage === 'https://x.com/loan/apply',
         'shallow: key-page apply URL becomes the loan money page');
  assert(shallowPillars.find(p => p.name === 'Savings')!.moneyPage === 'https://x.com/savings',
         'shallow: category landing is the money page when no better candidate');
  assert(shallowPillars.reduce((s, p) => s + (p.articlesPerMonth ?? 0), 0) === 12,
         'shallow: quotas still sum to the monthly total');

  assert(derivePillarsFromSiteContext({ url: 'https://x.com', categories: [] }).length === 0,
         'shallow: no categories → no pillars');

  // maxPillars cap is honoured, largest categories first.
  const capped = derivePillarsFromSiteContext({
    url: 'https://x.com',
    categories: Array.from({ length: 8 }, (_, i) => ({
      slug: `s${i}`, label: `S${i}`, url: `https://x.com/s${i}`, count: i + 1,
    })),
  }, { maxPillars: 3 });
  assert(capped.length === 3, 'maxPillars caps the pillar count');
  assert(capped[0].name === 'S7', 'largest category ranks first');

  // ── labelFromSlug ─────────────────────────────────────────────────────────
  console.log(' labelFromSlug');
  assert(labelFromSlug('credit-card') === 'Credit Card', 'title-cases a latin slug');
  assert(labelFromSlug('personal_loan') === 'Personal Loan', 'underscores become spaces');
  assert(labelFromSlug('สินเชื่อ') === 'สินเชื่อ', 'Thai slug passes through unchanged');

  console.log(`\n✅ siteTaxonomy: ${passed} assertions passed`);
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
