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
import { authorizeApiRequest } from '@/lib/auth/access';
import { isDirectMetricSource } from '@/lib/pipeline/keywordMetricPolicy';

export async function POST(req: NextRequest) {
  const denied = await authorizeApiRequest(req);
  if (denied) return denied;

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
      'Volume': isNewFormat && isDirectMetricSource(r.volume_source) ? (r.volume ?? '') : (isNewFormat ? '' : (r.volume_estimate ?? '')),
      'AEO Question': r.aeo_question || '',
    }));
    csv = stringify(data, { header: true, columns: cols, bom: true });

  } else {
    // Full / detail mode
    if (isNewFormat) {
      const cols = [
        'No.', 'Title (H1)', 'AEO Question', 'Keyword',
        'Volume', 'AI Estimate (Reference)', 'Volume Source', 'CPC (THB)',
        'CPC Original Currency', 'CPC to THB Rate', 'CPC FX As Of', 'Competition', 'Competition Index',
        'Intent', 'Intent Mix Preset', 'Keyword Type', 'Content Type',
        'Opportunity Score', 'Priority',
        'SEO Score', 'AEO Score', 'AI Search Score', 'CTR Score',
        'Title Notes',
        // Journey + Problem-First
        'Journey Stage', 'Customer Problem', 'Problem Group', 'Original Problem',
        // AI Search
        'AI Search Risk', 'AI Resilience Score',
        // Scoring
        'Sales Impact Score', 'Knowledge Impact Score', 'Buyer Intent Score',
        'Customer Pain Urgency Score', 'Keyword Depth Score',
        'Internal Link Opportunity Score', 'Problem Urgency Score',
        'Priority Score', 'Intent Bucket Score',
        // Topic / Group
        'Topic Cluster Role', 'Keyword Group', 'Parent Topic',
        'Money Page Opportunity', 'Merge With', 'Split Reason',
        // Article grouping
        'Article Group', 'Merge/Split', 'Internal Link Target',
        'Suggested Anchor Text', 'Notes',
        // QA
        'QA Pass', 'QA Warnings',
        // AEO / AI Search / GEO
        'AEO Opportunity', 'AEO Opportunity Score',
        'AI Overview Risk', 'AI Overview Risk Score',
        'GEO Opportunity', 'GEO Score',
        'AI Search Priority Score', 'AI Search Priority Level',
        'Question Pattern', 'Answer Format Recommendation',
        'Direct Answer Potential', 'Featured Snippet Potential',
        'People Also Ask Potential', 'Conversational Query',
        'Entity Based Query', 'AI Search Notes',
        // Competitor Gap
        'Gap Score', 'Gap Level', 'Gap Reasons',
        // Trend / Seasonal
        'Trend Type', 'Trend Score', 'Refresh Priority', 'Content Notes',
      ];
      const data = rows.map((r: any, idx: number) => ({
        'No.': idx + 1,
        'Title (H1)': r.title || '',
        'AEO Question': r.aeo_question || '',
        'Keyword': r.keyword || '',
        'Volume': isDirectMetricSource(r.volume_source) ? (r.volume ?? '') : '',
        'AI Estimate (Reference)': r.estimated_volume ?? '',
        'Volume Source': r.volume_source === 'keyword_planner' ? 'KP (exact)' :
                         r.volume_source === 'planner_variant' ? 'Derived variant (not exact)' :
                         r.volume_source === 'dataforseo' ? 'DataForSEO' :
                         r.volume_source === 'gemini_estimated' ? 'Estimated' : (r.volume_source || ''),
        'CPC (THB)': isDirectMetricSource(r.volume_source) && typeof r.cpc === 'number' && r.cpc > 0 ? r.cpc : '',
        'CPC Original Currency': isDirectMetricSource(r.volume_source) ? (r.cpc_original_currency || '') : '',
        'CPC to THB Rate': isDirectMetricSource(r.volume_source) ? (r.cpc_to_thb_rate ?? '') : '',
        'CPC FX As Of': isDirectMetricSource(r.volume_source) ? (r.cpc_rate_as_of || '') : '',
        'Competition': r.competition || '',
        'Competition Index': r.competition_index ?? '',
        'Intent': r.intent || '',
        'Intent Mix Preset': r.intent_mix_preset || '',
        'Keyword Type': r.keyword_type || '',
        'Content Type': r.content_type || '',
        'Opportunity Score': r.opportunity_score ?? '',
        'Priority': r.priority || '',
        'SEO Score': r.seo_score ?? '',
        'AEO Score': r.aeo_score ?? '',
        'AI Search Score': r.ai_search_score ?? '',
        'CTR Score': r.ctr_score ?? '',
        'Title Notes': r.title_notes || '',
        'Journey Stage': r.journey_stage || '',
        'Customer Problem': r.customer_problem || '',
        'Problem Group': r.problem_group || '',
        'Original Problem': r.original_problem || '',
        'AI Search Risk': r.ai_search_risk || '',
        'AI Resilience Score': r.ai_resilience_score ?? '',
        'Sales Impact Score': r.sales_impact_score ?? '',
        'Knowledge Impact Score': r.knowledge_impact_score ?? '',
        'Buyer Intent Score': r.buyer_intent_score ?? '',
        'Customer Pain Urgency Score': r.customer_pain_urgency_score ?? '',
        'Keyword Depth Score': r.keyword_depth_score ?? '',
        'Internal Link Opportunity Score': r.internal_link_opportunity_score ?? '',
        'Problem Urgency Score': r.problem_urgency_score ?? '',
        'Priority Score': r.priority_score ?? '',
        'Intent Bucket Score': r.intent_bucket_score ?? '',
        'Topic Cluster Role': r.topic_cluster_role || '',
        'Keyword Group': r.keyword_group || '',
        'Parent Topic': r.parent_topic || '',
        'Money Page Opportunity': r.money_page_opportunity ? 'YES' : '',
        'Merge With': r.merge_with || '',
        'Split Reason': r.split_reason || '',
        'Article Group': r.article_group || '',
        'Merge/Split': r.merge_or_split || '',
        'Internal Link Target': r.internal_link_target || '',
        'Suggested Anchor Text': r.suggested_anchor_text || '',
        'Notes': r.notes || '',
        'QA Pass': r.qa_passes === true ? 'YES' : r.qa_passes === false ? 'NO' : '',
        'QA Warnings': Array.isArray(r.qa_warnings) ? r.qa_warnings.join(' | ') : '',
        // AEO / AI Search / GEO
        'AEO Opportunity': r.aeo_opportunity || '',
        'AEO Opportunity Score': r.aeo_opportunity_score ?? '',
        'AI Overview Risk': r.ai_overview_risk || '',
        'AI Overview Risk Score': r.ai_overview_risk_score ?? '',
        'GEO Opportunity': r.geo_opportunity || '',
        'GEO Score': r.geo_opportunity_score ?? '',
        'AI Search Priority Score': r.ai_search_priority_score ?? '',
        'AI Search Priority Level': r.ai_search_priority_level || '',
        'Question Pattern': r.question_pattern || '',
        'Answer Format Recommendation': r.answer_format_recommendation || '',
        'Direct Answer Potential': r.direct_answer_potential ? 'YES' : '',
        'Featured Snippet Potential': r.featured_snippet_potential ? 'YES' : '',
        'People Also Ask Potential': r.people_also_ask_potential ? 'YES' : '',
        'Conversational Query': r.conversational_query_potential ? 'YES' : '',
        'Entity Based Query': r.entity_based_query ? 'YES' : '',
        'AI Search Notes': r.ai_search_notes || '',
        // Competitor Gap
        'Gap Score': r.gap_score ?? '',
        'Gap Level': r.gap_level || '',
        'Gap Reasons': Array.isArray(r.gap_reasons) ? r.gap_reasons.join(' | ') : '',
        // Trend / Seasonal
        'Trend Type': r.trend_type || '',
        'Trend Score': r.trend_score ?? '',
        'Refresh Priority': r.refresh_priority || '',
        'Content Notes': r.content_notes || '',
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
