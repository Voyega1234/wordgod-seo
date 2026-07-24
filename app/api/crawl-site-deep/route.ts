/**
 * WordGod — /api/crawl-site-deep
 * Deep same-origin crawl of a website + rule-based EEAT signal extraction (crawl),
 * plus a DPAM-rubric E-E-A-T assessment (0–10 per axis, evidence + gaps) per page.
 */
import { NextRequest, NextResponse } from 'next/server';
import { crawlSiteDeep, type DeepCrawlOptions } from '../../../lib/services/siteCrawlService';
import { scoreEeatForCrawl } from '@/lib/skills/eeatSkill';
import { synthesizeEeatWithGemini, type GeminiSynthesisOptions } from '@/lib/skills/eeatGeminiSkill';
import { authorizeApiRequest } from '@/lib/auth/access';

export async function POST(req: NextRequest) {
  const denied = await authorizeApiRequest();
  if (denied) return denied;

  const { url, options, synthesize, synthesisOptions } = await req.json();
  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'url is required' }, { status: 400 });
  }

  try {
    const result = await crawlSiteDeep(url, options as DeepCrawlOptions | undefined);
    // DPAM E-E-A-T assessment (rule-based, evidence-linked; unread pages are not scored).
    const eeatAssessment = scoreEeatForCrawl(result);

    // Opt-in Gemini deep synthesis (Vertex OIDC, no API key). Cost-bounded and
    // sampled; token cost of the synthesis is returned in THB. Default: off.
    if (synthesize === true) {
      const eeatSynthesis = await synthesizeEeatWithGemini(
        result,
        synthesisOptions as GeminiSynthesisOptions | undefined,
      );
      return NextResponse.json({
        ...result,
        eeatAssessment,
        eeatSynthesis,
        cost_thb: eeatSynthesis.cost.cost_thb,
      });
    }

    return NextResponse.json({ ...result, eeatAssessment });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Deep crawl failed' },
      { status: 500 }
    );
  }
}
