/**
 * Tests for planHtml — standalone HTML export of a PipelineResult.
 * Pure module, no network. Verifies structure, HTML-escaping, direct-metric
 * gating, competitor rendering, and graceful handling of a plan-less result.
 * Run: npx ts-node --project tsconfig.test.json lib/export/planHtml.test.ts
 */
import type { PipelineResult, PipelineKeyword } from '../pipeline/wordgodPipeline';
import { buildPlanHtml, escapeHtml } from './planHtml';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

/** Minimal keyword with sensible defaults; override only what a test needs. */
function kw(over: Partial<PipelineKeyword> = {}): PipelineKeyword {
  return {
    keyword: 'seo คือ',
    volume: 1000,
    volume_source: 'keyword_planner',
    competition: 'LOW',
    competition_index: 10,
    intent: 'Informational',
    keyword_type: 'short-tail',
    content_type: 'article',
    opportunity_score: 50,
    priority: 'high',
    title: 'SEO คืออะไร',
    aeo_question: '',
    seo_score: 0,
    aeo_score: 0,
    ai_search_score: 0,
    ctr_score: 0,
    title_notes: '',
    ...over,
  } as PipelineKeyword;
}

function baseResult(over: Partial<PipelineResult> = {}): PipelineResult {
  return {
    keywords: [kw()],
    clusters: {} as PipelineResult['clusters'],
    meta: {
      metric_mode: 'api_plus',
      api_backed_count: 1,
      derived_count: 0,
      estimated_count: 0,
      warnings: [],
      generated_at: '2026-07-23T00:00:00.000Z',
    } as unknown as PipelineResult['meta'],
    ...over,
  } as PipelineResult;
}

function main(): void {
  console.log('planHtml');

  // ── escapeHtml ─────────────────────────────────────────────────────────────
  console.log(' escapeHtml');
  assert(escapeHtml('<script>') === '&lt;script&gt;', 'escapes angle brackets');
  assert(escapeHtml(`a&"b'c`) === 'a&amp;&quot;b&#39;c', 'escapes & " and apostrophe');
  assert(escapeHtml(undefined) === '' && escapeHtml(null) === '', 'null/undefined become empty string');
  assert(escapeHtml(42) === '42', 'numbers stringify');

  // ── document shell ─────────────────────────────────────────────────────────
  console.log(' document shell');
  const html = buildPlanHtml(baseResult());
  assert(html.startsWith('<!doctype html>'), 'emits a full HTML document');
  assert(html.includes('<title>WordGod SEO Content Plan</title>'), 'has a document title');
  assert(html.includes('<style>') && !html.includes('http://') && !html.includes('https://'),
         'self-contained: inline CSS, no external http(s) resources');
  assert(html.includes('Keyword Master') && html.includes('Competitor &amp; Rank'),
         'renders the Keyword Master and Competitor sections');

  // ── XSS / escaping of live data ────────────────────────────────────────────
  console.log(' data escaping');
  const evil = buildPlanHtml(baseResult({ keywords: [kw({ keyword: '<img src=x onerror=alert(1)>' })] }));
  assert(!evil.includes('<img src=x'), 'keyword markup is escaped, not injected');
  assert(evil.includes('&lt;img src=x onerror=alert(1)&gt;'), 'keyword renders as escaped text');

  // ── direct-metric gating ───────────────────────────────────────────────────
  console.log(' metric gating');
  const est = buildPlanHtml(baseResult({
    keywords: [kw({ volume: 0, volume_source: 'gemini_estimated', estimated_volume: 880 })],
  }));
  assert(est.includes('~880'), 'non-direct volume shows the estimate with ~ prefix');
  const direct = buildPlanHtml(baseResult({
    keywords: [kw({ volume: 1000, volume_source: 'keyword_planner', monthly_trend: [100, 120, 140, 130] })],
  }));
  assert(direct.includes('1,000'), 'direct volume shows the real number');

  // ── competitor & rank ──────────────────────────────────────────────────────
  console.log(' competitor & rank');
  const noRank = buildPlanHtml(baseResult());
  assert(noRank.includes('ยังไม่มีข้อมูลอันดับ'), 'plan-less/rank-less result shows the empty-rank notice');
  const ranked = buildPlanHtml(baseResult({
    keywords: [kw({
      site_rank: 3, rank_in_top5: true, rank_confidence: 'high', existing_rank: 5,
      competitors: [{ position: 1, domain: 'rival.com', url: 'https://rival.com/x', title: 'Rival Page' }],
    })],
  }));
  assert(ranked.includes('rival.com') && ranked.includes('Rival Page'), 'competitor domain and title render');
  assert(ranked.includes('>3<'), 'site_rank value renders');
  const notInSerp = buildPlanHtml(baseResult({ keywords: [kw({ site_rank: null, existing_rank: 8 })] }));
  assert(notInSerp.includes('ไม่ติดใน SERP'), 'null site_rank renders as ไม่ติดใน SERP');

  // ── content plan section ───────────────────────────────────────────────────
  console.log(' content plan');
  const planless = buildPlanHtml(baseResult());
  assert(planless.includes('ยังไม่มี Content Plan'), 'no plan → content-plan empty notice (no crash)');
  const withPlan = buildPlanHtml(baseResult({
    plan: {
      config: { months: 3, startMonth: '2026-08' },
      contentItems: [{
        id: 'P1', type: 'Pillar', title: 'หน้าเสาหลัก', primaryKeyword: 'seo',
        pillar: 'SEO', funnel: 'TOFU', intent: 'Informational', moneyPage: 'https://x.com/services',
        priority: 'P1', volume: 500, organicDifficulty: 20, opportunityScore: 70,
      }],
      pillars: [{ name: 'SEO' }],
      qa: { warnings: ['มีคีย์เวิร์ดซ้ำ 1 รายการ'] },
      summary: { generatedAt: '2026-07-23T00:00:00.000Z' },
    } as unknown as PipelineResult['plan'],
  }));
  assert(withPlan.includes('หน้าเสาหลัก'), 'content-item title renders');
  assert(withPlan.includes('มีคีย์เวิร์ดซ้ำ 1 รายการ'), 'QA warnings render');
  assert(withPlan.includes('3 เดือน'), 'plan month span shows in the summary cards');

  console.log(`\n✅ planHtml: ${passed} assertions passed`);
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
