/**
 * WordGod — /api/crawl-site
 * Step 0.1: Crawl a website URL to extract sitemap categories + business context
 */
import { NextRequest, NextResponse } from 'next/server';
import { crawlSiteContext, buildSiteContextSummary } from '../../../lib/services/siteContextService';
import { derivePillarsFromSiteContext } from '../../../lib/pipeline/siteTaxonomy';
import { authorizeApiRequest } from '@/lib/auth/access';

export async function POST(req: NextRequest) {
  const denied = await authorizeApiRequest();
  if (denied) return denied;

  const { url } = await req.json();
  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'url is required' }, { status: 400 });
  }

  const ctx = await crawlSiteContext(url);
  const summary = buildSiteContextSummary(ctx);

  // Additive: money-page-aware pillars derived from the sitemap taxonomy. The
  // dashboard uses these to prefill pillars; falls back to a naive mapping when [].
  const derivedPillars = derivePillarsFromSiteContext(ctx);

  return NextResponse.json({ ...ctx, summary, derivedPillars });
}
