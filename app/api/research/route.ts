import { NextRequest, NextResponse } from 'next/server';
import { processRow } from '@/lib/processor';

export const maxDuration = 800;

export async function POST(req: NextRequest) {
  const { rows, niche, keywordCount, excludeKeywords } = await req.json();

  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'No rows provided' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const send = (data: object) => {
    writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  };

  (async () => {
    const allResults: any[] = [];
    // excludeKeywords grows per row — add newly found keywords to avoid cross-row duplicates too
    const globalExclude: string[] = Array.isArray(excludeKeywords) ? [...excludeKeywords] : [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      send({ type: 'start', index: i, total: rows.length, keyword: row.keyword, no: row.no });

      try {
        const results = await processRow(
          row.no,
          row.title,
          row.keyword,
          niche || 'Beauty & Personal Care',
          (msg: string) => send({ type: 'progress', index: i, msg }),
          keywordCount || 5,
          globalExclude
        );

        // Add newly found keywords to global exclude for next rows
        results.forEach(r => { if (r.keyword) globalExclude.push(r.keyword); });

        allResults.push(...results);
        send({ type: 'row_done', index: i, results });
      } catch (err: any) {
        send({ type: 'row_error', index: i, error: err.message });
      }

      if (i < rows.length - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    send({ type: 'done', allResults });
    writer.close();
  })();

  return new NextResponse(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
