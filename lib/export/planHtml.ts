/**
 * WordGod — self-contained HTML export.
 *
 * Renders a PipelineResult into ONE standalone .html file (inline CSS, no
 * external assets) so it opens in any browser, prints cleanly, and can be shared
 * as a single file. Mirrors the key workbook sheets: Overview summary, Keyword
 * Master, Content Plan, and Competitor & Rank.
 *
 * Pure + deterministic (no network, no server-only) so it is unit-testable.
 */
import type { PipelineResult } from '../pipeline/wordgodPipeline';
import { isDirectMetricSource } from '../pipeline/keywordMetricPolicy';
import { textSparkline, threeMonthChange, formatPercentChange } from '../pipeline/kpMetrics';

/** Escape the five HTML-significant characters so values can never break markup. */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function num(value: unknown): string {
  return typeof value === 'number' && isFinite(value) ? value.toLocaleString('en-US') : '–';
}

function money(value: unknown): string {
  return typeof value === 'number' && value > 0 ? value.toFixed(2) : '–';
}

// Handles both content-item priority (P1/P2/P3) and keyword priority (high/medium/low).
function priorityBadge(priority: unknown): string {
  const p = escapeHtml(priority);
  const cls = p === 'P1' || p === 'high' ? 'p1'
    : p === 'P2' || p === 'medium' ? 'p2'
    : p === 'P3' || p === 'low' ? 'p3'
    : 'muted';
  return p ? `<span class="badge ${cls}">${p}</span>` : '–';
}

function hasTrend(trend: number[] | undefined): trend is number[] {
  return Array.isArray(trend) && trend.filter(v => typeof v === 'number' && isFinite(v)).length >= 2;
}

function card(label: string, value: string): string {
  return `<div class="card"><div class="card-val">${escapeHtml(value)}</div><div class="card-lbl">${escapeHtml(label)}</div></div>`;
}

function keywordMasterTable(result: PipelineResult): string {
  const head = ['#', 'Keyword', 'Pillar', 'Volume', 'KD', 'CPC ฿', 'Comp.', 'Intent', 'Type',
    'Opp.', 'Priority', 'AI Search', 'Money?', 'Source', 'Conf.', 'Title (H1)', 'Trend']
    .map(h => `<th>${escapeHtml(h)}</th>`).join('');
  const rows = result.keywords.map((k, i) => {
    const direct = isDirectMetricSource(k.volume_source);
    const volume = direct ? num(k.volume)
      : (typeof k.estimated_volume === 'number' ? `~${num(k.estimated_volume)}` : '–');
    const trend = direct && hasTrend(k.monthly_trend)
      ? `${escapeHtml(textSparkline(k.monthly_trend))} <span class="delta">${escapeHtml(formatPercentChange(threeMonthChange(k.monthly_trend)))}</span>`
      : '–';
    const money_page = k.money_page_opportunity ? '<span class="badge money">YES</span>' : '';
    return `<tr>
      <td class="r">${i + 1}</td>
      <td class="kw">${escapeHtml(k.keyword)}</td>
      <td>${escapeHtml(k.parent_topic ?? k.keyword_group ?? '')}</td>
      <td class="r">${volume}</td>
      <td class="r">${num(k.organic_difficulty)}</td>
      <td class="r">${money(k.cpc)}</td>
      <td>${escapeHtml(k.competition ?? '')}</td>
      <td>${escapeHtml(k.intent ?? '')}</td>
      <td>${escapeHtml(k.keyword_type ?? '')}</td>
      <td class="r">${num(k.opportunity_score)}</td>
      <td class="c">${priorityBadge(k.priority)}</td>
      <td class="r">${num(k.ai_search_priority_score ?? k.ai_search_score)}</td>
      <td class="c">${money_page}</td>
      <td>${escapeHtml(k.metric_source ?? k.volume_source ?? '')}</td>
      <td>${escapeHtml(k.metric_confidence ?? '')}</td>
      <td class="title">${escapeHtml(k.title ?? '')}</td>
      <td class="spark">${trend}</td>
    </tr>`;
  }).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function contentPlanTable(result: PipelineResult): string {
  const items = result.plan?.contentItems ?? [];
  if (items.length === 0) return '<p class="empty">ยังไม่มี Content Plan</p>';
  const head = ['ID', 'Type', 'Title', 'Primary Keyword', 'Pillar', 'Funnel', 'Intent',
    'Money Page', 'Priority', 'Volume', 'KD', 'Opp.']
    .map(h => `<th>${escapeHtml(h)}</th>`).join('');
  const rows = items.map(item => `<tr>
    <td>${escapeHtml(item.id)}</td>
    <td>${escapeHtml(item.type)}</td>
    <td class="title">${escapeHtml(item.title)}</td>
    <td class="kw">${escapeHtml(item.primaryKeyword)}</td>
    <td>${escapeHtml(item.pillar)}</td>
    <td>${escapeHtml(item.funnel ?? '')}</td>
    <td>${escapeHtml(item.intent ?? '')}</td>
    <td class="url">${escapeHtml(item.moneyPage ?? '')}</td>
    <td class="c">${priorityBadge(item.priority)}</td>
    <td class="r">${num(item.volume)}</td>
    <td class="r">${num(item.organicDifficulty)}</td>
    <td class="r">${num(item.opportunityScore)}</td>
  </tr>`).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function competitorTable(result: PipelineResult): string {
  const qualifying = result.keywords.filter(k =>
    k.site_rank !== undefined || (k.competitors && k.competitors.length > 0) || k.existing_rank !== undefined);
  if (qualifying.length === 0) {
    return '<p class="empty">ยังไม่มีข้อมูลอันดับ/คู่แข่ง (ต้องมี site_url + DataForSEO creds)</p>';
  }
  const head = ['Keyword', 'อันดับเว็บเรา', 'Top 5?', 'ความมั่นใจ', 'อันดับเดิม',
    'ตำแหน่งคู่แข่ง', 'โดเมนคู่แข่ง', 'ชื่อหน้าคู่แข่ง']
    .map(h => `<th>${escapeHtml(h)}</th>`).join('');
  const rows = qualifying.map(k => {
    const yourRank = k.site_rank === null || k.site_rank === undefined ? 'ไม่ติดใน SERP' : String(k.site_rank);
    const top5 = k.rank_in_top5 === true ? '✓' : '';
    const conf = k.rank_confidence ?? '';
    const existing = k.existing_rank ?? '';
    const rankCls = k.site_rank === null || k.site_rank === undefined ? 'muted' : 'ok';
    const comps = k.competitors ?? [];
    if (comps.length === 0) {
      return `<tr>
        <td class="kw">${escapeHtml(k.keyword)}</td>
        <td class="c ${rankCls}">${escapeHtml(yourRank)}</td>
        <td class="c">${top5}</td><td class="c">${escapeHtml(conf)}</td><td class="c">${escapeHtml(existing)}</td>
        <td colspan="3" class="muted">–</td></tr>`;
    }
    return comps.map((c, ci) => `<tr>
      ${ci === 0 ? `<td class="kw" rowspan="${comps.length}">${escapeHtml(k.keyword)}</td>
        <td class="c ${rankCls}" rowspan="${comps.length}">${escapeHtml(yourRank)}</td>
        <td class="c" rowspan="${comps.length}">${top5}</td>
        <td class="c" rowspan="${comps.length}">${escapeHtml(conf)}</td>
        <td class="c" rowspan="${comps.length}">${escapeHtml(existing)}</td>` : ''}
      <td class="r">${escapeHtml(c.position)}</td>
      <td>${escapeHtml(c.domain)}</td>
      <td class="title">${escapeHtml(c.title)}</td>
    </tr>`).join('');
  }).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function warningsBlock(result: PipelineResult): string {
  const warnings = [...(result.plan?.qa.warnings ?? []), ...(result.meta.warnings ?? [])];
  if (warnings.length === 0) return '';
  const items = warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('');
  return `<section><h2>⚠️ QA / คำเตือน</h2><ul class="warn">${items}</ul></section>`;
}

/** Build a complete, standalone HTML document string for the given result. */
export function buildPlanHtml(result: PipelineResult): string {
  const meta = result.meta;
  const plan = result.plan;
  const generatedAt = plan?.summary.generatedAt ?? meta.generated_at ?? '';
  const months = plan?.config.months;
  const startMonth = plan?.config.startMonth ?? '';
  const title = 'WordGod SEO Content Plan';

  const cards = [
    card('คีย์เวิร์ดทั้งหมด', num(result.keywords.length)),
    card('Volume API จริง', num(meta.api_backed_count)),
    card('Keyword แนะนำ', num((meta.derived_count ?? 0) + (meta.estimated_count ?? 0))),
    card('Content Items', num(plan?.contentItems.length ?? 0)),
    card('Pillars', num(plan?.pillars.length ?? 0)),
    months ? card('ระยะแผน', `${months} เดือน`) : '',
  ].join('');

  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  /* Corporate blue — matches the workbook palette in planWorkbook.ts.
     P2 uses a neutral slate so it stays readable next to the blue P3 tint. */
  :root { --brand:#1D4ED8; --dark:#1E3A8A; --text:#1E293B; --muted:#64748B; --border:#DDE3EA;
          --lbrand:#EFF6FF; --lslate:#F1F5F9; --lred:#FDECEC; }
  * { box-sizing: border-box; }
  body { margin:0; background:#F7F9FC; color:var(--text);
         font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans Thai","Sarabun",Tahoma,sans-serif;
         font-size:13px; line-height:1.5; }
  header { background:var(--dark); color:#fff; padding:20px 28px; }
  header h1 { margin:0; font-size:22px; }
  header .sub { opacity:.85; font-size:13px; margin-top:4px; }
  main { max-width:1600px; margin:0 auto; padding:20px 28px 60px; }
  .cards { display:flex; flex-wrap:wrap; gap:12px; margin:18px 0 26px; }
  .card { background:#fff; border:1px solid var(--border); border-radius:12px; padding:14px 18px; min-width:130px; }
  .card-val { font-size:22px; font-weight:800; color:var(--dark); }
  .card-lbl { font-size:11px; color:var(--muted); margin-top:2px; }
  section { margin:26px 0; }
  h2 { font-size:16px; border-left:4px solid var(--brand); padding-left:10px; margin:0 0 12px; }
  .table-wrap { overflow-x:auto; border:1px solid var(--border); border-radius:12px; background:#fff; }
  table { border-collapse:collapse; width:100%; font-size:12px; }
  thead th { background:var(--dark); color:#fff; text-align:left; padding:8px 10px; white-space:nowrap;
             position:sticky; top:0; }
  tbody td { padding:7px 10px; border-top:1px solid var(--border); vertical-align:top; }
  tbody tr:nth-child(even) { background:#F8FAFD; }
  td.r { text-align:right; font-variant-numeric:tabular-nums; }
  td.c { text-align:center; }
  td.kw { font-weight:600; white-space:nowrap; }
  td.title { min-width:260px; }
  td.url { color:var(--dark); max-width:280px; word-break:break-all; }
  td.spark { font-family:ui-monospace,Menlo,monospace; white-space:nowrap; }
  td.muted, .muted { color:var(--muted); }
  td.ok { color:var(--dark); font-weight:700; }
  .delta { color:var(--muted); font-size:11px; }
  .badge { display:inline-block; padding:1px 8px; border-radius:999px; font-size:11px; font-weight:700; }
  .badge.p1 { background:var(--lred); color:#b3261e; }
  .badge.p2 { background:var(--lslate); color:#475569; }
  .badge.p3 { background:var(--lbrand); color:var(--dark); }
  .badge.money { background:var(--brand); color:#fff; }
  .empty { color:var(--muted); background:#fff; border:1px dashed var(--border); border-radius:12px; padding:16px; }
  ul.warn { background:#fff; border:1px solid var(--border); border-radius:12px; padding:14px 14px 14px 30px; }
  ul.warn li { margin:3px 0; }
  footer { color:var(--muted); font-size:11px; text-align:center; padding:24px; }
  @media print {
    body { background:#fff; font-size:11px; }
    header { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    thead th { position:static; }
    .table-wrap { overflow:visible; border:none; }
    section { break-inside:avoid; }
  }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <div class="sub">สร้างเมื่อ ${escapeHtml(generatedAt)}${startMonth ? ` • เริ่ม ${escapeHtml(startMonth)}` : ''} • Metric: ${escapeHtml(meta.metric_mode === 'api_only' ? 'API เท่านั้น' : 'API + คำแนะนำ')}</div>
</header>
<main>
  <div class="cards">${cards}</div>

  <section><h2>Keyword Master</h2><div class="table-wrap">${keywordMasterTable(result)}</div></section>
  <section><h2>Content Plan</h2><div class="table-wrap">${contentPlanTable(result)}</div></section>
  <section><h2>Competitor &amp; Rank</h2><div class="table-wrap">${competitorTable(result)}</div></section>
  ${warningsBlock(result)}
</main>
<footer>WordGod • ${escapeHtml(generatedAt)}</footer>
</body>
</html>`;
}
