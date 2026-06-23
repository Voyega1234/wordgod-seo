'use client';

import { useState, useRef, useCallback } from 'react';
import type { PipelineKeyword, PipelineResult } from '@/lib/pipeline/wordgodPipeline';
import type { ClusterResult, TopicCluster } from '@/lib/skills/topicClusterSkill';
import { PRESETS, INTENT_LABELS, INTENT_DESCRIPTIONS, rebalanceRatio, totalRatio } from '@/lib/skills/intentRatioSkill';
import type { IntentRatio, PresetKey } from '@/lib/skills/intentRatioSkill';

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function parseKeywordsFromText(text: string): string[] {
  const bom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = bom.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const firstLineLower = lines[0].toLowerCase();
  if (firstLineLower.includes('keyword') || firstLineLower.includes(',')) {
    const header = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim().toLowerCase());
    const keyIdx = header.findIndex(h => h === 'keyword' || h === 'คีย์เวิร์ด');
    if (keyIdx >= 0) {
      return lines.slice(1).map(line => {
        const cols = line.split(',');
        return cols[keyIdx]?.trim().replace(/^"|"$/g, '') || '';
      }).filter(Boolean);
    }
    return lines.slice(1).map(l => l.split(',')[0].replace(/^"|"$/g, '').trim()).filter(Boolean);
  }
  return lines;
}

// ─── Badge components ─────────────────────────────────────────────────────────

function ScoreBadge({ score, max = 10 }: { score: number; max?: number }) {
  if (!score) return <span className="text-zinc-700">—</span>;
  const pct = score / max;
  const color = pct >= 0.8 ? 'text-emerald-400' : pct >= 0.6 ? 'text-yellow-400' : 'text-red-400';
  return <span className={`font-bold tabular-nums ${color}`}>{score}</span>;
}

function PriorityBadge({ p }: { p: string }) {
  const map: Record<string, string> = {
    high: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
    medium: 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30',
    low: 'bg-zinc-800 text-zinc-500 border border-zinc-700',
  };
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${map[p] || map.low}`}>{p}</span>;
}

function CompBadge({ comp }: { comp: string }) {
  if (!comp || comp === 'UNSPECIFIED') return <span className="text-zinc-700">—</span>;
  const map: Record<string, string> = { LOW: 'text-emerald-400', MEDIUM: 'text-yellow-400', HIGH: 'text-red-400' };
  return <span className={`font-semibold ${map[comp] || 'text-zinc-500'}`}>{comp}</span>;
}

function AIRiskBadge({ risk }: { risk?: string }) {
  if (!risk) return <span className="text-zinc-800">—</span>;
  const map: Record<string, string> = {
    high: 'bg-red-500/15 text-red-400 border border-red-500/30',
    medium: 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30',
    low: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  };
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${map[risk] ?? ''}`}>{risk}</span>;
}

function JourneyBadge({ stage }: { stage?: string }) {
  if (!stage) return <span className="text-zinc-800">—</span>;
  const abbr: Record<string, string> = {
    pre_purchase: 'Pre', during_use: 'Use', result_interpretation: 'Res',
    caregiver: 'Care', post_purchase: 'Post', general_education: 'Edu',
  };
  return <span className="text-[10px] text-zinc-500 uppercase tracking-wide">{abbr[stage] ?? stage}</span>;
}

function AEOBadge({ level }: { level?: string }) {
  if (!level) return <span className="text-zinc-800">—</span>;
  const map: Record<string, string> = {
    high: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
    medium: 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30',
    low: 'bg-zinc-800 text-zinc-600 border border-zinc-700',
  };
  return <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${map[level] ?? ''}`}>{level}</span>;
}

function AISearchScoreBadge({ score, level }: { score?: number; level?: string }) {
  if (!score) return <span className="text-zinc-800">—</span>;
  const color = level === 'high' ? 'text-emerald-400' : level === 'medium' ? 'text-yellow-400' : level === 'low' ? 'text-orange-400' : 'text-zinc-500';
  return <span className={`font-bold tabular-nums ${color}`} title={`AI Search Priority: ${level}`}>{score}</span>;
}

function VolBadge({ src }: { src: string }) {
  if (src === 'keyword_planner')
    return <span className="text-[9px] font-mono px-1 py-px rounded bg-blue-500/20 text-blue-400">KP</span>;
  if (src === 'planner_variant')
    return <span className="text-[9px] font-mono px-1 py-px rounded bg-cyan-500/20 text-cyan-500" title="Close variant volume ×0.3">~KP</span>;
  if (src === 'dataforseo')
    return <span className="text-[9px] font-mono px-1 py-px rounded bg-violet-500/20 text-violet-400" title="DataForSEO real volume">DFS</span>;
  return <span className="text-[9px] font-mono px-1 py-px rounded bg-zinc-800 text-zinc-600">est</span>;
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

type Status = 'idle' | 'running' | 'done' | 'error';
type Tab = 'keywords' | 'clusters' | 'sitemap' | 'timeline';

interface TimelineEntry {
  date: string;
  thaiDate: string;
  dayOfWeek: string;
  isHoliday: boolean;
  holidayName?: string;
  keyword: string;
  title: string;
  priority: string;
  volume: number;
  volume_source?: string;
  intent: string;
  opportunity_score?: number;
  isCore: boolean;
  phase: 1 | 2;
  weekLabel: string;
  weekIso: number;
}

interface TimelineWeek {
  label: string;
  weekIso: number;
  mondayDate: string;
  core: number;
  support: number;
  holidays: string[];
  weekendDays: number;
}

interface TimelineResult {
  days: number;
  startDate: string;
  endDate: string;
  publishDays: number;
  skippedDays: number;
  phase1Days: number;
  phase2Days: number;
  coreCount: number;
  supportCount: number;
  supportSpread: number;
  entries: TimelineEntry[];
  weeks: TimelineWeek[];
}

export default function Home() {
  const [niche, setNiche] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [crawlStatus, setCrawlStatus] = useState<'idle' | 'crawling' | 'done' | 'error'>('idle');
  const [crawlMsg, setCrawlMsg] = useState('');
  const [siteContextSummary, setSiteContextSummary] = useState<string | null>(null);
  const [siteCategories, setSiteCategories] = useState<any[]>([]);
  const [topicCount, setTopicCount] = useState(50);
  const [activePreset, setActivePreset] = useState<PresetKey>('preset1');
  const [intentRatio, setIntentRatio] = useState<IntentRatio>(PRESETS[0].ratio);
  const [guideFile, setGuideFile] = useState<File | null>(null);
  const [guideKeywords, setGuideKeywords] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('keywords');
  const [sortBy, setSortBy] = useState<'opportunity_score' | 'volume' | 'priority_score' | 'ai_search_priority_score'>('priority_score');
  const [filterPriority, setFilterPriority] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [domain, setDomain] = useState('https://example.com');
  const [timelineDays, setTimelineDays] = useState(30);
  const [timelineStartDate, setTimelineStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [timeline, setTimeline] = useState<TimelineResult | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const intentTotal = totalRatio(intentRatio);

  const selectPreset = (key: PresetKey) => {
    setActivePreset(key);
    const preset = PRESETS.find(p => p.key === key);
    if (preset && key !== 'manual') setIntentRatio(preset.ratio);
  };

  const setIntent = (key: keyof IntentRatio, val: number) => {
    setActivePreset('manual');
    setIntentRatio(prev => rebalanceRatio(prev, key, val));
  };

  const generateTimeline = async () => {
    if (!result) return;
    setTimelineLoading(true);
    setTimelineError(null);
    try {
      const res = await fetch('/api/timeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: result.keywords, days: timelineDays, startDate: timelineStartDate }),
      });
      if (!res.ok) throw new Error(`Timeline API error (${res.status})`);
      const data = await res.json();
      setTimeline(data);
      setActiveTab('timeline');
    } catch (e) {
      setTimelineError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด กรุณาลองใหม่');
      console.error(e);
    } finally {
      setTimelineLoading(false);
    }
  };

  const crawlSite = async (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setCrawlStatus('crawling');
    setCrawlMsg('Crawling sitemap…');
    setSiteContextSummary(null);
    setSiteCategories([]);
    try {
      const res = await fetch('/api/crawl-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSiteContextSummary(data.summary ?? null);
      setSiteCategories(data.categories ?? []);
      if (data.business_name && !niche.trim()) setNiche(data.business_name);
      const catCount = data.categories?.length ?? 0;
      const pageCount = data.page_count ?? 0;
      setCrawlStatus('done');
      setCrawlMsg(
        data.sitemap_found
          ? `Found ${catCount} categories · ${pageCount} pages`
          : data.crawl_error ?? 'Scraped home page (no sitemap)'
      );
    } catch (err: any) {
      setCrawlStatus('error');
      setCrawlMsg(`Crawl failed: ${err.message}`);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const addLog = (msg: string) => {
    setStatusMsg(msg);
    setLogs(prev => {
      const next = [...prev.slice(-400), msg];
      setTimeout(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, 10);
      return next;
    });
  };

  const handleFile = (file: File) => {
    setGuideFile(file);
    const reader = new FileReader();
    reader.onload = ev => {
      const kws = parseKeywordsFromText(ev.target?.result as string);
      setGuideKeywords(kws);
    };
    reader.readAsText(file, 'utf-8');
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, []);

  const canRun = niche.trim().length > 0;
  // If no guideline file, use niche words as seeds — pipeline + Gemini will expand from there
  const effectiveSeeds = guideKeywords.length > 0 ? guideKeywords : [niche.trim()];

  const runGenerate = async () => {
    if (!canRun) return;
    setStatus('running'); setResult(null); setLogs([]); setStatusMsg('Starting...');
    abortRef.current = new AbortController();

    try {
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seeds: effectiveSeeds,
          niche: niche.trim(),
          businessContext: niche.trim(),
          category: niche.trim(),
          targetCount: topicCount,
          intentRatio,
          presetKey: activePreset,
          useKeywordPlanner: true,
          ai_search_optimization: true,
          site_url: siteUrl.trim() || undefined,
          site_context_summary: siteContextSummary || undefined,
          site_categories: siteCategories.length > 0 ? siteCategories : undefined,
        }),
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() || '';
        for (const part of parts) {
          const line = part.replace(/^data: /, '').trim();
          if (!line) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.type === 'log') addLog(ev.msg);
            else if (ev.type === 'done') {
              setResult(ev.result);
              setStatus('done');
              setActiveTab('keywords');
              setStatusMsg(`Complete — ${ev.result.keywords.length} keywords ready`);
            } else if (ev.type === 'error') {
              setStatus('error'); setStatusMsg(`Error: ${ev.msg}`);
            }
          } catch {}
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setStatus('error');
        setStatusMsg(`Error: ${err.message}`);
      } else {
        // AbortError — ถ้ามี partial result แสดงผลได้เลย
        setStatus(prev => prev === 'done' ? 'done' : 'idle');
        setStatusMsg('Stopped.');
      }
    }
  };

  const downloadKeywordCSV = async (mode: 'simple' | 'full') => {
    if (!result) return;
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: result.keywords, mode }),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wordgod-${mode}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadSitemap = async (mode: 'csv' | 'xml') => {
    if (!result?.clusters) return;
    const res = await fetch('/api/sitemap-export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clusters: result.clusters.clusters,
        ungrouped: result.clusters.ungrouped,
        mode,
        domain,
      }),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = mode === 'xml' ? 'sitemap.xml' : `wordgod-sitemap-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const displayRows = result
    ? [...result.keywords]
        .filter(k => filterPriority === 'all' || k.priority === filterPriority)
        .sort((a, b) => (b[sortBy] as number) - (a[sortBy] as number))
    : [];

  const countLabel = topicCount.toLocaleString();

  return (
    <div className="min-h-screen bg-black text-zinc-100 flex flex-col">
      <main className="flex-1 flex flex-col items-center justify-start px-5 pt-16 pb-16">

        {/* Logo */}
        <div className="flex flex-col items-center gap-3 mb-12">
          <div className="w-12 h-12 rounded-full bg-black border-2 border-white flex items-center justify-center">
            <div className="w-5 h-5 rounded-full bg-white" />
          </div>
          <span className="text-xs font-bold tracking-[0.3em] uppercase text-zinc-400">WordGod</span>
        </div>

        <div className="w-full max-w-6xl space-y-8">

          {/* ─── Idle / Setup ─────────────────────────────────────── */}
          {status !== 'done' && (
            <>
              <div className="max-w-xl mx-auto space-y-8">
                {/* Queries count */}
                <div className="space-y-3">
                  <div className="flex items-baseline justify-between">
                    <label className="text-sm text-zinc-400">Queries</label>
                    <span className="text-3xl font-bold tracking-tight text-white">{countLabel}</span>
                  </div>
                  <input
                    type="range" min={5} max={300} step={5} value={topicCount}
                    onChange={e => setTopicCount(Number(e.target.value))}
                    className="w-full h-1 accent-white cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-zinc-700 font-mono">
                    <span>5</span><span>50</span><span>100</span><span>200</span><span>300</span>
                  </div>
                </div>

                {/* Niche input */}
                <div>
                  <input
                    value={niche} onChange={e => setNiche(e.target.value)}
                    placeholder="Niche — e.g. Beauty & Personal Care, Visa Agency, Home Appliance"
                    className="w-full bg-transparent border-b border-zinc-800 py-3 text-sm text-zinc-100 placeholder-zinc-700 focus:outline-none focus:border-zinc-500 transition-colors"
                  />
                </div>

                {/* Website URL (optional) */}
                <div>
                  <input
                    value={siteUrl}
                    onChange={e => { setSiteUrl(e.target.value); setCrawlStatus('idle'); setCrawlMsg(''); }}
                    onBlur={e => crawlSite(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') crawlSite(siteUrl); }}
                    placeholder="Website URL (optional) — paste to auto-crawl sitemap"
                    className="w-full bg-transparent border-b border-zinc-800 py-3 text-sm text-zinc-100 placeholder-zinc-700 focus:outline-none focus:border-zinc-500 transition-colors"
                  />
                  {crawlStatus === 'crawling' && (
                    <p className="text-[10px] text-zinc-500 font-mono mt-1 animate-pulse">{crawlMsg}</p>
                  )}
                  {crawlStatus === 'done' && (
                    <p className="text-[10px] text-emerald-500 font-mono mt-1">{crawlMsg}</p>
                  )}
                  {crawlStatus === 'error' && (
                    <p className="text-[10px] text-red-400 font-mono mt-1">{crawlMsg}</p>
                  )}
                </div>

                {/* Guideline file drop zone — optional */}
                <div
                  className={`border border-dashed rounded-2xl p-6 flex flex-col items-center gap-2 cursor-pointer transition-colors ${
                    isDragging ? 'border-white bg-white/5' :
                    guideFile ? 'border-zinc-600 bg-zinc-950' :
                    'border-zinc-800 hover:border-zinc-700'
                  }`}
                  onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef} type="file" accept=".csv,.txt"
                    className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                  />
                  <div className="text-2xl opacity-20">⬆</div>
                  {guideFile ? (
                    <>
                      <p className="text-sm text-zinc-300">{guideFile.name}</p>
                      <p className="text-[11px] text-zinc-500">{guideKeywords.length} seed keywords · will guide expansion</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-zinc-600">Drop seed keyword file <span className="text-zinc-700">(optional)</span></p>
                      <p className="text-[11px] text-zinc-700">CSV or TXT · without file, WordGod expands from niche name</p>
                    </>
                  )}
                </div>

                {/* Intent ratio */}
                <div className="space-y-3 border border-zinc-800 rounded-2xl p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400 font-semibold">Intent Mix</span>
                    <span className={`text-[10px] font-mono ${intentTotal === 100 ? 'text-zinc-600' : 'text-yellow-500 font-bold'}`}>
                      {intentTotal}/100
                    </span>
                  </div>

                  {/* Preset selector */}
                  <div className="flex flex-wrap gap-1.5">
                    {PRESETS.map(p => (
                      <button
                        key={p.key}
                        onClick={() => selectPreset(p.key)}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-colors ${
                          activePreset === p.key
                            ? 'bg-white text-black'
                            : 'bg-zinc-900 text-zinc-500 hover:text-zinc-300 border border-zinc-800'
                        }`}
                      >
                        {p.key === 'preset1' ? 'Balanced' :
                         p.key === 'preset2' ? 'New Website' :
                         p.key === 'preset3' ? 'Lead Gen' :
                         p.key === 'preset4' ? 'Affiliate' :
                         p.key === 'preset6' ? 'Knowledge' : 'Manual'}
                      </button>
                    ))}
                  </div>

                  {/* Active preset description */}
                  {activePreset !== 'manual' && (
                    <p className="text-[10px] text-zinc-600 leading-relaxed">
                      {PRESETS.find(p => p.key === activePreset)?.description}
                    </p>
                  )}

                  {/* Knowledge mode warning */}
                  {activePreset === 'preset6' && (intentRatio.transactional > 0 || intentRatio.commercial > 0) && (
                    <p className="text-[10px] text-yellow-600">
                      Knowledge mode: Commercial/Transactional &gt; 0% — switched to Manual ratio
                    </p>
                  )}

                  {/* Sliders */}
                  <div className="space-y-2 pt-1">
                    {(Object.keys(INTENT_LABELS) as (keyof IntentRatio)[]).map(key => (
                      <div key={key} className="flex items-center gap-3">
                        <span className="text-[11px] text-zinc-500 w-52 shrink-0">{INTENT_LABELS[key]}</span>
                        <input
                          type="range" min={0} max={100} step={1}
                          value={intentRatio[key]}
                          onChange={e => setIntent(key, Number(e.target.value))}
                          className="flex-1 h-1 accent-white cursor-pointer"
                        />
                        <span className="text-xs font-mono text-zinc-300 w-8 text-right">{intentRatio[key]}%</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Generate button */}
                {status === 'idle' && (
                  <button
                    onClick={runGenerate} disabled={!canRun || intentTotal !== 100}
                    className={`w-full rounded-2xl py-4 text-sm font-bold tracking-wide transition-all ${
                      canRun && intentTotal === 100 ? 'bg-white text-black hover:bg-zinc-100' : 'bg-zinc-900 text-zinc-700 cursor-not-allowed'
                    }`}
                  >
                    {!niche.trim() ? 'Enter a niche to start' : 'Generate'}
                  </button>
                )}

                {/* Stop button */}
                {status === 'running' && (
                  <button
                    onClick={() => abortRef.current?.abort()}
                    className="w-full rounded-2xl py-4 text-sm font-bold tracking-wide bg-zinc-900 border border-zinc-700 text-zinc-400 hover:text-white transition-colors"
                  >
                    Stop
                  </button>
                )}

                {/* Progress log */}
                {status === 'running' && statusMsg && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-2 h-2 bg-white rounded-full animate-pulse" />
                      <p className="text-xs text-zinc-400 font-mono leading-relaxed">{statusMsg}</p>
                    </div>
                    <div
                      ref={logRef}
                      className="max-h-48 overflow-y-auto font-mono text-[10px] text-zinc-600 space-y-px leading-4 pl-4"
                    >
                      {logs.map((l, i) => <div key={i}>{l}</div>)}
                    </div>
                  </div>
                )}

                {status === 'error' && (
                  <p className="text-xs text-red-400 font-mono">{statusMsg}</p>
                )}
              </div>
            </>
          )}

          {/* ─── Results ──────────────────────────────────────────── */}
          {status === 'done' && result && (
            <div className="space-y-6">

              {/* Summary bar */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <div>
                    <span className="text-2xl font-bold">{result.keywords.length}</span>
                    <span className="text-zinc-500 text-sm ml-2">keywords</span>
                  </div>
                  <div className="flex gap-4 text-xs text-zinc-500">
                    <span><span className="text-blue-400 font-bold">{result.meta.planner_count}</span> KP</span>
                    {result.meta.dataforseo_count > 0 && (
                      <span><span className="text-violet-400 font-bold">{result.meta.dataforseo_count}</span> DFS</span>
                    )}
                    <span><span className="text-zinc-400 font-bold">{result.meta.gemini_count}</span> Est.</span>
                    <span><span className="text-emerald-400 font-bold">{result.meta.title_ai_count}</span> AI Titles</span>
                    {result.meta.cluster_count > 0 && (
                      <span><span className="text-purple-400 font-bold">{result.meta.cluster_count}</span> Clusters</span>
                    )}
                  </div>
                  {/* Cost breakdown */}
                  {result.meta.cost?.total_cost_usd > 0 && (() => {
                    const c = result.meta.cost;
                    return (
                      <div className="flex items-center gap-3 text-[11px] text-zinc-600 border-t border-zinc-800/60 pt-2 mt-1">
                        <span className="text-zinc-700 font-medium">ค่าใช้จ่าย</span>
                        <span title={`Input: ${c.input_tokens.toLocaleString()} tokens | Output: ${c.output_tokens.toLocaleString()} tokens`}>
                          Gemini <span className="text-orange-400 font-semibold">฿{c.gemini_cost_thb.toFixed(2)}</span>
                          <span className="text-zinc-700 ml-1">(${c.gemini_cost_usd.toFixed(4)})</span>
                        </span>
                        {c.dfs_keywords_called > 0 && (
                          <span title={`${c.dfs_keywords_called} keywords × $0.0003`}>
                            DFS <span className="text-violet-400 font-semibold">฿{c.dfs_cost_thb.toFixed(2)}</span>
                            <span className="text-zinc-700 ml-1">(${c.dfs_cost_usd.toFixed(4)})</span>
                          </span>
                        )}
                        {c.kp_keywords_fetched > 0 && (
                          <span title={`${c.kp_keywords_fetched} keywords — Google Keyword Planner ฟรี`}>
                            KP <span className="text-blue-400 font-semibold">฿0.00</span>
                          </span>
                        )}
                        <span className="border-l border-zinc-800 pl-3">
                          รวม <span className="text-yellow-400 font-bold text-xs">฿{c.total_cost_thb.toFixed(2)}</span>
                          <span className="text-zinc-700 ml-1">(${c.total_cost_usd.toFixed(4)})</span>
                        </span>
                      </div>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-zinc-600">เริ่ม</span>
                    <input
                      type="date" value={timelineStartDate}
                      onChange={e => setTimelineStartDate(e.target.value)}
                      className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-zinc-500"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number" min={7} max={365} value={timelineDays}
                      onChange={e => setTimelineDays(Number(e.target.value))}
                      className="w-16 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 text-center focus:outline-none focus:border-zinc-500"
                    />
                    <span className="text-xs text-zinc-600">วัน</span>
                  </div>
                  <button
                    onClick={generateTimeline}
                    disabled={timelineLoading}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white transition-colors"
                  >
                    {timelineLoading ? 'กำลังสร้าง…' : '📅 Timeline'}
                  </button>
                  <button
                    onClick={() => { setStatus('idle'); setResult(null); setLogs([]); setStatusMsg(''); setTimeline(null); setTimelineError(null); }}
                    className="px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    ← ค้นหาใหม่
                  </button>
                </div>
                {timelineError && (
                  <div className="mt-2 px-3 py-2 rounded-lg bg-red-900/30 border border-red-700/50 text-xs text-red-400">
                    {timelineError}
                  </div>
                )}
              </div>

              {/* Warnings */}
              {result.meta.warnings.length > 0 && (
                <div className="space-y-1">
                  {result.meta.warnings.map((w, i) => <p key={i} className="text-[11px] text-yellow-600">{w}</p>)}
                </div>
              )}

              {/* Tabs */}
              <div className="flex border-b border-zinc-800">
                {(['keywords', 'clusters', 'sitemap', 'timeline'] as Tab[]).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-4 py-2 text-xs font-semibold capitalize tracking-wide transition-colors border-b-2 -mb-px ${
                      activeTab === tab
                        ? 'border-white text-white'
                        : 'border-transparent text-zinc-600 hover:text-zinc-400'
                    }`}
                  >
                    {tab === 'keywords' ? `Keywords (${result.keywords.length})` :
                     tab === 'clusters' ? `Clusters (${result.clusters?.clusters.length ?? 0})` :
                     tab === 'timeline' ? `Timeline${timeline ? ` (${timeline.entries.length})` : ''}` :
                     'Sitemap'}
                  </button>
                ))}
              </div>

              {/* ── Tab: Keywords table ── */}
              {activeTab === 'keywords' && (
                <div className="space-y-4">
                  {/* Controls */}
                  <div className="flex flex-wrap gap-2 items-center">
                    <select
                      value={sortBy} onChange={e => setSortBy(e.target.value as any)}
                      className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 focus:outline-none"
                    >
                      <option value="priority_score">↓ Priority Score</option>
                      <option value="ai_search_priority_score">↓ AI Search Score</option>
                      <option value="volume">↓ Volume</option>
                      <option value="opportunity_score">↓ Opportunity</option>
                    </select>
                    <select
                      value={filterPriority} onChange={e => setFilterPriority(e.target.value as any)}
                      className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 focus:outline-none"
                    >
                      <option value="all">All priorities</option>
                      <option value="high">High only</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                    <span className="text-xs text-zinc-700 ml-auto">{displayRows.length} shown</span>
                    <button onClick={() => downloadKeywordCSV('simple')} className="bg-white text-black rounded-lg px-3 py-1.5 text-xs font-bold hover:bg-zinc-100 transition-colors">
                      Export Simple
                    </button>
                    <button onClick={() => downloadKeywordCSV('full')} className="bg-zinc-900 border border-zinc-700 text-zinc-300 rounded-lg px-3 py-1.5 text-xs font-bold hover:bg-zinc-800 transition-colors">
                      Export Full
                    </button>
                  </div>

                  {/* Table */}
                  <div className="overflow-x-auto rounded-xl border border-zinc-800">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-zinc-800 text-zinc-500 bg-zinc-950">
                          <th className="text-left px-3 py-2.5 w-8">#</th>
                          <th className="text-left px-3 py-2.5">Keyword</th>
                          <th className="text-left px-3 py-2.5 w-28">Intent</th>
                          <th className="text-left px-3 py-2.5">Title (H1)</th>
                          <th className="text-right px-3 py-2.5">Vol</th>
                          <th className="text-center px-3 py-2.5">AEO</th>
                          <th className="text-center px-3 py-2.5">AI Search</th>
                          <th className="text-center px-3 py-2.5">Priority Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayRows.map((row, i) => (
                          <tr key={i} className="border-b border-zinc-900 hover:bg-zinc-950 transition-colors">
                            <td className="px-3 py-2.5 text-zinc-700 font-mono">{i + 1}</td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <span className="text-zinc-200 font-medium whitespace-nowrap">{row.keyword}</span>
                                <VolBadge src={row.volume_source} />
                              </div>
                            </td>
                            <td className="px-3 py-2.5 w-28">
                              {row.intent && (
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${
                                  row.intent === 'transactional' ? 'bg-emerald-500/15 text-emerald-400' :
                                  row.intent === 'commercial' || row.intent === 'commercial investigation' ? 'bg-blue-500/15 text-blue-400' :
                                  row.intent === 'navigational' ? 'bg-purple-500/15 text-purple-400' :
                                  row.intent === 'update' ? 'bg-yellow-500/15 text-yellow-400' :
                                  'bg-zinc-800 text-zinc-500'
                                }`}>{row.intent}</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 max-w-xs">
                              <p className="text-zinc-400 leading-snug">{row.title}</p>
                              {row.aeo_question && (
                                <p className="text-zinc-600 italic text-[10px] mt-0.5">{row.aeo_question}</p>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono whitespace-nowrap">
                              <span className="text-zinc-400">{row.volume > 0 ? row.volume.toLocaleString() : '—'}</span>
                              {row.volume_source === 'planner_variant' && (row as any).volume_proxy_keyword && (
                                <div className="text-[9px] text-cyan-700 text-right leading-tight mt-0.5"
                                  title={`Volume จาก keyword ใกล้เคียง: "${(row as any).volume_proxy_keyword}"`}>
                                  ← {((row as any).volume_proxy_keyword as string).length > 16
                                    ? ((row as any).volume_proxy_keyword as string).slice(0, 15) + '…'
                                    : (row as any).volume_proxy_keyword}
                                </div>
                              )}
                              {row.volume_source === 'gemini_estimated' && row.seed_keyword && (row.seed_volume ?? 0) > 0 && (
                                <div className="text-[9px] text-zinc-600 text-right leading-tight mt-0.5" title={`Long-tail ของ "${row.seed_keyword}" (KP: ${(row.seed_volume ?? 0).toLocaleString()}/mo)`}>
                                  ← {(row.seed_keyword.length > 14 ? row.seed_keyword.slice(0,13)+'…' : row.seed_keyword)} {(row.seed_volume ?? 0).toLocaleString()}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-center"
                                title={[
                                  `AEO: ${row.aeo_opportunity ?? '—'} (${row.aeo_opportunity_score ?? 0})`,
                                  row.question_pattern ? `Pattern: ${row.question_pattern}` : '',
                                  row.answer_format_recommendation ? `Format: ${row.answer_format_recommendation}` : '',
                                  row.featured_snippet_potential ? 'Featured Snippet ✓' : '',
                                  row.people_also_ask_potential ? 'PAA ✓' : '',
                                  `GEO: ${row.geo_opportunity ?? '—'} (${row.geo_opportunity_score ?? 0})`,
                                  `AI Risk: ${row.ai_search_risk ?? '—'}`,
                                  `Journey: ${row.journey_stage ?? '—'}`,
                                  `Comp: ${row.competition ?? '—'}`,
                                  `Gap: ${row.gap_level ?? '—'} (${row.gap_score ?? 0})`,
                                  `Trend: ${row.trend_type ?? '—'} · ${row.refresh_priority ?? '—'}`,
                                ].filter(Boolean).join('\n')}>
                              <AEOBadge level={row.aeo_opportunity} />
                            </td>
                            <td className="px-3 py-2.5 text-center" title={row.ai_search_notes ?? ''}>
                              <AISearchScoreBadge score={row.ai_search_priority_score} level={row.ai_search_priority_level} />
                            </td>
                            <td className="px-3 py-2.5 text-center"><ScoreBadge score={row.priority_score ?? 0} max={100} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ── Tab: Clusters ── */}
              {activeTab === 'clusters' && result.clusters && (
                <div className="space-y-4">
                  {result.clusters.clusters.length === 0 ? (
                    <p className="text-zinc-600 text-sm">No clusters generated.</p>
                  ) : (
                    result.clusters.clusters.map(cluster => (
                      <div key={cluster.cluster_id} className="border border-zinc-800 rounded-xl overflow-hidden">
                        {/* Cluster header */}
                        <div className="bg-zinc-900 px-4 py-3 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] font-mono text-zinc-600">#{cluster.cluster_id}</span>
                            <span className="font-semibold text-white text-sm">{cluster.cluster_name}</span>
                            <span className="text-[10px] text-zinc-500">{cluster.supporting.length + 1} articles</span>
                          </div>
                          <span className="text-xs font-mono text-zinc-500">
                            {cluster.total_volume > 0 ? `${cluster.total_volume.toLocaleString()}/mo` : ''}
                          </span>
                        </div>

                        {/* Cluster table */}
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-zinc-800 text-zinc-600 bg-zinc-950">
                              <th className="text-left px-4 py-2 w-20">Role</th>
                              <th className="text-left px-4 py-2">Keyword</th>
                              <th className="text-left px-4 py-2">Title (H1)</th>
                              <th className="text-right px-4 py-2">Vol</th>
                              <th className="text-center px-4 py-2">Pri</th>
                            </tr>
                          </thead>
                          <tbody>
                            {/* Pillar row */}
                            <tr className="border-b border-zinc-800 bg-zinc-950/50">
                              <td className="px-4 py-2.5">
                                <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider">Pillar</span>
                              </td>
                              <td className="px-4 py-2.5 font-semibold text-zinc-100">{cluster.pillar.keyword}</td>
                              <td className="px-4 py-2.5 text-zinc-300 max-w-xs">{cluster.pillar.title}</td>
                              <td className="px-4 py-2.5 text-right font-mono text-zinc-400 whitespace-nowrap">
                                {cluster.pillar.volume > 0 ? cluster.pillar.volume.toLocaleString() : '—'}
                              </td>
                              <td className="px-4 py-2.5 text-center"><PriorityBadge p={cluster.pillar.priority} /></td>
                            </tr>
                            {/* Supporting rows */}
                            {cluster.supporting.map((kw, j) => (
                              <tr key={j} className="border-b border-zinc-900 hover:bg-zinc-950 transition-colors">
                                <td className="px-4 py-2 text-zinc-700 pl-6">└ sub</td>
                                <td className="px-4 py-2 text-zinc-300">{kw.keyword}</td>
                                <td className="px-4 py-2 text-zinc-500 max-w-xs">{kw.title}</td>
                                <td className="px-4 py-2 text-right font-mono text-zinc-600 whitespace-nowrap">
                                  {kw.volume > 0 ? kw.volume.toLocaleString() : '—'}
                                </td>
                                <td className="px-4 py-2 text-center"><PriorityBadge p={kw.priority} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))
                  )}

                  {/* Ungrouped */}
                  {result.clusters.ungrouped.length > 0 && (
                    <div className="border border-zinc-800 rounded-xl overflow-hidden">
                      <div className="bg-zinc-900 px-4 py-3">
                        <span className="font-semibold text-zinc-400 text-sm">Ungrouped ({result.clusters.ungrouped.length})</span>
                      </div>
                      <table className="w-full text-xs">
                        <tbody>
                          {result.clusters.ungrouped.map((kw, i) => (
                            <tr key={i} className="border-b border-zinc-900 hover:bg-zinc-950 transition-colors">
                              <td className="px-4 py-2 text-zinc-300">{kw.keyword}</td>
                              <td className="px-4 py-2 text-zinc-500">{kw.title}</td>
                              <td className="px-4 py-2 text-right font-mono text-zinc-600 whitespace-nowrap">
                                {kw.volume > 0 ? kw.volume.toLocaleString() : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ── Tab: Sitemap ── */}
              {activeTab === 'sitemap' && result.clusters && (
                <div className="space-y-6">
                  {/* Domain input */}
                  <div>
                    <label className="text-xs text-zinc-500 block mb-2">Your domain</label>
                    <input
                      value={domain}
                      onChange={e => setDomain(e.target.value)}
                      placeholder="https://example.com"
                      className="w-full max-w-sm bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500 transition-colors font-mono"
                    />
                  </div>

                  {/* Export buttons */}
                  <div className="flex gap-3">
                    <button
                      onClick={() => downloadSitemap('csv')}
                      className="bg-white text-black rounded-xl px-5 py-2.5 text-xs font-bold hover:bg-zinc-100 transition-colors"
                    >
                      Export Sitemap CSV
                    </button>
                    <button
                      onClick={() => downloadSitemap('xml')}
                      className="bg-zinc-900 border border-zinc-700 text-zinc-300 rounded-xl px-5 py-2.5 text-xs font-bold hover:bg-zinc-800 transition-colors"
                    >
                      Export sitemap.xml
                    </button>
                  </div>

                  {/* Sitemap preview table */}
                  <div className="overflow-x-auto rounded-xl border border-zinc-800">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-zinc-800 text-zinc-500 bg-zinc-950">
                          <th className="text-left px-3 py-2.5">Cluster</th>
                          <th className="text-left px-3 py-2.5">Role</th>
                          <th className="text-left px-3 py-2.5">Keyword</th>
                          <th className="text-left px-3 py-2.5">URL</th>
                          <th className="text-right px-3 py-2.5">Vol</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.clusters.clusters.map(cluster => (
                          <>
                            <tr key={`p-${cluster.cluster_id}`} className="border-b border-zinc-800 bg-zinc-950/40">
                              <td className="px-3 py-2.5 font-semibold text-purple-400">{cluster.cluster_name}</td>
                              <td className="px-3 py-2.5"><span className="text-purple-400 font-bold text-[10px] uppercase">Pillar</span></td>
                              <td className="px-3 py-2.5 text-zinc-200 font-medium">{cluster.pillar.keyword}</td>
                              <td className="px-3 py-2.5 text-zinc-500 font-mono text-[10px]">{domain.replace(/\/$/, '')}/{cluster.pillar.slug}/</td>
                              <td className="px-3 py-2.5 text-right font-mono text-zinc-400">{cluster.pillar.volume > 0 ? cluster.pillar.volume.toLocaleString() : '—'}</td>
                            </tr>
                            {cluster.supporting.map((kw, j) => (
                              <tr key={`s-${cluster.cluster_id}-${j}`} className="border-b border-zinc-900 hover:bg-zinc-950 transition-colors">
                                <td className="px-3 py-2.5 text-zinc-700 pl-6">└</td>
                                <td className="px-3 py-2.5 text-zinc-600 text-[10px]">sub</td>
                                <td className="px-3 py-2.5 text-zinc-400">{kw.keyword}</td>
                                <td className="px-3 py-2.5 text-zinc-600 font-mono text-[10px]">{domain.replace(/\/$/, '')}/{kw.slug}/</td>
                                <td className="px-3 py-2.5 text-right font-mono text-zinc-600">{kw.volume > 0 ? kw.volume.toLocaleString() : '—'}</td>
                              </tr>
                            ))}
                          </>
                        ))}
                        {result.clusters.ungrouped.map((kw, i) => (
                          <tr key={`u-${i}`} className="border-b border-zinc-900 hover:bg-zinc-950 transition-colors">
                            <td className="px-3 py-2.5 text-zinc-700">—</td>
                            <td className="px-3 py-2.5 text-zinc-700 text-[10px]">standalone</td>
                            <td className="px-3 py-2.5 text-zinc-500">{kw.keyword}</td>
                            <td className="px-3 py-2.5 text-zinc-700 font-mono text-[10px]">{domain.replace(/\/$/, '')}/{kw.slug}/</td>
                            <td className="px-3 py-2.5 text-right font-mono text-zinc-700">{kw.volume > 0 ? kw.volume.toLocaleString() : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ── Tab: Timeline ── */}
              {activeTab === 'timeline' && (
                <div className="space-y-5">
                  {!timeline ? (
                    <div className="text-center py-20 text-zinc-600">
                      <div className="text-4xl mb-4 opacity-30">📅</div>
                      <p className="text-sm font-medium text-zinc-500">ยังไม่มี Timeline</p>
                      <p className="text-xs mt-1 text-zinc-700">เลือกวันเริ่มต้น → ระบุจำนวนวัน → กด Timeline</p>
                      <p className="text-xs mt-1 text-zinc-700">ระบบจะจัด 80/20 schedule ตาม SEO priority เฉพาะวันทำงาน</p>
                    </div>
                  ) : (() => {
                    const intentColors: Record<string, string> = {
                      transactional: 'bg-teal-700/70',
                      commercial: 'bg-blue-700/70',
                      'commercial investigation': 'bg-sky-700/70',
                      informational: 'bg-zinc-600/70',
                      navigational: 'bg-violet-700/70',
                      update: 'bg-stone-500/70',
                    };
                    const intentTextColors: Record<string, string> = {
                      transactional: 'bg-teal-900/50 text-teal-400/80',
                      commercial: 'bg-blue-900/50 text-blue-400/80',
                      'commercial investigation': 'bg-sky-900/50 text-sky-400/80',
                      informational: 'bg-zinc-800/80 text-zinc-500',
                      navigational: 'bg-violet-900/50 text-violet-400/80',
                      update: 'bg-stone-800/80 text-stone-400/80',
                    };
                    const intentLabel: Record<string, string> = {
                      transactional: 'Transactional',
                      commercial: 'Commercial',
                      'commercial investigation': 'Commercial',
                      informational: 'Informational',
                      navigational: 'Navigational',
                      update: 'Update',
                    };

                    const coreEntries = timeline.entries.filter(e => e.isCore);
                    const supportEntries = timeline.entries.filter(e => !e.isCore);
                    const maxPerWeek = Math.max(...(timeline.weeks ?? []).map(w => w.core + w.support), 1);
                    const intentCounts = timeline.entries.reduce((acc: Record<string, number>, e) => {
                      acc[e.intent] = (acc[e.intent] ?? 0) + 1; return acc;
                    }, {});

                    // Find which week is the phase boundary
                    const phase1LastEntry = coreEntries[coreEntries.length - 1];
                    const phase1LastWeek = phase1LastEntry?.weekLabel ?? '';

                    // Group entries by weekLabel
                    const entriesByWeek: Record<string, TimelineEntry[]> = {};
                    timeline.entries.forEach(e => {
                      const wl = e.weekLabel ?? 'สัปดาห์ที่ 1';
                      if (!entriesByWeek[wl]) entriesByWeek[wl] = [];
                      entriesByWeek[wl].push(e);
                    });

                    // Running article number
                    let articleNum = 0;

                    return (
                      <div className="space-y-5">

                        {/* ── Project Header ── */}
                        <div className="rounded-xl border border-zinc-700/60 bg-gradient-to-br from-zinc-900 to-zinc-950 p-5">
                          <div className="flex items-start justify-between gap-4 flex-wrap">
                            <div>
                              <div className="text-[10px] text-zinc-600 uppercase tracking-widest font-medium mb-1">Content Publishing Timeline</div>
                              <div className="text-sm text-zinc-400 mt-0.5">
                                {timeline.startDate} — {timeline.endDate}
                              </div>
                            </div>
                            <button
                              onClick={() => {
                                const rows = [['#','สัปดาห์','วันที่','วัน','Phase','ประเภท','Keyword','ชื่อบทความ','Intent','Volume','Vol Source','Opp Score']];
                                let n = 0;
                                timeline.entries.forEach(e => {
                                  n++;
                                  rows.push([
                                    String(n), e.weekLabel ?? '', e.thaiDate ?? e.date, e.dayOfWeek,
                                    String(e.phase), e.isCore ? 'Core' : 'Support',
                                    e.keyword, e.title, e.intent,
                                    String(e.volume), e.volume_source ?? '', String(e.opportunity_score ?? ''),
                                  ]);
                                });
                                const csv = rows.map(r => r.map(c => `"${c.replace(/"/g,'""')}"`).join(',')).join('\n');
                                const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
                                const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
                                a.download = `content-timeline-${timeline.startDate}.csv`; a.click();
                              }}
                              className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-700 hover:border-zinc-500 bg-zinc-800/50 hover:bg-zinc-800 text-xs font-medium text-zinc-300 hover:text-white transition-all"
                            >
                              ↓ Export CSV
                            </button>
                          </div>

                          {/* KPI Cards */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
                            {[
                              { label: 'บทความทั้งหมด', value: timeline.publishDays, color: 'text-zinc-200', sub: `${timeline.days} วันปฏิทิน` },
                              { label: 'Phase 1 — Core', value: coreEntries.length, color: 'text-slate-300', sub: `${timeline.phase1Days} วันทำงาน (20%)` },
                              { label: 'Phase 2 — Support', value: supportEntries.length, color: 'text-stone-400', sub: `${timeline.phase2Days} วันทำงาน (80%)` },
                              { label: 'วันหยุด / วันข้าม', value: timeline.skippedDays, color: 'text-zinc-600', sub: 'เสาร์-อาทิตย์ + นักขัตฤกษ์' },
                            ].map((card, ci) => (
                              <div key={ci} className="bg-zinc-800/40 rounded-lg border border-zinc-700/40 px-4 py-3">
                                <div className={`text-2xl font-bold tabular-nums ${card.color}`}>{card.value}</div>
                                <div className="text-[11px] font-medium text-zinc-300 mt-0.5">{card.label}</div>
                                <div className="text-[10px] text-zinc-600 mt-0.5">{card.sub}</div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* ── Weekly Publishing Chart ── */}
                        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                          <div className="flex items-center justify-between mb-4">
                            <div className="text-[11px] text-zinc-500 uppercase tracking-widest font-semibold">แผนบทความรายสัปดาห์</div>
                            <div className="flex items-center gap-4 text-[10px] text-zinc-600">
                              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-slate-500 inline-block"/>Core</span>
                              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-stone-500/80 inline-block"/>Support</span>
                              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-zinc-600/50 border border-zinc-600/30 inline-block"/>วันหยุด</span>
                            </div>
                          </div>
                          <div className="space-y-2">
                            {(timeline.weeks ?? []).map((w, i) => {
                              const total = w.core + w.support;
                              const corePct = maxPerWeek > 0 ? (w.core / maxPerWeek) * 100 : 0;
                              const suppPct = maxPerWeek > 0 ? (w.support / maxPerWeek) * 100 : 0;
                              const isPhase1 = (entriesByWeek[w.label] ?? []).some(e => e.phase === 1);
                              const isPhase2 = (entriesByWeek[w.label] ?? []).some(e => e.phase === 2);
                              const isMixed = isPhase1 && isPhase2;
                              return (
                                <div key={i} className="flex items-center gap-3">
                                  {/* Week label */}
                                  <div className="w-28 shrink-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[11px] text-zinc-300 font-semibold">{w.label}</span>
                                      {isMixed && <span className="text-[8px] px-1 py-px rounded bg-zinc-800 text-zinc-500">P1→P2</span>}
                                      {isPhase1 && !isMixed && <span className="text-[8px] px-1 py-px rounded bg-slate-800/80 text-slate-500">P1</span>}
                                      {isPhase2 && !isMixed && <span className="text-[8px] px-1 py-px rounded bg-stone-800/80 text-stone-500">P2</span>}
                                    </div>
                                    <div className="text-[9px] text-zinc-700 mt-0.5">{w.mondayDate}</div>
                                  </div>
                                  {/* Bar */}
                                  <div className="flex-1 flex h-6 rounded-md overflow-hidden bg-zinc-800/60 gap-px">
                                    {w.core > 0 && (
                                      <div
                                        className="bg-slate-500/80 h-full flex items-center justify-center transition-all"
                                        style={{ width: `${corePct}%` }}
                                        title={`Core: ${w.core} บทความ`}
                                      >
                                        <span className="text-[10px] text-zinc-200 font-semibold px-1">{w.core}</span>
                                      </div>
                                    )}
                                    {w.support > 0 && (
                                      <div
                                        className="bg-stone-500/60 h-full flex items-center justify-center transition-all"
                                        style={{ width: `${suppPct}%` }}
                                        title={`Support: ${w.support} บทความ`}
                                      >
                                        <span className="text-[10px] text-zinc-300 font-semibold px-1">{w.support}</span>
                                      </div>
                                    )}
                                    {total === 0 && (
                                      <div className="flex-1 flex items-center px-3">
                                        <span className="text-[9px] text-zinc-700">ไม่มีบทความสัปดาห์นี้</span>
                                      </div>
                                    )}
                                  </div>
                                  {/* Count + holidays */}
                                  <div className="w-24 shrink-0 text-right">
                                    {total > 0 && <span className="text-[11px] text-zinc-400 font-semibold tabular-nums">{total} บทความ</span>}
                                    {w.holidays.length > 0 && (
                                      <div className="flex flex-wrap justify-end gap-1 mt-0.5">
                                        {w.holidays.map((h, hi) => (
                                          <span key={hi} className="text-[8px] px-1 py-px rounded bg-zinc-700/50 text-zinc-500">หยุด</span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          {/* Holiday detail */}
                          {timeline.weeks?.some(w => w.holidays.length > 0) && (
                            <div className="mt-3 pt-3 border-t border-zinc-800 flex flex-wrap gap-2">
                              {timeline.weeks.filter(w => w.holidays.length > 0).map((w, wi) =>
                                w.holidays.map((h, hi) => (
                                  <span key={`${wi}-${hi}`} className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-500 border border-zinc-700/50">
                                    {h}
                                  </span>
                                ))
                              )}
                            </div>
                          )}
                        </div>

                        {/* ── Intent Mix ── */}
                        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                          <div className="text-[11px] text-zinc-500 uppercase tracking-widest font-semibold mb-3">สัดส่วน Search Intent</div>
                          <div className="flex h-4 rounded-full overflow-hidden gap-px mb-3">
                            {Object.entries(intentCounts).sort((a, b) => b[1] - a[1]).map(([intent, count]) => (
                              <div
                                key={intent}
                                className={`${intentColors[intent] ?? 'bg-zinc-600'} h-full`}
                                style={{ width: `${(count / timeline.entries.length) * 100}%` }}
                                title={`${intent}: ${count} บทความ (${((count/timeline.entries.length)*100).toFixed(0)}%)`}
                              />
                            ))}
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {Object.entries(intentCounts).sort((a, b) => b[1] - a[1]).map(([intent, count]) => (
                              <div key={intent} className="flex items-center gap-2">
                                <span className={`shrink-0 w-2.5 h-2.5 rounded-sm ${intentColors[intent] ?? 'bg-zinc-600'}`}/>
                                <span className="text-[11px] text-zinc-400">{intentLabel[intent] ?? intent}</span>
                                <span className="text-[11px] text-zinc-300 font-semibold ml-auto">{count}</span>
                                <span className="text-[10px] text-zinc-600">({((count/timeline.entries.length)*100).toFixed(0)}%)</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* ── Article Schedule Table ── */}
                        <div className="rounded-xl border border-zinc-800 overflow-hidden">
                          <div className="px-5 py-3.5 bg-zinc-900/80 border-b border-zinc-800 flex items-center justify-between">
                            <div className="text-[11px] text-zinc-500 uppercase tracking-widest font-semibold">ตารางเผยแพร่บทความ</div>
                            <div className="flex items-center gap-3 text-[10px] text-zinc-600">
                              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-slate-500 inline-block"/>Core — Phase 1</span>
                              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-stone-500/80 inline-block"/>Support — Phase 2</span>
                            </div>
                          </div>
                          {/* Table header */}
                          <div className="grid text-[10px] text-zinc-600 uppercase tracking-wide font-semibold px-5 py-2 bg-zinc-900/40 border-b border-zinc-800/60"
                            style={{ gridTemplateColumns: '2.5rem 7rem 4rem 5rem 1fr 6rem 4rem' }}>
                            <span>#</span>
                            <span>วันที่</span>
                            <span>Phase</span>
                            <span>ประเภท</span>
                            <span>บทความ / Keyword</span>
                            <span>Intent</span>
                            <span className="text-right">Volume</span>
                          </div>
                          {/* Rows grouped by week with week dividers */}
                          <div className="divide-y divide-zinc-800/40">
                            {(timeline.weeks ?? []).filter(w => (entriesByWeek[w.label] ?? []).length > 0).map((w, wi) => {
                              const weekEntries = entriesByWeek[w.label] ?? [];
                              const isPhase1Week = weekEntries.some(e => e.phase === 1);
                              const isPhase2Week = weekEntries.some(e => e.phase === 2);
                              const isMixedWeek = isPhase1Week && isPhase2Week;
                              return (
                                <div key={wi}>
                                  {/* Week divider */}
                                  <div className="flex items-center gap-3 px-5 py-2 border-b border-zinc-800/50 bg-zinc-800/20">
                                    <span className="text-[11px] font-semibold text-zinc-400">{w.label}</span>
                                    <span className="text-[10px] text-zinc-600">{w.mondayDate}</span>
                                    {isMixedWeek && <span className="text-[9px] px-1.5 py-px rounded bg-zinc-700/50 text-zinc-500">P1 → P2</span>}
                                    {isPhase1Week && !isMixedWeek && <span className="text-[9px] px-1.5 py-px rounded bg-slate-800/60 text-slate-500">Phase 1</span>}
                                    {isPhase2Week && !isMixedWeek && <span className="text-[9px] px-1.5 py-px rounded bg-stone-800/60 text-stone-500">Phase 2</span>}
                                    <div className="ml-auto flex items-center gap-2 text-[10px] text-zinc-600">
                                      {w.core > 0 && <span><span className="text-slate-400 font-semibold">{w.core}</span> Core</span>}
                                      {w.support > 0 && <span><span className="text-stone-400 font-semibold">{w.support}</span> Support</span>}
                                      {w.holidays.map((h, hi) => (
                                        <span key={hi} className="text-[9px] px-1.5 py-px rounded bg-zinc-700/50 text-zinc-500">{h}</span>
                                      ))}
                                    </div>
                                  </div>
                                  {/* Article rows — group by date so multi-article days are visually clear */}
                                  {(() => {
                                    // Group week entries by date
                                    const byDate: Record<string, TimelineEntry[]> = {};
                                    for (const e of weekEntries) {
                                      if (!byDate[e.date]) byDate[e.date] = [];
                                      byDate[e.date].push(e);
                                    }
                                    const dates = Object.keys(byDate).sort();
                                    return dates.map(date => {
                                      const dayEntries = byDate[date];
                                      const isMulti = dayEntries.length > 1;
                                      return dayEntries.map((entry, ei) => {
                                        articleNum++;
                                        const num = articleNum;
                                        const isFirst = ei === 0;
                                        return (
                                          <div
                                            key={`${date}-${ei}`}
                                            className={`grid items-center px-5 text-xs transition-colors gap-2 ${
                                              isFirst ? 'pt-3' : 'pt-1'
                                            } ${ei === dayEntries.length - 1 ? 'pb-3' : 'pb-1'} ${
                                              entry.isCore
                                                ? 'hover:bg-slate-900/30 border-l-2 border-l-slate-700/40'
                                                : 'hover:bg-stone-900/20 border-l-2 border-l-stone-700/30'
                                            } ${isMulti && !isFirst ? 'bg-zinc-900/20' : ''}`}
                                            style={{ gridTemplateColumns: '2.5rem 7rem 4rem 5rem 1fr 6rem 4rem' }}
                                          >
                                            {/* # */}
                                            <span className="text-zinc-700 tabular-nums font-mono text-[10px]">{String(num).padStart(2, '0')}</span>
                                            {/* Date — show only on first entry of the day */}
                                            <div>
                                              {isFirst ? (
                                                <>
                                                  <div className="text-zinc-200 font-medium tabular-nums">{entry.thaiDate ?? entry.date}</div>
                                                  <div className="text-[10px] text-zinc-600">{entry.dayOfWeek}{isMulti && <span className="ml-1 text-zinc-700">×{dayEntries.length}</span>}</div>
                                                </>
                                              ) : (
                                                <span className="text-zinc-700 text-[10px] pl-1">↳</span>
                                              )}
                                            </div>
                                            {/* Phase */}
                                            <span className={`text-[10px] font-medium ${entry.phase === 1 ? 'text-slate-500' : 'text-stone-500'}`}>
                                              P{entry.phase}
                                            </span>
                                            {/* Type */}
                                            {entry.isCore
                                              ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800/60 text-slate-400 border border-slate-700/30 font-medium w-fit">Core</span>
                                              : <span className="text-[10px] px-2 py-0.5 rounded-full bg-stone-800/60 text-stone-400 border border-stone-700/30 font-medium w-fit">Support</span>
                                            }
                                            {/* Keyword + Title */}
                                            <div className="min-w-0 pr-2">
                                              <div className="text-zinc-100 font-medium leading-snug truncate">{entry.keyword}</div>
                                              {entry.title && entry.title !== entry.keyword && (
                                                <div className="text-zinc-500 text-[10px] mt-0.5 leading-snug truncate">{entry.title}</div>
                                              )}
                                            </div>
                                            {/* Intent */}
                                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium w-fit ${intentTextColors[entry.intent] ?? 'bg-zinc-800 text-zinc-500'}`}>
                                              {intentLabel[entry.intent] ?? entry.intent}
                                            </span>
                                            {/* Volume */}
                                            <div className="text-right">
                                              <span className="text-[11px] text-zinc-400 tabular-nums font-mono">
                                                {entry.volume > 0 ? entry.volume.toLocaleString() : '—'}
                                              </span>
                                              {entry.volume_source === 'keyword_planner' && (
                                                <div className="text-[8px] text-blue-400 mt-0.5">KP</div>
                                              )}
                                              {(entry.volume_source === 'dataforseo' || entry.volume_source === 'planner_variant') && (
                                                <div className="text-[8px] text-violet-400 mt-0.5">DFS</div>
                                              )}
                                              {entry.volume_source === 'planner_variant' && (entry as any).volume_proxy_keyword && (
                                                <div className="text-[8px] text-cyan-700 mt-0.5 leading-tight"
                                                  title={`Volume จาก: "${(entry as any).volume_proxy_keyword}"`}>
                                                  ≈ {((entry as any).volume_proxy_keyword as string).length > 12
                                                    ? ((entry as any).volume_proxy_keyword as string).slice(0, 11) + '…'
                                                    : (entry as any).volume_proxy_keyword}
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        );
                                      });
                                    });
                                  })()}
                                </div>
                              );
                            })}
                          </div>
                          {/* Table footer */}
                          <div className="px-5 py-3 bg-zinc-900/40 border-t border-zinc-800 flex items-center justify-between text-[10px] text-zinc-600">
                            <span>รวม <span className="text-white font-semibold">{timeline.publishDays}</span> บทความ ใน <span className="text-white font-semibold">{timeline.days}</span> วัน</span>
                            <span>Phase 1: {coreEntries.length} บทความ · Phase 2: {supportEntries.length} บทความ</span>
                          </div>
                        </div>

                      </div>
                    );
                  })()}
                </div>
              )}

            </div>
          )}

        </div>
      </main>
    </div>
  );
}
