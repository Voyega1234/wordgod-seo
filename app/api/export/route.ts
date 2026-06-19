/**
 * WordGod — /api/export
 *
 * Exports keyword results to CSV.
 * Supports two modes:
 *   'simple'  — No., Title (H1), Keyword, Volume, AEO Question
 *   'full'    — All metrics including SEO/AEO/AI scores, competition
 *
 * Both old (research pipeline) and new (wordgod pipeline) row formats accepted.
 */
import { NextRequest, NextResponse } from 'next/server';
import { stringify } from 'csv-stringify/sync';

export async function POST(req: NextRequest) {
  const { rows, mode } = await req.json();

  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: 'No rows' }, { status: 400 });
  }

  const isNewFormat = rows[0] && 'volume_source' in rows[0];
  let csv: string;

  if (mode === 'simple' || mode === 'best') {
    const cols = ['No.', 'Title (H1)', 'Keyword', 'Volume', 'AEO Question'];
    const source = isNewFormat
      ? rows
      : rows.filter((r: any) => r.is_best === 'YES');

    const data = source.map((r: any, idx: number) => ({
      'No.': idx + 1,
      'Title (H1)': r.title || '',
      'Keyword': r.keyword || '',
      'Volume': isNewFormat ? (r.volume ?? '') : (r.volume_estimate ?? ''),
      'AEO Question': r.aeo_question || '',
    }));
    csv = stringify(data, { header: true, columns: cols, bom: true });

  } else {
    // Full / detail mode
    if (isNewFormat) {
      const cols = [
        'No.', 'Title (H1)', 'AEO Question', 'Keyword',
        'Volume', 'Volume Source', 'Competition', 'Competition Index',
        'Intent', 'Keyword Type',
        'Content Type', 'Opportunity Score', 'Priority',
        'SEO Score', 'AEO Score', 'AI Search Score', 'CTR Score',
        'Title Notes',
      ];
      const data = rows.map((r: any, idx: number) => ({
        'No.': idx + 1,
        'Title (H1)': r.title || '',
        'AEO Question': r.aeo_question || '',
        'Keyword': r.keyword || '',
        'Volume': r.volume ?? '',
        'Volume Source': r.volume_source || '',
        'Competition': r.competition || '',
        'Competition Index': r.competition_index ?? '',
        'Intent': r.intent || '',
        'Keyword Type': r.keyword_type || '',
        'Content Type': r.content_type || '',
        'Opportunity Score': r.opportunity_score ?? '',
        'Priority': r.priority || '',
        'SEO Score': r.seo_score ?? '',
        'AEO Score': r.aeo_score ?? '',
        'AI Search Score': r.ai_search_score ?? '',
        'CTR Score': r.ctr_score ?? '',
        'Title Notes': r.title_notes || '',
      }));
      csv = stringify(data, { header: true, columns: cols, bom: true });
    } else {
      // Legacy format from /api/research
      const cols = [
        'No.', 'Original Keyword', 'Keyword (Researched)', 'Title (H1)',
        'Volume Estimate', 'Volume Score (1-10)', 'Competition',
        'Opportunity Score (1-10)', 'Combined Score', 'Intent', 'Content Type',
        'CTR Score', 'SEO Score', 'Readability', 'Is Best?', 'Reason', 'Title Notes',
      ];
      const data = rows.map((r: any) => ({
        'No.': r.no,
        'Original Keyword': r.original_keyword,
        'Keyword (Researched)': r.keyword,
        'Title (H1)': r.title,
        'Volume Estimate': r.volume_estimate,
        'Volume Score (1-10)': r.volume_score,
        'Competition': r.competition,
        'Opportunity Score (1-10)': r.opportunity_score,
        'Combined Score': r.combined_score,
        'Intent': r.intent,
        'Content Type': r.content_type,
        'CTR Score': r.ctr_score,
        'SEO Score': r.seo_score,
        'Readability': r.readability,
        'Is Best?': r.is_best,
        'Reason': r.reason,
        'Title Notes': r.title_notes,
      }));
      csv = stringify(data, { header: true, columns: cols, bom: true });
    }
  }

  const filename = `wordgod-${mode || 'full'}-${Date.now()}.csv`;
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
