/**
 * WordGod — /api/pipeline
 *
 * Unified keyword + title pipeline.
 * Streams SSE events while processing, then sends final result.
 *
 * POST body:
 *   seeds: string[]           — seed keywords
 *   niche: string             — content niche / business type
 *   businessContext: string   — business name + type (for AI title context)
 *   category: string
 *   targetLanguage?: string   — 'th' | 'en'
 *   targetCount: number       — how many keywords to produce
 *   excludeKeywords?: string[] — keywords to exclude
 *   useKeywordPlanner?: boolean
 *   forceRefresh?: boolean
 *
 * SSE events:
 *   { type: 'log', msg: string }
 *   { type: 'done', result: PipelineResult }
 *   { type: 'error', msg: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { runWordGodPipeline } from '@/lib/pipeline/wordgodPipeline';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_TARGET_COUNT = 300;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { seeds, niche, businessContext, category, targetLanguage, targetCount, excludeKeywords, useKeywordPlanner, forceRefresh, intentRatio, presetKey } = body;

  if (!seeds || !Array.isArray(seeds) || seeds.length === 0) {
    return NextResponse.json({ error: 'seeds array required' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const send = (data: object) => {
    writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  };

  (async () => {
    try {
      const result = await runWordGodPipeline({
        seeds,
        niche: niche || 'General',
        businessContext: businessContext || niche || 'General',
        category: category || niche || 'General',
        targetLanguage: targetLanguage || 'th',
        targetCount: Math.min(Math.max(Number(targetCount) || 50, 5), MAX_TARGET_COUNT),
        intentRatio: intentRatio || undefined,
        presetKey: presetKey || undefined,
        excludeKeywords: excludeKeywords || [],
        useKeywordPlanner: useKeywordPlanner !== false,
        forceRefresh: !!forceRefresh,
        onProgress: (msg) => send({ type: 'log', msg }),
        signal: req.signal,
      });

      send({ type: 'done', result });
    } catch (err: any) {
      send({ type: 'error', msg: err.message });
    } finally {
      writer.close();
    }
  })();

  return new NextResponse(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
