import { NextRequest, NextResponse } from 'next/server';
import type { PipelineResult } from '@/lib/pipeline/wordgodPipeline';
import { buildPlanHtml } from '@/lib/export/planHtml';
import { authorizeApiRequest } from '@/lib/auth/access';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = await authorizeApiRequest(req);
  if (denied) return denied;

  const result = await req.json() as PipelineResult;
  if (!result || !Array.isArray(result.keywords)) {
    return NextResponse.json({ error: 'Pipeline result with keywords is required' }, { status: 400 });
  }

  const html = buildPlanHtml(result);
  const month = result.plan?.config.startMonth ?? result.meta?.generated_at?.slice(0, 7) ?? 'keywords';
  const months = result.plan ? `${result.plan.config.months}m-` : '';
  const filename = `wordgod-content-plan-${months}${month}.html`;

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
