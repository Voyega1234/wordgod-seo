// ─── WordGod — Keyword Research & SEO Title Expert ───────────────────────────

export type TargetLanguage = 'th' | 'en' | 'multi';
export type OutputMode = 'simple_csv' | 'full_csv';
export type SortBy = 'volume' | 'opportunity_score';
export type KeywordPlanNetwork = 'GOOGLE_SEARCH' | 'GOOGLE_SEARCH_AND_PARTNERS';

export type VolumeSource =
  | 'manual'
  | 'imported_csv'
  | 'google_keyword_planner_csv'
  | 'google_keyword_planner_api'
  | 'google_ads_api'
  | 'third_party_api'
  | 'estimated';

export type SearchIntent =
  | 'informational'
  | 'commercial'
  | 'transactional'
  | 'navigational'
  | 'local'
  | 'problem_solving'
  | 'comparison'
  | 'price'
  | 'checklist'
  | 'review'
  | 'service_seeking';

export type KeywordType =
  | 'seed'
  | 'long_tail'
  | 'question'
  | 'commercial'
  | 'transactional'
  | 'local'
  | 'problem'
  | 'comparison'
  | 'price'
  | 'checklist'
  | 'review'
  | 'brand'
  | 'seasonal'
  | 'money_keyword'
  | 'supporting_keyword';

export type Priority = 'high' | 'medium' | 'low';

export interface KeywordRow {
  keyword: string;
  volume: number;
  source: VolumeSource;
}

export interface SkillInput {
  // Business context
  business_name?: string;
  business_type?: string;
  website_url?: string;
  category?: string;

  // Targeting
  target_language?: TargetLanguage;
  target_country?: string;
  target_location_names?: string[];
  target_language_name?: string;
  google_ads_language_resource?: string;   // e.g. "languageConstants/1000"
  google_ads_geo_target_resources?: string[]; // e.g. ["geoTargetConstants/2764"]

  // Keywords
  seed_keywords?: string[];
  keyword_rows?: KeywordRow[];

  // Output control
  number_of_results?: number;
  output_mode?: OutputMode;
  sort_by?: SortBy;
  notes?: string;

  // Volume source
  volume_source?: VolumeSource;

  // Google Ads API options
  keyword_plan_network?: KeywordPlanNetwork;
  include_adult_keywords?: boolean;
  force_refresh?: boolean;
}

// Internal enriched keyword with full metrics
export interface EnrichedKeyword {
  keyword: string;
  volume: number;
  volume_source: VolumeSource;
  volume_missing: boolean;
  intent: SearchIntent;
  keyword_type: KeywordType;
  opportunity_score: number;
  priority: Priority;
  title: string;
  title_valid: boolean;
  content_type: string;
  notes: string;
  // Google Ads extra fields (undefined when not from API)
  competition?: string;          // LOW | MEDIUM | HIGH | UNSPECIFIED
  competition_index?: number;    // 0–100
  low_cpc?: number;              // always THB
  high_cpc?: number;
  cpc_currency?: 'THB';
  cpc_original_currency?: string;
  cpc_to_thb_rate?: number;
  cpc_rate_as_of?: string;
  cpc_rate_source?: string;
  monthly_trend?: number[];      // last 12 months avg monthly searches
}

// Simple CSV row (default output)
export interface SimpleRow {
  'No.': number;
  'Title (H1)': string;
  'Keyword': string;
  'Volume': number;
}

// Full CSV row with all metrics
export interface FullRow extends SimpleRow {
  'Competition': string;
  'Competition Index': number | string;
  'Low CPC (THB)': number | string;
  'High CPC (THB)': number | string;
  'CPC Original Currency': string;
  'CPC to THB Rate': number | string;
  'CPC FX As Of': string;
  'Intent': string;
  'Keyword Type': string;
  'Priority': string;
  'Opportunity Score': number;
  'Content Type': string;
  'Notes': string;
}

export interface SkillOutput {
  system_name: 'WordGod';
  skill_name: 'Keyword Research & SEO Title Expert';
  summary: {
    business_name: string;
    business_type: string;
    category: string;
    total_keywords: number;
    total_exported_rows: number;
    sort_by: SortBy;
    output_mode: OutputMode;
    volume_source_note: string;
  };
  rows: SimpleRow[] | FullRow[];
  csv_columns: string[];
  csv_string: string;
  metadata: {
    is_volume_estimated: boolean;
    has_missing_volume: boolean;
    missing_data: string[];
    warnings: string[];
    generated_at: string;
    // API-specific
    volume_source?: VolumeSource;
    api_success?: boolean;
    fallback_used?: boolean;
    fallback_source?: VolumeSource;
  };
}

export interface BusinessContext {
  business_name: string;
  business_type: string;
  category: string;
  target_language: TargetLanguage;
  target_country: string;
  notes: string;
}

// Google Ads API config (server-side only)
export interface GoogleAdsConfig {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  customerId: string;       // normalized (no dashes)
  loginCustomerId?: string; // normalized MCC id (optional)
  apiVersion: string;
}

// Internal result from GoogleKeywordPlannerService
export interface KeywordPlannerRow {
  keyword: string;
  volume: number;             // avg_monthly_searches as integer
  competition: string;        // LOW | MEDIUM | HIGH | UNSPECIFIED
  competition_index: number;  // 0–100
  low_cpc: number;            // converted to THB; 0 when conversion is unavailable
  high_cpc: number;
  cpc_currency: 'THB';
  cpc_original_currency: string;
  cpc_to_thb_rate?: number;
  cpc_rate_as_of?: string;
  cpc_rate_source?: string;
  monthly_trend: number[];
  source: 'google_keyword_planner_api';
}

export interface KeywordPlannerResult {
  success: boolean;
  rows: KeywordPlannerRow[];
  error?: string;
  cached?: boolean;
  cached_at?: string;
  warnings?: string[];
}
