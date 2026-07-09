/**
 * WordGod — /api/crawl-site
 * Step 0.1: Crawl a website URL to extract sitemap categories + business context
 */
import { NextRequest, NextResponse } from 'next/server';
import { crawlSiteContext, buildSiteContextSummary } from '../../../lib/services/siteContextService';

export async function POST(req: NextRequest) {
  const { url } = await req.json();
  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'url is required' }, { status: 400 });
  }

  const ctx = await crawlSiteContext(url);
  const summary = buildSiteContextSummary(ctx);

  return NextResponse.json({ ...ctx, summary });
}
