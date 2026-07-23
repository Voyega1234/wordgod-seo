import type { CrawledPage, DeepCrawlResult } from '../services/siteCrawlService';
import {
  deriveSiteEeatSignals,
  scoreEeatForCrawl,
  scoreEeatForPage,
  type SiteEeatSignals,
} from './eeatSkill';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function mockPage(overrides: Partial<CrawledPage> = {}): CrawledPage {
  return {
    url: 'https://example.com/page',
    status: 200,
    ok: true,
    title: 'Sample Page',
    metaDescription: '',
    h1: [],
    headings: [],
    wordCount: 0,
    text: '',
    category: null,
    eeat: {
      wordCount: 0,
      headingCount: 0,
      hasAuthorByline: false,
      hasPublishDate: false,
      hasStructuredData: false,
      hasContactInfo: false,
    },
    missingSignals: [],
    ...overrides,
  };
}

const fullSiteSignals: SiteEeatSignals = {
  hasAboutPage: true,
  hasContactPage: true,
  hasPrivacyOrTerms: true,
  hasAuthorPages: true,
};

async function run(): Promise<void> {
  console.log('\n[E-E-A-T rule-based scoring]');

  // ─── Rich page ───────────────────────────────────────────────────────────
  const richPage = mockPage({
    url: 'https://example.com/rich-article',
    title: 'บทความโดยผู้เชี่ยวชาญ',
    metaDescription: 'บทความเชิงลึกจากผู้เชี่ยวชาญ',
    wordCount: 900,
    text: 'ผม ได้ทดลองใช้สินค้า นี้จริง และมี ตัวอย่าง ให้ดูจาก ผู้เชี่ยวชาญ ในวงการ',
    eeat: {
      wordCount: 900,
      headingCount: 5,
      hasAuthorByline: true,
      hasPublishDate: true,
      hasStructuredData: true,
      hasContactInfo: true,
    },
  });

  const richScore = scoreEeatForPage(richPage, fullSiteSignals);
  assert(richScore.scored === true, 'rich page ถูก scored');
  assert(richScore.experience.score >= 7, `experience >= 7 (got ${richScore.experience.score})`);
  assert(richScore.expertise.score >= 7, `expertise >= 7 (got ${richScore.expertise.score})`);
  assert(richScore.authority.score >= 7, `authority >= 7 (got ${richScore.authority.score})`);
  assert(richScore.trust.score >= 7, `trust >= 7 (got ${richScore.trust.score})`);
  assert(richScore.experience.evidence.length > 0, 'experience มี evidence');
  assert(richScore.expertise.evidence.length > 0, 'expertise มี evidence');
  assert(richScore.authority.evidence.length > 0, 'authority มี evidence');
  assert(richScore.trust.evidence.length > 0, 'trust มี evidence');

  // ─── Thin page ───────────────────────────────────────────────────────────
  const thinPage = mockPage({
    url: 'https://example.com/thin-article',
    title: 'Thin Article',
    metaDescription: '',
    wordCount: 120,
    text: 'สินค้านี้ดีมาก แนะนำให้ซื้อ',
    eeat: {
      wordCount: 120,
      headingCount: 0,
      hasAuthorByline: false,
      hasPublishDate: false,
      hasStructuredData: false,
      hasContactInfo: false,
    },
  });

  const thinScore = scoreEeatForPage(thinPage);
  assert(thinScore.scored === true, 'thin page ถูก scored (has wordCount > 0 and ok)');
  assert(thinScore.overall < 4, `thin page overall < 4 (got ${thinScore.overall})`);
  assert(thinScore.experience.gaps.includes('thin-content'), 'thin page มี gap thin-content');
  assert(thinScore.experience.gaps.includes('no-author-byline'), 'thin page มี gap no-author-byline');

  // ─── Unread page (ok false) ─────────────────────────────────────────────
  const unreadPageFailed = mockPage({
    url: 'https://example.com/unread-failed',
    ok: false,
    wordCount: 0,
  });
  const unreadScoreFailed = scoreEeatForPage(unreadPageFailed);
  assert(unreadScoreFailed.scored === false, 'unread (ok=false) page ไม่ถูก scored');
  assert(unreadScoreFailed.overall === 0, 'unread page overall = 0');
  assert(
    unreadScoreFailed.experience.gaps.length === 1 && unreadScoreFailed.experience.gaps[0] === 'not-read',
    'unread page experience gaps = [not-read]'
  );
  assert(
    unreadScoreFailed.expertise.gaps.length === 1 && unreadScoreFailed.expertise.gaps[0] === 'not-read',
    'unread page expertise gaps = [not-read]'
  );
  assert(
    unreadScoreFailed.authority.gaps.length === 1 && unreadScoreFailed.authority.gaps[0] === 'not-read',
    'unread page authority gaps = [not-read]'
  );
  assert(
    unreadScoreFailed.trust.gaps.length === 1 && unreadScoreFailed.trust.gaps[0] === 'not-read',
    'unread page trust gaps = [not-read]'
  );

  // ─── Unread page (wordCount 0, ok true) ─────────────────────────────────
  const unreadPageEmpty = mockPage({
    url: 'https://example.com/unread-empty',
    ok: true,
    wordCount: 0,
  });
  const unreadScoreEmpty = scoreEeatForPage(unreadPageEmpty);
  assert(unreadScoreEmpty.scored === false, 'unread (wordCount=0) page ไม่ถูก scored');
  assert(unreadScoreEmpty.overall === 0, 'unread (wordCount=0) page overall = 0');

  // ─── deriveSiteEeatSignals ───────────────────────────────────────────────
  const sitePages = [
    mockPage({ url: 'https://example.com/about', title: 'About Us' }),
    mockPage({ url: 'https://example.com/contact', title: 'Contact' }),
    mockPage({ url: 'https://example.com/privacy-policy', title: 'Privacy Policy' }),
    mockPage({ url: 'https://example.com/author/jane', title: 'Jane Doe' }),
    mockPage({ url: 'https://example.com/random-post', title: 'Random Post' }),
  ];
  const derived = deriveSiteEeatSignals(sitePages);
  assert(derived.hasAboutPage === true, 'deriveSiteEeatSignals: hasAboutPage true');
  assert(derived.hasContactPage === true, 'deriveSiteEeatSignals: hasContactPage true');
  assert(derived.hasPrivacyOrTerms === true, 'deriveSiteEeatSignals: hasPrivacyOrTerms true');
  assert(derived.hasAuthorPages === true, 'deriveSiteEeatSignals: hasAuthorPages true');

  // ─── scoreEeatForCrawl summary ───────────────────────────────────────────
  const crawlResult: DeepCrawlResult = {
    baseUrl: 'https://example.com',
    sitemapFound: true,
    sitemapUrl: 'https://example.com/sitemap.xml',
    pages: [richPage, thinPage, unreadPageFailed],
    categories: [],
    coverage: {
      discovered: 3,
      fetched: 3,
      failed: 0,
      capped: false,
      durationMs: 100,
      source: 'sitemap',
    },
    eeatSummary: {
      totalPages: 3,
      avgWordCount: 340,
      pagesThinContent: 1,
      pagesMissingAuthor: 1,
      pagesMissingDate: 1,
      pagesMissingStructuredData: 1,
    },
  };

  const { summary, scores } = scoreEeatForCrawl(crawlResult);
  assert(summary.pagesScored === 2, `pagesScored = 2 (got ${summary.pagesScored})`);
  assert(summary.pagesUnread === 1, `pagesUnread = 1 (got ${summary.pagesUnread})`);
  assert(scores.length === 3, 'scores length = 3');
  assert(
    summary.weakPages.some(w => w.url === thinPage.url),
    'weakPages รวม thin page'
  );
  assert(summary.avgOverall > 0, 'avgOverall คำนวณจากหน้าที่ scored เท่านั้น');

  console.log('  ✓ E-E-A-T rule-based scoring test suite passed\n');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
