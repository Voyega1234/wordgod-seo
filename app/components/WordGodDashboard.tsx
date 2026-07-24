'use client';

import { useMemo, useRef, useState } from 'react';
import SignOutButton from '@/app/components/SignOutButton';
import type { PipelineResult } from '@/lib/pipeline/wordgodPipeline';
import type { KeywordMetricMode } from '@/lib/pipeline/keywordMetricPolicy';
import type { PlanMode, PlanPillarInput } from '@/lib/planning/contentPlan';
import { PRESETS } from '@/lib/skills/intentRatioSkill';
import type { IntentRatio, PresetKey } from '@/lib/skills/intentRatioSkill';
import { threeMonthChange, formatPercentChange } from '@/lib/pipeline/kpMetrics';

type Status = 'idle' | 'running' | 'done' | 'error';
type Tab = 'keywords' | 'content' | 'pillars' | 'calendar' | 'qa';

interface Props {
  authEnabled: boolean;
  email?: string;
}

interface SiteCategory {
  slug: string;
  label: string;
  url: string;
  count?: number;
}

const fieldClass = 'w-full rounded-xl border border-[#cfdcd4] bg-white px-3.5 py-3 text-sm text-[#173028] placeholder:text-[#91a39a] shadow-sm outline-none transition focus:border-[#0a9f47] focus:ring-4 focus:ring-[#0a9f47]/10';
const labelClass = 'mb-1.5 block text-xs font-semibold text-[#496158]';
const cardClass = 'rounded-2xl border border-[#dbe5df] bg-white shadow-[0_8px_30px_rgba(28,73,52,0.05)]';

function parseKeywords(text: string): string[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const header = lines[0].toLowerCase();
  if (header.includes('keyword') || header.includes('คีย์เวิร์ด')) lines.shift();
  return [...new Set(lines.flatMap(line => {
    const firstColumn = line.split(',')[0]?.replace(/^"|"$/g, '').trim();
    return firstColumn ? [firstColumn] : [];
  }))];
}

function parsePillars(text: string): PlanPillarInput[] {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const [name, seed, moneyPage, quota] = line.split('|').map(value => value.trim());
    return {
      name,
      seed: seed || undefined,
      moneyPage: moneyPage || undefined,
      articlesPerMonth: quota && Number.isFinite(Number(quota)) ? Number(quota) : undefined,
    };
  }).filter(pillar => pillar.name);
}

function formatNumber(value: number | undefined, decimals = 0): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toLocaleString('th-TH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function PriorityBadge({ value }: { value: string }) {
  const style = value === 'P1' || value === 'high'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : value === 'P2' || value === 'medium'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-slate-200 bg-slate-50 text-slate-600';
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${style}`}>{value}</span>;
}

function SourceBadge({ value }: { value: string }) {
  const label = value === 'keyword_planner' ? 'KP'
    : value === 'planner_variant' ? 'DERIVED'
      : value === 'dataforseo' ? 'DFS'
        : 'AI IDEA';
  const style = value === 'keyword_planner' || value === 'dataforseo'
    ? 'bg-emerald-50 text-emerald-700'
    : value === 'planner_variant'
      ? 'bg-amber-50 text-amber-700'
      : 'bg-slate-100 text-slate-600';
  return <span className={`inline-flex rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold ${style}`}>{label}</span>;
}

// KP-style in-cell trend preview (before export). Pure inline SVG — no external
// libs, CSP-safe. Hover shows the raw monthly series + 3-month change.
function Sparkline({ trend }: { trend?: number[] }) {
  const series = (trend ?? []).filter(value => typeof value === 'number' && isFinite(value));
  if (series.length < 2) return <span className="text-[#c7d3cc]">—</span>;

  const width = 68;
  const height = 20;
  const pad = 2;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (series.length - 1)) * (width - 2 * pad);
  const y = (value: number) => height - pad - ((value - min) / span) * (height - 2 * pad);
  const points = series.map((value, i) => `${x(i).toFixed(1)},${y(value).toFixed(1)}`).join(' ');

  const change = threeMonthChange(series);
  const rising = change === null ? series[series.length - 1] >= series[0] : change >= 0;
  const stroke = rising ? '#0a9f47' : '#d1584f';
  const changeLabel = change === null ? '' : ` • 3-mo ${formatPercentChange(change)}`;
  const lastX = x(series.length - 1);
  const lastY = y(series[series.length - 1]);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={`trend ${formatPercentChange(change)}`}>
      <title>{`${series.map(v => v.toLocaleString('th-TH')).join(' → ')}${changeLabel}`}</title>
      <polyline points={points} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={1.9} fill={stroke} />
    </svg>
  );
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function WordGodDashboard({ authEnabled, email }: Props) {
  const [mode, setMode] = useState<PlanMode>('full_plan');
  const [niche, setNiche] = useState('');
  const [businessContext, setBusinessContext] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [seedText, setSeedText] = useState('');
  const [targetCount, setTargetCount] = useState(150);
  const [metricMode, setMetricMode] = useState<KeywordMetricMode>('api_only');
  const [planMonths, setPlanMonths] = useState(12);
  const [articlesPerMonth, setArticlesPerMonth] = useState(12);
  const [planStartMonth, setPlanStartMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [pillarText, setPillarText] = useState('');
  const [presetKey, setPresetKey] = useState<PresetKey>('preset1');
  const [intentRatio, setIntentRatio] = useState<IntentRatio>(PRESETS[0].ratio);
  const [siteSummary, setSiteSummary] = useState('');
  const [siteCategories, setSiteCategories] = useState<SiteCategory[]>([]);
  const [crawlStatus, setCrawlStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [crawlMessage, setCrawlMessage] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('keywords');
  const [sortBy, setSortBy] = useState<'priority' | 'volume' | 'kd'>('priority');
  const [query, setQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const requestedArticles = planMonths * articlesPerMonth;
  const keywordWarning = mode === 'full_plan' && targetCount < requestedArticles;

  const filteredKeywords = useMemo(() => {
    if (!result) return [];
    const search = query.trim().toLowerCase();
    return [...result.keywords]
      .filter(keyword => !search || keyword.keyword.toLowerCase().includes(search) || keyword.title.toLowerCase().includes(search))
      .sort((a, b) => {
        if (sortBy === 'volume') return b.volume - a.volume;
        if (sortBy === 'kd') return (a.organic_difficulty ?? 999) - (b.organic_difficulty ?? 999);
        return (b.priority_score ?? b.opportunity_score) - (a.priority_score ?? a.opportunity_score);
      });
  }, [query, result, sortBy]);

  async function handleSeedFile(file: File): Promise<void> {
    const text = await file.text();
    setSeedText(parseKeywords(text).join('\n'));
  }

  async function crawlSite(): Promise<void> {
    if (!siteUrl.trim()) return;
    setCrawlStatus('loading');
    setCrawlMessage('กำลังอ่าน Sitemap และหน้าสำคัญ...');
    try {
      const response = await fetch('/api/crawl-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: siteUrl }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'ไม่สามารถอ่านเว็บไซต์ได้');
      setSiteSummary(data.summary || '');
      setSiteCategories(data.categories || []);
      if (!pillarText) {
        // Prefer money-page-aware derived pillars (real service/apply landings +
        // article quotas); fall back to a naive one-per-category mapping.
        if (Array.isArray(data.derivedPillars) && data.derivedPillars.length > 0) {
          setPillarText((data.derivedPillars as PlanPillarInput[]).map(pillar =>
            `${pillar.name} | ${pillar.seed ?? pillar.name} | ${pillar.moneyPage ?? ''} | ${pillar.articlesPerMonth ?? ''}`
          ).join('\n'));
        } else if (Array.isArray(data.categories)) {
          setPillarText(data.categories.slice(0, 6).map((category: SiteCategory) =>
            `${category.label} | ${category.label} | ${category.url} |`
          ).join('\n'));
        }
      }
      setCrawlStatus('done');
      setCrawlMessage(`พบ ${data.page_count || 0} หน้า และ ${data.categories?.length || 0} หมวด`);
    } catch (error) {
      setCrawlStatus('error');
      setCrawlMessage(error instanceof Error ? error.message : 'เกิดข้อผิดพลาด');
    }
  }

  async function runPipeline(): Promise<void> {
    const seeds = parseKeywords(seedText);
    if (!niche.trim()) {
      setStatus('error');
      setStatusMessage('กรุณาระบุธุรกิจหรือหัวข้อหลัก');
      return;
    }

    setStatus('running');
    setStatusMessage('กำลังเริ่มวิเคราะห์...');
    setLogs([]);
    setResult(null);
    setActiveTab('keywords');

    try {
      const response = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seeds: seeds.length > 0 ? seeds : [niche.trim()],
          niche: niche.trim(),
          businessContext: businessContext.trim() || niche.trim(),
          category: niche.trim(),
          targetLanguage: 'th',
          targetCount,
          metricMode,
          presetKey,
          intentRatio,
          useKeywordPlanner: true,
          ai_search_optimization: true,
          site_url: siteUrl.trim() || undefined,
          site_context_summary: siteSummary || undefined,
          site_categories: siteCategories,
          mode,
          planMonths,
          articlesPerMonth,
          planStartMonth,
          planPillars: parsePillars(pillarText),
        }),
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let complete = false;
      while (!complete) {
        const chunk = await reader.read();
        complete = chunk.done;
        buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !complete });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const event of events) {
          const payloadLine = event.split('\n').find(line => line.startsWith('data: '));
          if (!payloadLine) continue;
          const payload = JSON.parse(payloadLine.slice(6));
          if (payload.type === 'log') {
            setLogs(previous => [...previous, payload.msg]);
            setStatusMessage(payload.msg);
          } else if (payload.type === 'done') {
            setResult(payload.result);
            setStatus('done');
            setStatusMessage(`เสร็จแล้ว — ${payload.result.meta.api_backed_count} คีย์เวิร์ดมีข้อมูล API จริง จากทั้งหมด ${payload.result.keywords.length} คำ`);
          } else if (payload.type === 'error') {
            throw new Error(payload.msg);
          }
        }
      }
    } catch (error) {
      setStatus('error');
      setStatusMessage(error instanceof Error ? error.message : 'เกิดข้อผิดพลาด');
    }
  }

  async function exportCsv(): Promise<void> {
    if (!result) return;
    const response = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: result.keywords, mode: 'full' }),
    });
    if (!response.ok) return;
    downloadBlob(await response.blob(), `wordgod-keywords-${Date.now()}.csv`);
  }

  async function exportXlsx(): Promise<void> {
    if (!result?.plan) return;
    setStatusMessage('กำลังสร้างไฟล์ Excel 8 ชีต...');
    const response = await fetch('/api/export-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setStatusMessage(data.error || 'สร้างไฟล์ Excel ไม่สำเร็จ');
      return;
    }
    downloadBlob(await response.blob(), `wordgod-content-plan-${planMonths}m.xlsx`);
    setStatusMessage('ดาวน์โหลด Excel เรียบร้อยแล้ว');
  }

  async function exportHtml(): Promise<void> {
    if (!result) return;
    setStatusMessage('กำลังสร้างไฟล์ HTML...');
    const response = await fetch('/api/export-html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setStatusMessage(data.error || 'สร้างไฟล์ HTML ไม่สำเร็จ');
      return;
    }
    const suffix = result.plan ? `${planMonths}m` : 'keywords';
    downloadBlob(await response.blob(), `wordgod-content-plan-${suffix}.html`);
    setStatusMessage('ดาวน์โหลด HTML เรียบร้อยแล้ว');
  }

  const tabs: Array<{ key: Tab; label: string; count?: number }> = [
    { key: 'keywords', label: 'Keyword Master', count: result?.keywords.length },
    { key: 'content', label: 'Content Plan', count: result?.plan?.contentItems.length },
    { key: 'pillars', label: 'Pillar Map', count: result?.plan?.pillars.length },
    { key: 'calendar', label: 'Calendar', count: result?.plan?.calendar.length },
    { key: 'qa', label: 'QA Report', count: result?.plan?.qa.warnings.length },
  ];

  return (
    <main className="min-h-screen bg-[#f7faf8] text-[#173028]">
      <header className="sticky top-0 z-30 border-b border-[#dbe5df] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-5 py-3 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#0a9f47] text-lg font-black text-white">W</div>
            <div>
              <div className="font-bold tracking-tight">WordGod</div>
              <div className="text-[11px] text-[#71867d]">SEO Research & Content Planning</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {email ? <span className="hidden text-xs text-[#60756d] sm:inline">{email}</span> : null}
            {authEnabled ? (
              <span className="hidden rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 sm:inline-flex">
                Supabase Auth
              </span>
            ) : null}
            {authEnabled ? <SignOutButton /> : null}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] gap-6 px-5 py-6 lg:grid-cols-[390px_minmax(0,1fr)] lg:px-8">
        <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
          <section className={`${cardClass} p-5`}>
            <div className="mb-4">
              <h1 className="text-xl font-bold tracking-tight">สร้างแผน SEO</h1>
              <p className="mt-1 text-xs leading-5 text-[#71867d]">เลือกจำนวนคีย์เวิร์ดและระยะเวลาแผนแยกจากกัน</p>
            </div>

            <div className="grid grid-cols-2 gap-2 rounded-xl bg-[#eef4f0] p-1">
              <button onClick={() => setMode('quick_research')} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${mode === 'quick_research' ? 'bg-white text-[#087a36] shadow-sm' : 'text-[#60756d]'}`}>Quick Research</button>
              <button onClick={() => setMode('full_plan')} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${mode === 'full_plan' ? 'bg-white text-[#087a36] shadow-sm' : 'text-[#60756d]'}`}>Full Content Plan</button>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className={labelClass}>ธุรกิจ / หัวข้อหลัก *</label>
                <input className={fieldClass} value={niche} onChange={event => setNiche(event.target.value)} placeholder="เช่น สินเชื่อดิจิทัล และการออม" />
              </div>
              <div>
                <label className={labelClass}>บริบทแบรนด์</label>
                <textarea className={`${fieldClass} min-h-20 resize-y`} value={businessContext} onChange={event => setBusinessContext(event.target.value)} placeholder="ชื่อแบรนด์ กลุ่มลูกค้า และบริการหลัก" />
              </div>
              <div>
                <label className={labelClass}>เว็บไซต์</label>
                <div className="flex gap-2">
                  <input className={fieldClass} value={siteUrl} onChange={event => setSiteUrl(event.target.value)} placeholder="https://example.com" />
                  <button disabled={!siteUrl || crawlStatus === 'loading'} onClick={crawlSite} className="shrink-0 rounded-xl border border-[#bcd2c3] bg-[#eff8f2] px-3 text-xs font-bold text-[#087a36] disabled:opacity-50">Crawl</button>
                </div>
                {crawlMessage ? <p className={`mt-1.5 text-[11px] ${crawlStatus === 'error' ? 'text-red-600' : 'text-[#60756d]'}`}>{crawlMessage}</p> : null}
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <label className={labelClass}>Seed Keywords</label>
                  <button onClick={() => fileInputRef.current?.click()} className="text-[11px] font-semibold text-[#087a36]">อัปโหลด CSV/TXT</button>
                  <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={event => event.target.files?.[0] && handleSeedFile(event.target.files[0])} />
                </div>
                <textarea className={`${fieldClass} min-h-28 resize-y font-mono text-xs`} value={seedText} onChange={event => setSeedText(event.target.value)} placeholder={'หนึ่งคีย์เวิร์ดต่อบรรทัด\nสินเชื่อออนไลน์\nบัญชีออมทรัพย์'} />
              </div>

              <div>
                <label className={labelClass}>รูปแบบ Search Intent</label>
                <select className={fieldClass} value={presetKey} onChange={event => {
                  const key = event.target.value as PresetKey;
                  setPresetKey(key);
                  const preset = PRESETS.find(item => item.key === key);
                  if (preset) setIntentRatio(preset.ratio);
                }}>
                  {PRESETS.filter(preset => preset.key !== 'manual').map(preset => <option key={preset.key} value={preset.key}>{preset.name}</option>)}
                </select>
              </div>

              <div>
                <div className="flex items-end justify-between">
                  <label className={labelClass}>จำนวนคีย์เวิร์ด</label>
                  <strong className="text-lg text-[#087a36]">{targetCount.toLocaleString()}</strong>
                </div>
                <input type="range" min="20" max="3000" step="10" value={targetCount} onChange={event => setTargetCount(Number(event.target.value))} className="w-full accent-[#0a9f47]" />
                <div className="mt-1 flex justify-between text-[10px] text-[#91a39a]"><span>20</span><span>3,000</span></div>
              </div>

              <div>
                <label className={labelClass}>รูปแบบข้อมูล Volume / CPC</label>
                <select className={fieldClass} value={metricMode} onChange={event => setMetricMode(event.target.value as KeywordMetricMode)}>
                  <option value="api_only">เฉพาะข้อมูล API จริง (แนะนำ)</option>
                  <option value="api_first">ข้อมูล API จริง + Keyword แนะนำ</option>
                </select>
                <p className="mt-1.5 text-[10px] leading-4 text-[#71867d]">
                  {metricMode === 'api_only'
                    ? 'ไม่เติม Volume ประมาณ หาก API หาไม่ครบ ระบบจะแจ้งจำนวนที่พบจริง'
                    : 'เติมคำแนะนำให้ใกล้จำนวนเป้าหมาย แต่ช่อง Volume/CPC ของคำที่ไม่มีข้อมูลจริงจะเว้นว่าง'}
                </p>
              </div>

              {mode === 'full_plan' ? (
                <div className="space-y-4 rounded-2xl border border-[#cfe4d5] bg-[#f4fbf6] p-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>วางแผนกี่เดือน</label>
                      <select className={fieldClass} value={planMonths} onChange={event => setPlanMonths(Number(event.target.value))}>
                        {Array.from({ length: 12 }, (_, index) => index + 1).map(month => <option key={month} value={month}>{month} เดือน</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>บทความ / เดือน</label>
                      <input className={fieldClass} type="number" min="1" max="50" value={articlesPerMonth} onChange={event => setArticlesPerMonth(Math.min(Math.max(Number(event.target.value), 1), 50))} />
                    </div>
                  </div>
                  <div>
                    <label className={labelClass}>เริ่มเดือน</label>
                    <input className={fieldClass} type="month" value={planStartMonth} onChange={event => setPlanStartMonth(event.target.value)} />
                  </div>
                  <div className="rounded-xl border border-[#dbe5df] bg-white px-3 py-2.5 text-xs">
                    เป้าหมาย <strong className="text-[#087a36]">{requestedArticles.toLocaleString()} บทความ</strong>
                    <span className="ml-1 text-[#71867d]">ตลอด {planMonths} เดือน</span>
                  </div>
                  {keywordWarning ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">จำนวนคีย์เวิร์ดน้อยกว่าเป้าหมายบทความ ระบบจะจัด Calendar เท่าที่ทำได้โดยไม่ใช้ Primary Keyword ซ้ำ</p> : null}
                  <div>
                    <label className={labelClass}>Pillar / Money Page / Quota (ไม่บังคับ)</label>
                    <textarea className={`${fieldClass} min-h-28 resize-y font-mono text-[11px]`} value={pillarText} onChange={event => setPillarText(event.target.value)} placeholder={'ชื่อ Pillar | Seed | Money Page URL | บทความ/เดือน\nSavings | เงินออม | https://site.com/savings/ | 3'} />
                    <p className="mt-1 text-[10px] leading-4 text-[#71867d]">หากไม่กรอก ระบบจะสร้าง Pillar และกระจายบทความให้อัตโนมัติ</p>
                  </div>
                </div>
              ) : null}

              <button disabled={status === 'running'} onClick={runPipeline} className="w-full rounded-xl bg-[#0a9f47] px-4 py-3.5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(10,159,71,0.22)] transition hover:bg-[#087a36] disabled:cursor-not-allowed disabled:opacity-60">
                {status === 'running' ? 'กำลังวิเคราะห์...' : mode === 'full_plan' ? 'สร้าง Keyword + Content Plan' : 'เริ่ม Keyword Research'}
              </button>
            </div>
          </section>

          {status !== 'idle' ? (
            <section className={`${cardClass} overflow-hidden`}>
              <div className="border-b border-[#e3ebe6] px-4 py-3">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <span className={`h-2 w-2 rounded-full ${status === 'running' ? 'animate-pulse bg-amber-500' : status === 'done' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  {statusMessage}
                </div>
              </div>
              {logs.length > 0 ? <div className="max-h-44 overflow-auto px-4 py-3 font-mono text-[10px] leading-5 text-[#71867d]">{logs.slice(-30).map((log, index) => <div key={`${index}-${log}`}>{log}</div>)}</div> : null}
            </section>
          ) : null}
        </aside>

        <section className="min-w-0 space-y-5">
          {!result ? (
            <div className={`${cardClass} grid min-h-[640px] place-items-center p-10 text-center`}>
              <div className="max-w-xl">
                <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-[#eaf8ee] text-3xl">⌁</div>
                <h2 className="text-2xl font-bold tracking-tight">Keyword Research ที่ต่อยอดเป็นแผนได้จริง</h2>
                <p className="mt-3 text-sm leading-7 text-[#71867d]">ระบบจะแยก Keyword Master, Content Plan, Pillar Map, Calendar และ QA พร้อมส่งออก Excel 8 ชีต โดยจำนวนคีย์เวิร์ดยังคงเลือกได้เหมือนเดิม</p>
                <div className="mt-7 grid gap-3 text-left sm:grid-cols-3">
                  {[
                    ['1–3,000', 'เลือกจำนวนคีย์เวิร์ด'],
                    ['1–12 เดือน', 'เลือกระยะเวลาแผน'],
                    ['8 ชีต', 'ส่งออก Excel'],
                  ].map(([value, label]) => <div key={label} className="rounded-xl border border-[#dbe5df] bg-[#f8fbf9] p-4"><div className="text-lg font-bold text-[#087a36]">{value}</div><div className="mt-1 text-xs text-[#71867d]">{label}</div></div>)}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {[
                  ['Keywords', result.keywords.length, 'Keyword Master'],
                  ['API Metrics', result.meta.api_backed_count, 'KP + DataForSEO'],
                  ['Suggestions', result.meta.derived_count + result.meta.estimated_count, 'ไม่มี Volume ตรง'],
                  ['Content', result.plan?.contentItems.length ?? 0, 'รายการบทความ'],
                  ['Calendar', result.plan?.calendar.length ?? 0, `${result.plan?.config.months ?? 0} เดือน`],
                ].map(([label, value, sub]) => <div key={String(label)} className={`${cardClass} p-4`}><div className="text-xs font-semibold text-[#71867d]">{label}</div><div className="mt-1 text-2xl font-bold tracking-tight text-[#173028]">{Number(value).toLocaleString()}</div><div className="mt-1 text-[11px] text-[#91a39a]">{sub}</div></div>)}
              </div>

              <div className={`rounded-2xl border px-4 py-3 text-xs leading-5 ${result.meta.api_backed_count === result.keywords.length ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
                พบข้อมูล Volume API จริง <strong>{result.meta.api_backed_count.toLocaleString()} คำ</strong> จากเป้าหมาย <strong>{result.meta.requested_count.toLocaleString()} คำ</strong>
                {result.meta.shortfall_count > 0 ? ` • ขาด ${result.meta.shortfall_count.toLocaleString()} คำ และระบบไม่ได้สร้าง Volume ปลอมมาทดแทน` : ''}
                {' • '}CPC แสดงเป็น <strong>THB เท่านั้น</strong>; ถ้า Provider แปลงสกุลเงินไม่ได้ ระบบจะเว้น CPC ว่าง
              </div>

              <div className={`${cardClass} overflow-hidden`}>
                <div className="flex flex-col gap-3 border-b border-[#dbe5df] px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex gap-1 overflow-x-auto rounded-xl bg-[#eef4f0] p-1">
                    {tabs.map(tab => (
                      <button key={tab.key} disabled={tab.key !== 'keywords' && !result.plan} onClick={() => setActiveTab(tab.key)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition disabled:opacity-40 ${activeTab === tab.key ? 'bg-white text-[#087a36] shadow-sm' : 'text-[#60756d] hover:text-[#173028]'}`}>
                        {tab.label}{typeof tab.count === 'number' ? ` (${tab.count})` : ''}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={exportCsv} className="rounded-lg border border-[#cfdcd4] bg-white px-3 py-2 text-xs font-semibold text-[#496158] hover:bg-[#f7faf8]">CSV</button>
                    <button onClick={exportHtml} className="rounded-lg border border-[#cfdcd4] bg-white px-3 py-2 text-xs font-semibold text-[#496158] hover:bg-[#f7faf8]">HTML</button>
                    {result.plan ? <button onClick={exportXlsx} className="rounded-lg bg-[#0a9f47] px-3 py-2 text-xs font-bold text-white hover:bg-[#087a36]">Excel 8 ชีต</button> : null}
                  </div>
                </div>

                {activeTab === 'keywords' ? (
                  <div>
                    <div className="flex flex-col gap-3 border-b border-[#e3ebe6] bg-[#fbfdfc] p-4 sm:flex-row">
                      <input className={`${fieldClass} sm:max-w-sm`} value={query} onChange={event => setQuery(event.target.value)} placeholder="ค้นหา Keyword หรือ Title" />
                      <select className={`${fieldClass} sm:w-48`} value={sortBy} onChange={event => setSortBy(event.target.value as typeof sortBy)}>
                        <option value="priority">เรียงตาม Priority</option>
                        <option value="volume">เรียงตาม Volume</option>
                        <option value="kd">เรียงตาม KD ต่ำ</option>
                      </select>
                    </div>
                    <div className="max-h-[760px] overflow-auto">
                      <table className="w-full min-w-[1330px] text-xs">
                        <thead className="sticky top-0 z-10 bg-[#f0f6f2] text-[#496158]">
                          <tr>{['#', 'Keyword', 'Pillar', 'Title (H1)', 'Volume', 'Trend', 'KD', 'CPC (THB)', 'Intent', 'AEO', 'P Score', 'Priority', 'Source'].map(header => <th key={header} className="border-b border-[#dbe5df] px-3 py-3 text-left font-bold">{header}</th>)}</tr>
                        </thead>
                        <tbody>
                          {filteredKeywords.map((keyword, index) => {
                            const item = result.plan?.contentItems.find(content => content.primaryKeyword === keyword.keyword);
                            return (
                              <tr key={keyword.keyword} className="border-b border-[#edf2ef] align-top hover:bg-[#f8fbf9]">
                                <td className="px-3 py-3 text-[#91a39a]">{index + 1}</td>
                                <td className="max-w-[240px] px-3 py-3 font-semibold text-[#173028]">{keyword.keyword}</td>
                                <td className="max-w-[180px] px-3 py-3 text-[#60756d]">{item?.pillar ?? keyword.parent_topic ?? '—'}</td>
                                <td className="max-w-[360px] px-3 py-3 leading-5 text-[#496158]">{keyword.title}</td>
                                <td className="px-3 py-3 text-right font-mono">{keyword.metric_confidence === 'high' ? formatNumber(keyword.volume) : '—'}</td>
                                <td className="px-3 py-3"><Sparkline trend={keyword.monthly_trend} /></td>
                                <td className="px-3 py-3 text-right font-mono">{formatNumber(keyword.organic_difficulty)}</td>
                                <td className="px-3 py-3 text-right font-mono">{keyword.metric_confidence === 'high' && typeof keyword.cpc === 'number' && keyword.cpc > 0 ? formatNumber(keyword.cpc, 2) : '—'}</td>
                                <td className="px-3 py-3 text-[#60756d]">{keyword.intent}</td>
                                <td className="px-3 py-3 text-right font-mono">{formatNumber(keyword.aeo_opportunity_score)}</td>
                                <td className="px-3 py-3 text-right font-mono">{formatNumber(keyword.priority_score)}</td>
                                <td className="px-3 py-3"><PriorityBadge value={item?.priority ?? keyword.priority} /></td>
                                <td className="px-3 py-3"><SourceBadge value={keyword.volume_source} /></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                {activeTab === 'content' && result.plan ? (
                  <div className="max-h-[820px] overflow-auto">
                    <table className="w-full min-w-[1350px] text-xs">
                      <thead className="sticky top-0 z-10 bg-[#f0f6f2] text-[#496158]"><tr>{['Type', 'Title', 'Primary Keyword', 'Pillar', 'Funnel', 'Money Page', 'Internal Links', 'Priority', 'Status'].map(header => <th key={header} className="border-b border-[#dbe5df] px-3 py-3 text-left">{header}</th>)}</tr></thead>
                      <tbody>{result.plan.contentItems.map(item => <tr key={item.id} className="border-b border-[#edf2ef] align-top hover:bg-[#f8fbf9]">
                        <td className="px-3 py-3 font-semibold text-[#087a36]">{item.type}</td>
                        <td className="max-w-[380px] px-3 py-3 font-medium leading-5">{item.title}</td>
                        <td className="max-w-[220px] px-3 py-3 text-[#496158]">{item.primaryKeyword}</td>
                        <td className="px-3 py-3">{item.pillar}</td>
                        <td className="px-3 py-3">{item.funnel}</td>
                        <td className="max-w-[240px] break-all px-3 py-3 text-[#60756d]">{item.moneyPage || '—'}</td>
                        <td className="max-w-[300px] px-3 py-3 text-[#60756d]">{item.internalLinks.join(' • ') || '—'}</td>
                        <td className="px-3 py-3"><PriorityBadge value={item.priority} /></td>
                        <td className="px-3 py-3">{item.status}</td>
                      </tr>)}</tbody>
                    </table>
                  </div>
                ) : null}

                {activeTab === 'pillars' && result.plan ? (
                  <div className="grid gap-4 p-5 xl:grid-cols-2">
                    {result.plan.pillars.map(pillar => <article key={pillar.name} className="rounded-2xl border border-[#dbe5df] bg-[#fbfdfc] p-5">
                      <div className="flex items-start justify-between gap-4"><div><h3 className="font-bold">{pillar.name}</h3><p className="mt-1 text-xs text-[#71867d]">{pillar.pillarKeyword}</p></div><span className="rounded-full bg-[#eaf8ee] px-2.5 py-1 text-xs font-bold text-[#087a36]">{pillar.totalItems} items</span></div>
                      <div className="mt-4 grid grid-cols-4 gap-2 text-center">{[['Quota', pillar.monthlyQuota], ['P1', pillar.p1], ['P2', pillar.p2], ['P3', pillar.p3]].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-[#e3ebe6] bg-white p-2"><div className="font-bold">{value}</div><div className="text-[10px] text-[#71867d]">{label}</div></div>)}</div>
                      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-slate-100"><div className="bg-sky-400" style={{ width: `${pillar.totalItems ? pillar.tofu / pillar.totalItems * 100 : 0}%` }} /><div className="bg-amber-400" style={{ width: `${pillar.totalItems ? pillar.mofu / pillar.totalItems * 100 : 0}%` }} /><div className="bg-emerald-500" style={{ width: `${pillar.totalItems ? pillar.bofu / pillar.totalItems * 100 : 0}%` }} /></div>
                      <div className="mt-2 flex gap-4 text-[10px] text-[#71867d]"><span>TOFU {pillar.tofu}</span><span>MOFU {pillar.mofu}</span><span>BOFU {pillar.bofu}</span></div>
                      {pillar.moneyPage ? <p className="mt-3 break-all text-[11px] text-[#60756d]">Money Page: {pillar.moneyPage}</p> : null}
                    </article>)}
                  </div>
                ) : null}

                {activeTab === 'calendar' && result.plan ? (
                  <div className="space-y-6 p-5">
                    {Array.from({ length: result.plan.config.months }, (_, index) => index + 1).map(monthIndex => {
                      const entries = result.plan!.calendar.filter(entry => entry.monthIndex === monthIndex);
                      const month = entries[0]?.month || `เดือน ${monthIndex}`;
                      return <section key={monthIndex} className="overflow-hidden rounded-2xl border border-[#dbe5df]">
                        <div className="flex items-center justify-between bg-[#f0f6f2] px-4 py-3"><h3 className="font-bold">เดือน {monthIndex} — {month}</h3><span className="text-xs text-[#60756d]">{entries.length} บทความ</span></div>
                        {entries.length > 0 ? <div className="divide-y divide-[#edf2ef]">{entries.map(entry => <div key={entry.contentItemId} className="grid gap-3 px-4 py-3 text-xs md:grid-cols-[90px_150px_1fr_100px]">
                          <div className="font-mono text-[#60756d]">{entry.publishDate}</div><div className="font-semibold text-[#087a36]">{entry.pillar}</div><div><div className="font-medium leading-5">{entry.title}</div><div className="mt-1 text-[11px] text-[#71867d]">{entry.primaryKeyword} • {entry.funnel} • {entry.contentType}</div></div><div><PriorityBadge value={entry.priority} /></div>
                        </div>)}</div> : <div className="px-4 py-5 text-xs text-amber-700">ไม่มีคีย์เวิร์ดเหลือสำหรับเดือนนี้ กรุณาเพิ่มจำนวนคีย์เวิร์ด</div>}
                      </section>;
                    })}
                  </div>
                ) : null}

                {activeTab === 'qa' && result.plan ? (
                  <div className="p-5">
                    <div className={`rounded-2xl border p-5 ${result.plan.qa.passes ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                      <div className="text-sm font-bold">{result.plan.qa.passes ? 'QA ผ่านเงื่อนไขหลัก' : 'QA ต้องตรวจเพิ่มเติม'}</div>
                      <div className="mt-1 text-xs text-[#60756d]">จัด Calendar ได้ {result.plan.qa.scheduledArticles}/{result.plan.qa.requestedArticles} บทความ</div>
                    </div>
                    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {[
                        ['Keyword ซ้ำ', result.plan.qa.duplicateKeywords.length],
                        ['Title ซ้ำ', result.plan.qa.duplicateTitles.length],
                        ['ไม่มี Money Page', result.plan.qa.missingMoneyPages],
                        ['ไม่มี Internal Links', result.plan.qa.missingInternalLinks],
                        ['ไม่มี Organic KD', result.plan.qa.missingOrganicDifficulty],
                        ['ไม่มี CPC', result.plan.qa.missingCpc],
                        ['Calendar นอก Master', result.plan.qa.calendarOutsideKeywordMaster],
                      ].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-[#dbe5df] bg-[#fbfdfc] p-4"><div className="text-xl font-bold">{value}</div><div className="mt-1 text-xs text-[#71867d]">{label}</div></div>)}
                    </div>
                    <div className="mt-5 space-y-2">{result.plan.qa.warnings.length > 0 ? result.plan.qa.warnings.map(warning => <div key={warning} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">{warning}</div>) : <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">ไม่พบคำเตือนเพิ่มเติม</div>}</div>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
