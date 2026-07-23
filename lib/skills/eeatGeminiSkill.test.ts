import { synthesizeEeatWithGemini } from './eeatGeminiSkill';
import type { GeminiSynthesisDeps } from './eeatGeminiSkill';
import type { DeepCrawlResult, CrawledPage } from '../services/siteCrawlService';
import type { TokenUsage } from '../gemini';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function makePage(overrides: Partial<CrawledPage> = {}): CrawledPage {
  return {
    url: overrides.url ?? 'https://site.com/page',
    status: overrides.status ?? 200,
    ok: overrides.ok ?? true,
    title: overrides.title ?? 'A Page',
    metaDescription: overrides.metaDescription ?? '',
    h1: overrides.h1 ?? ['A Page'],
    headings: overrides.headings ?? ['Intro', 'Details'],
    wordCount: overrides.wordCount ?? 500,
    text: overrides.text ?? 'This is the article body with real content about the topic.',
    category: overrides.category ?? null,
    eeat: overrides.eeat ?? {
      wordCount: overrides.wordCount ?? 500,
      headingCount: 2,
      hasAuthorByline: false,
      hasPublishDate: false,
      hasStructuredData: false,
      hasContactInfo: false,
    },
    missingSignals: overrides.missingSignals ?? [],
  };
}

function makeResult(pages: CrawledPage[]): DeepCrawlResult {
  return {
    baseUrl: 'https://site.com',
    sitemapFound: false,
    sitemapUrl: null,
    pages,
    categories: [],
    coverage: { discovered: pages.length, fetched: pages.length, failed: 0, capped: false, durationMs: 10, source: 'bfs' },
    eeatSummary: { totalPages: pages.length, avgWordCount: 0, pagesThinContent: 0, pagesMissingAuthor: 0, pagesMissingDate: 0, pagesMissingStructuredData: 0 },
  };
}

/** A mock Gemini that returns a well-formed judgement for each requested page
 *  and drives a shared usage counter so cost-delta logic can be verified. */
function makeMockDeps(): { deps: GeminiSynthesisDeps; calls: string[][]; usage: TokenUsage } {
  const usage: TokenUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0, cost_thb: 0 };
  const calls: string[][] = [];
  const deps: GeminiSynthesisDeps = {
    getUsage: () => ({ ...usage }),
    call: async (prompt: string) => {
      // Recover the urls in this batch from the prompt (each appears as "url: ...").
      const urls = [...prompt.matchAll(/^url: (.+)$/gm)].map(m => m[1].trim());
      calls.push(urls);
      // Simulate token spend per call.
      usage.input_tokens += 1000;
      usage.output_tokens += 200;
      usage.total_tokens += 1200;
      usage.cost_usd += 0.0003;
      usage.cost_thb += 0.0102;
      return {
        pages: urls.map(url => ({
          url,
          experience: { score: 7, rationale: 'first-hand tone present', gaps: ['add author bio'] },
          expertise: { score: 6, rationale: 'some depth', gaps: [] },
          authority: { score: 5, rationale: 'no citations', gaps: ['cite sources'] },
          trust: { score: 8, rationale: 'clear contact', gaps: [] },
          recommendations: ['add byline', 'cite sources'],
        })),
      };
    },
  };
  return { deps, calls, usage };
}

async function run(): Promise<void> {
  console.log('\n[EEAT Gemini Synthesis]');

  // ── Happy path: single batch, all pages scored ──────────────────────────────
  {
    const pages = [makePage({ url: 'https://site.com/a' }), makePage({ url: 'https://site.com/b' })];
    const { deps, calls } = makeMockDeps();
    const out = await synthesizeEeatWithGemini(makeResult(pages), { batchSize: 5 }, deps);
    assert(out.method === 'gemini', 'result method is gemini');
    assert(out.model === 'gemini-3.5-flash', 'model recorded');
    assert(calls.length === 1, 'two pages fit in one batch (batchSize=5)');
    assert(out.batches === 1, 'batches count = 1');
    assert(out.pagesSynthesized === 2, 'both pages synthesised');
    assert(out.scores.length === 2, 'two score objects returned');
    const a = out.scores.find(s => s.url === 'https://site.com/a')!;
    assert(a.scored === true, 'page a scored');
    assert(a.experience.score === 7 && a.trust.score === 8, 'dimension scores mapped');
    assert(a.overall === 6.5, 'overall = mean(7,6,5,8) = 6.5');
    assert(a.recommendations.length === 2, 'recommendations mapped');
    assert(a.method === 'gemini', 'per-page method is gemini');
  }

  // ── Cost delta measured from usage counter ──────────────────────────────────
  {
    const pages = [makePage({ url: 'https://site.com/a' }), makePage({ url: 'https://site.com/b' }), makePage({ url: 'https://site.com/c' })];
    const { deps } = makeMockDeps();
    const out = await synthesizeEeatWithGemini(makeResult(pages), { batchSize: 2 }, deps);
    assert(out.batches === 2, 'three pages, batchSize 2 => 2 batches');
    // 2 calls * 0.0102 THB each
    assert(Math.abs(out.cost.cost_thb - 0.0204) < 1e-9, 'cost_thb is delta of usage across the run');
    assert(out.cost.total_tokens === 2400, 'token delta = 2 calls * 1200');
  }

  // ── Capping + weakness-first selection ──────────────────────────────────────
  {
    const strong = makePage({ url: 'https://site.com/strong', wordCount: 2000, missingSignals: [] });
    const weak = makePage({ url: 'https://site.com/weak', wordCount: 120, missingSignals: ['author', 'date', 'schema'] });
    const mid = makePage({ url: 'https://site.com/mid', wordCount: 800, missingSignals: ['date'] });
    const { deps, calls } = makeMockDeps();
    const out = await synthesizeEeatWithGemini(makeResult([strong, weak, mid]), { maxPages: 2, batchSize: 5 }, deps);
    assert(out.pagesEligible === 3, 'three readable pages eligible');
    assert(out.pagesRequested === 2, 'capped to maxPages=2');
    const sent = calls.flat();
    assert(sent.includes('https://site.com/weak'), 'weakest page (most missing signals) selected');
    assert(!sent.includes('https://site.com/strong'), 'strongest page dropped by cap');
    assert(out.notes.some(n => n.includes('capped')), 'cap disclosed in notes');
  }

  // ── Unread pages are never scored ───────────────────────────────────────────
  {
    const read = makePage({ url: 'https://site.com/read' });
    const failed = makePage({ url: 'https://site.com/failed', ok: false, status: 500, wordCount: 0, text: '' });
    const empty = makePage({ url: 'https://site.com/empty', ok: true, wordCount: 0, text: '' });
    const { deps, calls } = makeMockDeps();
    const out = await synthesizeEeatWithGemini(makeResult([read, failed, empty]), {}, deps);
    assert(out.pagesEligible === 1, 'only the readable page is eligible');
    assert(calls.flat().length === 1, 'only one page sent to gemini');
    assert(!calls.flat().includes('https://site.com/failed'), 'failed page not sent');
    assert(out.notes.some(n => n.includes('not read')), 'unread pages disclosed');
  }

  // ── Score clamping + malformed dimensions ───────────────────────────────────
  {
    const pages = [makePage({ url: 'https://site.com/x' })];
    const deps: GeminiSynthesisDeps = {
      getUsage: () => ({ input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0, cost_thb: 0 }),
      call: async () => ({
        pages: [{
          url: 'https://site.com/x',
          experience: { score: 99, rationale: 'x', gaps: 'not-an-array' },
          expertise: { score: -5, rationale: 'x', gaps: [] },
          authority: {},
          trust: { score: 'abc', rationale: 'x', gaps: [] },
          recommendations: 'nope',
        }],
      }),
    };
    const out = await synthesizeEeatWithGemini(makeResult(pages), {}, deps);
    const s = out.scores[0];
    assert(s.experience.score === 10, 'score 99 clamped to 10');
    assert(s.expertise.score === 0, 'score -5 clamped to 0');
    assert(s.authority.score === 0, 'missing score defaults to 0');
    assert(s.trust.score === 0, 'non-numeric score coerced to 0');
    assert(Array.isArray(s.experience.gaps) && s.experience.gaps.length === 0, 'non-array gaps coerced to []');
    assert(Array.isArray(s.recommendations) && s.recommendations.length === 0, 'non-array recommendations coerced to []');
    assert(s.scored === true, 'malformed-but-present page still counts as scored');
  }

  // ── Missing page in model output => scored:false, no throw ───────────────────
  {
    const pages = [makePage({ url: 'https://site.com/a' }), makePage({ url: 'https://site.com/b' })];
    const deps: GeminiSynthesisDeps = {
      getUsage: () => ({ input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0, cost_thb: 0 }),
      call: async () => ({ pages: [{ url: 'https://site.com/a', experience: { score: 5 }, expertise: { score: 5 }, authority: { score: 5 }, trust: { score: 5 } }] }),
    };
    const out = await synthesizeEeatWithGemini(makeResult(pages), { batchSize: 5 }, deps);
    const b = out.scores.find(s => s.url === 'https://site.com/b')!;
    assert(b !== undefined, 'missing page b still has a score object');
    assert(b.scored === false, 'unmatched page marked scored:false');
    assert(b.notes.length > 0, 'unmatched page carries a note');
    assert(out.pagesSynthesized === 1, 'only page a counts as synthesised');
  }

  // ── URL-based alignment survives model reordering ───────────────────────────
  {
    const pages = [makePage({ url: 'https://site.com/a', missingSignals: ['x'] }), makePage({ url: 'https://site.com/b' })];
    const deps: GeminiSynthesisDeps = {
      getUsage: () => ({ input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0, cost_thb: 0 }),
      call: async () => ({
        pages: [
          { url: 'https://site.com/b', experience: { score: 1 }, expertise: { score: 1 }, authority: { score: 1 }, trust: { score: 1 } },
          { url: 'https://site.com/a', experience: { score: 9 }, expertise: { score: 9 }, authority: { score: 9 }, trust: { score: 9 } },
        ],
      }),
    };
    const out = await synthesizeEeatWithGemini(makeResult(pages), { batchSize: 5 }, deps);
    const a = out.scores.find(s => s.url === 'https://site.com/a')!;
    const b = out.scores.find(s => s.url === 'https://site.com/b')!;
    assert(a.overall === 9, 'page a aligned by url despite reordering');
    assert(b.overall === 1, 'page b aligned by url despite reordering');
  }

  // ── A failing batch degrades gracefully (no throw) ──────────────────────────
  {
    const pages = [makePage({ url: 'https://site.com/a' }), makePage({ url: 'https://site.com/b' })];
    const deps: GeminiSynthesisDeps = {
      getUsage: () => ({ input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0, cost_thb: 0 }),
      call: async () => { throw new Error('RESOURCE_EXHAUSTED'); },
    };
    const out = await synthesizeEeatWithGemini(makeResult(pages), { batchSize: 5 }, deps);
    assert(out.scores.length === 2, 'failed batch still yields placeholder scores');
    assert(out.scores.every(s => s.scored === false), 'all pages in failed batch marked scored:false');
    assert(out.pagesSynthesized === 0, 'no pages synthesised on failure');
    assert(out.notes.some(n => n.includes('batch failed')), 'batch failure disclosed');
  }

  // ── Empty crawl => no calls, empty result ───────────────────────────────────
  {
    const { deps, calls } = makeMockDeps();
    const out = await synthesizeEeatWithGemini(makeResult([]), {}, deps);
    assert(calls.length === 0, 'no gemini calls for empty crawl');
    assert(out.pagesSynthesized === 0 && out.scores.length === 0, 'empty synthesis result');
    assert(out.cost.cost_thb === 0, 'zero cost when nothing sent');
  }

  console.log('\n[EEAT Gemini Synthesis] all assertions passed ✅');
}

run().catch(err => { console.error(err); process.exit(1); });
