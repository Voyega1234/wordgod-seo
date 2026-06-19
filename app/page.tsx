'use client';

import { useState, useRef, useCallback } from 'react';
import type { PipelineResult } from '@/lib/pipeline/wordgodPipeline';
import { PRESETS, INTENT_LABELS, rebalanceRatio, totalRatio } from '@/lib/skills/intentRatioSkill';
import SnakeGame from '@/app/components/SnakeGame';
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

function VolBadge({ src }: { src: string }) {
  const isPlan = src === 'keyword_planner';
  return (
    <span className={`text-[9px] font-mono px-1 py-px rounded ${isPlan ? 'bg-blue-500/20 text-blue-400' : 'bg-zinc-800 text-zinc-600'}`}>
      {isPlan ? 'KP' : 'est'}
    </span>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

type Status = 'idle' | 'running' | 'done' | 'error';
type Tab = 'keywords' | 'clusters' | 'sitemap';

export default function Home() {
  const [niche, setNiche] = useState('');
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
  const [sortBy, setSortBy] = useState<'opportunity_score' | 'volume' | 'seo_score' | 'aeo_score' | 'ai_search_score'>('opportunity_score');
  const [filterPriority, setFilterPriority] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [domain, setDomain] = useState('https://example.com');

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

  const canRun = niche.trim().length > 0 && guideKeywords.length > 0;

  const runGenerate = async () => {
    if (!canRun) return;
    setStatus('running'); setResult(null); setLogs([]); setStatusMsg('Starting...');
    abortRef.current = new AbortController();

    try {
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seeds: guideKeywords,
          niche: niche.trim(),
          businessContext: niche.trim(),
          category: niche.trim(),
          targetCount: topicCount,
          intentRatio,
          presetKey: activePreset,
          useKeywordPlanner: true,
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

                {/* Guideline file drop zone */}
                <div
                  className={`border border-dashed rounded-2xl p-8 flex flex-col items-center gap-3 cursor-pointer transition-colors ${
                    isDragging ? 'border-white bg-white/5' :
                    guideFile ? 'border-zinc-600 bg-zinc-950' :
                    'border-zinc-800 hover:border-zinc-600'
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
                  <div className="text-3xl opacity-30">⬆</div>
                  {guideFile ? (
                    <>
                      <p className="text-sm text-zinc-300">{guideFile.name}</p>
                      <p className="text-[11px] text-zinc-500">{guideKeywords.length} seed keywords loaded</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-zinc-500">Drop guideline file here</p>
                      <p className="text-[11px] text-zinc-700">CSV or TXT · keyword column or one per line</p>
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
                    Generate
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

                {/* Snake game while waiting */}
                {status === 'running' && <SnakeGame />}

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
                    <span><span className="text-blue-400 font-bold">{result.meta.planner_count}</span> Planner</span>
                    <span><span className="text-zinc-400 font-bold">{result.meta.gemini_count}</span> WordGod Est.</span>
                    <span><span className="text-emerald-400 font-bold">{result.meta.title_ai_count}</span> AI Titles</span>
                    {result.meta.cluster_count > 0 && (
                      <span><span className="text-purple-400 font-bold">{result.meta.cluster_count}</span> Clusters</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => { setStatus('idle'); setResult(null); setLogs([]); setStatusMsg(''); }}
                  className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  ← New search
                </button>
              </div>

              {/* Warnings */}
              {result.meta.warnings.length > 0 && (
                <div className="space-y-1">
                  {result.meta.warnings.map((w, i) => <p key={i} className="text-[11px] text-yellow-600">{w}</p>)}
                </div>
              )}

              {/* Tabs */}
              <div className="flex border-b border-zinc-800">
                {(['keywords', 'clusters', 'sitemap'] as Tab[]).map(tab => (
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
                      <option value="opportunity_score">↓ Opportunity</option>
                      <option value="volume">↓ Volume</option>
                      <option value="seo_score">↓ SEO</option>
                      <option value="aeo_score">↓ AEO</option>
                      <option value="ai_search_score">↓ AI Search</option>
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
                          <th className="text-left px-3 py-2.5">Title (H1)</th>
                          <th className="text-right px-3 py-2.5">Vol</th>
                          <th className="text-center px-3 py-2.5">Comp</th>
                          <th className="text-center px-3 py-2.5">Pri</th>
                          <th className="text-center px-3 py-2.5">SEO</th>
                          <th className="text-center px-3 py-2.5">AEO</th>
                          <th className="text-center px-3 py-2.5">AI</th>
                          <th className="text-center px-3 py-2.5">Opp</th>
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
                            <td className="px-3 py-2.5 max-w-xs">
                              <p className="text-zinc-400 leading-snug">{row.title}</p>
                              {row.aeo_question && (
                                <p className="text-zinc-600 italic text-[10px] mt-0.5">{row.aeo_question}</p>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right text-zinc-400 font-mono whitespace-nowrap">
                              {row.volume > 0 ? row.volume.toLocaleString() : '—'}
                            </td>
                            <td className="px-3 py-2.5 text-center"><CompBadge comp={row.competition} /></td>
                            <td className="px-3 py-2.5 text-center"><PriorityBadge p={row.priority} /></td>
                            <td className="px-3 py-2.5 text-center"><ScoreBadge score={row.seo_score} /></td>
                            <td className="px-3 py-2.5 text-center"><ScoreBadge score={row.aeo_score} /></td>
                            <td className="px-3 py-2.5 text-center"><ScoreBadge score={row.ai_search_score} /></td>
                            <td className="px-3 py-2.5 text-center"><ScoreBadge score={row.opportunity_score} max={100} /></td>
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
                                <td className="px-3 py-2.5 text-zinc-600 font-mono text-[10px]">{domain.replace(/\/$/, '')}/{cluster.pillar.slug}/{kw.slug}/</td>
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

            </div>
          )}

        </div>
      </main>
    </div>
  );
}
