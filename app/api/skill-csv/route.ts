/**
 * WordGod — /api/skill-csv
 *
 * Runs Keyword Research & SEO Title Expert skill.
 * Supports both sync (manual/estimated) and async (Google Keyword Planner API) modes.
 * All Google Ads credentials are server-side only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { runKeywordResearchSeoTitleSkill, runKeywordResearchSeoTitleSkillAsync } from '@/lib/skills/keyword-seo-title';
import type { SkillInput } from '@/lib/skills/keyword-seo-title';

export async function POST(req: NextRequest) {
  try {
    const input: SkillInput = await req.json();

    // Use async path for Google Keyword Planner API
    const volumeSource = input.volume_source || 'estimated';
    let result;

    if (volumeSource === 'google_keyword_planner_api') {
      result = await runKeywordResearchSeoTitleSkillAsync(input);
    } else {
      result = runKeywordResearchSeoTitleSkill(input);
    }

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message, system_name: 'WordGod' },
      { status: 500 }
    );
  }
}
