import { NextRequest, NextResponse } from 'next/server';
import type { PipelineResult } from '@/lib/pipeline/wordgodPipeline';
import { buildPlanWorkbook } from '@/lib/export/planWorkbook';
import { authorizeApiRequest } from '@/lib/auth/access';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = await authorizeApiRequest(req);
  if (denied) return denied;

  const result = await req.json() as PipelineResult;
  if (!result?.plan || !Array.isArray(result.keywords)) {
    return NextResponse.json({ error: 'Full content plan result is required' }, { status: 400 });
  }

  const workbook = await buildPlanWorkbook(result);
  const month = result.plan.config.startMonth;
  const filename = `wordgod-content-plan-${result.plan.config.months}m-${month}.xlsx`;

  return new NextResponse(new Uint8Array(workbook), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

