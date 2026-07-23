import type { ClusterResult } from '../skills/topicClusterSkill';
import { tokenSimilarity } from '../text/thai';

export type PlanMode = 'quick_research' | 'full_plan';
export type ContentPriority = 'P1' | 'P2' | 'P3';
export type FunnelStage = 'TOFU' | 'MOFU' | 'BOFU';

export interface PlanPillarInput {
  name: string;
  seed?: string;
  moneyPage?: string;
  articlesPerMonth?: number;
}

export interface ContentPlanConfig {
  mode: PlanMode;
  months: number;
  articlesPerMonth: number;
  startMonth: string;
  niche: string;
  siteUrl?: string;
  pillars?: PlanPillarInput[];
}

export interface PlanningKeyword {
  keyword: string;
  title: string;
  volume: number;
  volume_source: string;
  competition: string;
  competition_index: number;
  organic_difficulty?: number;
  cpc?: number;
  cpc_currency?: 'THB';
  intent: string;
  keyword_type: string;
  content_type: string;
  opportunity_score: number;
  priority_score?: number;
  priority: 'high' | 'medium' | 'low';
  topic_cluster_role?: string;
  keyword_group?: string;
  parent_topic?: string;
  article_group?: string;
  primary_keyword?: string;
  secondary_keywords?: string[];
  suggested_anchor_text?: string;
  money_page_opportunity?: boolean;
  aeo_opportunity?: string;
  aeo_opportunity_score?: number;
  ai_search_priority_score?: number;
  gap_score?: number;
  trend_type?: string;
  refresh_priority?: string;
  metric_source?: string;
  metric_as_of?: string;
  metric_confidence?: string;
}

export interface ContentPlanItem {
  id: string;
  type: 'Pillar' | 'Cluster' | 'Tool';
  title: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  pillar: string;
  funnel: FunnelStage;
  intent: string;
  moneyPage: string;
  internalLinks: string[];
  suggestedAnchorText: string;
  priority: ContentPriority;
  status: 'New' | 'Refresh';
  slug: string;
  volume: number;
  organicDifficulty?: number;
  cpc?: number;
  cpcCurrency?: 'THB';
  opportunityScore: number;
  aiSearchScore?: number;
}

export interface PillarPlan {
  name: string;
  pillarKeyword: string;
  moneyPage: string;
  monthlyQuota: number;
  totalItems: number;
  p1: number;
  p2: number;
  p3: number;
  tofu: number;
  mofu: number;
  bofu: number;
}

export interface CalendarEntry {
  sequence: number;
  monthIndex: number;
  month: string;
  publishDate: string;
  contentItemId: string;
  title: string;
  primaryKeyword: string;
  pillar: string;
  contentType: ContentPlanItem['type'];
  funnel: FunnelStage;
  priority: ContentPriority;
  moneyPage: string;
  internalLinks: string[];
  status: ContentPlanItem['status'];
}

export interface ContentPlanQa {
  passes: boolean;
  duplicateKeywords: string[];
  duplicateTitles: string[];
  missingMoneyPages: number;
  missingInternalLinks: number;
  missingOrganicDifficulty: number;
  missingCpc: number;
  calendarOutsideKeywordMaster: number;
  requestedArticles: number;
  scheduledArticles: number;
  warnings: string[];
}

export interface ContentPlanResult {
  config: ContentPlanConfig;
  contentItems: ContentPlanItem[];
  pillars: PillarPlan[];
  calendar: CalendarEntry[];
  qa: ContentPlanQa;
  summary: {
    keywordCount: number;
    contentItemCount: number;
    calendarCount: number;
    pillarCount: number;
    generatedAt: string;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function slugify(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'content';
}

function joinUrl(base: string | undefined, slug: string): string {
  if (!base) return '';
  return `${base.replace(/\/$/, '')}/${slug.replace(/^\//, '')}/`;
}

function funnelFromIntent(intent: string): FunnelStage {
  if (['transactional', 'service_seeking', 'price', 'local'].includes(intent)) return 'BOFU';
  if (['commercial', 'commercial investigation', 'comparison', 'review'].includes(intent)) return 'MOFU';
  return 'TOFU';
}

function priorityFromKeyword(keyword: PlanningKeyword): ContentPriority {
  let score = keyword.priority_score ?? keyword.opportunity_score ?? 0;
  if (typeof keyword.organic_difficulty === 'number') {
    if (keyword.organic_difficulty <= 30) score += 5;
    if (keyword.organic_difficulty >= 70) score -= 5;
  }
  if (score >= 75 || keyword.priority === 'high') return 'P1';
  if (score >= 52 || keyword.priority === 'medium') return 'P2';
  return 'P3';
}

function contentTypeForKeyword(keyword: PlanningKeyword, isClusterPillar: boolean): ContentPlanItem['type'] {
  if (isClusterPillar || keyword.topic_cluster_role === 'parent_topic') return 'Pillar';
  if (['checklist', 'calculator', 'tool'].includes(keyword.keyword_type) || keyword.content_type === 'checklist_article') {
    return 'Tool';
  }
  return 'Cluster';
}

function duplicateValues(values: string[]): string[] {
  const count = new Map<string, number>();
  for (const value of values) {
    const key = normalize(value);
    if (!key) continue;
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  return [...count.entries()].filter(([, n]) => n > 1).map(([value]) => value);
}

function monthKey(startMonth: string, offset: number): string {
  const valid = /^\d{4}-\d{2}$/.test(startMonth) ? startMonth : new Date().toISOString().slice(0, 7);
  const [year, month] = valid.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function businessDates(month: string, count: number): string[] {
  if (count <= 0) return [];
  const [year, monthNumber] = month.split('-').map(Number);
  const dates: string[] = [];
  const cursor = new Date(Date.UTC(year, monthNumber - 1, 1));
  while (cursor.getUTCMonth() === monthNumber - 1) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  if (dates.length === 0) return [];
  if (count === 1) return [dates[Math.floor(dates.length / 2)]];
  return Array.from({ length: count }, (_, index) => {
    const position = Math.round(index * (dates.length - 1) / Math.max(count - 1, 1));
    return dates[Math.min(position, dates.length - 1)];
  });
}

function buildClusterLookup(clusters: ClusterResult): Map<string, { name: string; pillarKeyword: string; isPillar: boolean }> {
  const lookup = new Map<string, { name: string; pillarKeyword: string; isPillar: boolean }>();
  for (const cluster of clusters.clusters) {
    lookup.set(normalize(cluster.pillar.keyword), {
      name: cluster.cluster_name,
      pillarKeyword: cluster.pillar.keyword,
      isPillar: true,
    });
    for (const supporting of cluster.supporting) {
      lookup.set(normalize(supporting.keyword), {
        name: cluster.cluster_name,
        pillarKeyword: cluster.pillar.keyword,
        isPillar: false,
      });
    }
  }
  return lookup;
}

function chooseExplicitPillar(keyword: PlanningKeyword, pillars: PlanPillarInput[]): PlanPillarInput | undefined {
  let best: { pillar: PlanPillarInput; score: number } | undefined;
  for (const pillar of pillars) {
    const candidate = pillar.seed || pillar.name;
    const directMatch = normalize(keyword.keyword).includes(normalize(candidate)) ? 1 : 0;
    const score = Math.max(directMatch, tokenSimilarity(keyword.keyword, candidate, 'th'));
    if (!best || score > best.score) best = { pillar, score };
  }
  return best && best.score >= 0.2 ? best.pillar : undefined;
}

function allocateMonthlyQuotas(pillars: PlanPillarInput[], articlesPerMonth: number): Map<string, number> {
  const quotas = new Map<string, number>();
  if (pillars.length === 0) return quotas;

  const requested = pillars.map(p => clamp(p.articlesPerMonth ?? 0, 0, articlesPerMonth));
  const requestedTotal = requested.reduce((sum, value) => sum + value, 0);
  if (requestedTotal > 0) {
    const scale = requestedTotal > articlesPerMonth ? articlesPerMonth / requestedTotal : 1;
    let allocated = 0;
    pillars.forEach((pillar, index) => {
      const value = index === pillars.length - 1
        ? Math.max(0, articlesPerMonth - allocated)
        : Math.round(requested[index] * scale);
      quotas.set(pillar.name, value);
      allocated += value;
    });
    return quotas;
  }

  const base = Math.floor(articlesPerMonth / pillars.length);
  let remainder = articlesPerMonth - base * pillars.length;
  for (const pillar of pillars) {
    quotas.set(pillar.name, base + (remainder-- > 0 ? 1 : 0));
  }
  return quotas;
}

export function buildContentPlan(
  keywords: PlanningKeyword[],
  clusters: ClusterResult,
  rawConfig: ContentPlanConfig
): ContentPlanResult {
  const config: ContentPlanConfig = {
    ...rawConfig,
    months: clamp(rawConfig.months, 1, 12),
    articlesPerMonth: clamp(rawConfig.articlesPerMonth, 1, 50),
    startMonth: /^\d{4}-\d{2}$/.test(rawConfig.startMonth)
      ? rawConfig.startMonth
      : new Date().toISOString().slice(0, 7),
    pillars: (rawConfig.pillars ?? []).filter(pillar => pillar.name.trim()),
  };

  const clusterLookup = buildClusterLookup(clusters);
  const explicitPillars = config.pillars ?? [];
  const contentItems: ContentPlanItem[] = keywords.map((keyword, index) => {
    const cluster = clusterLookup.get(normalize(keyword.keyword));
    const explicit = chooseExplicitPillar(keyword, explicitPillars);
    const pillar = explicit?.name || cluster?.name || keyword.parent_topic || keyword.keyword_group || config.niche;
    const pillarSlug = slugify(explicit?.seed || cluster?.pillarKeyword || pillar);
    const moneyPage = explicit?.moneyPage || (keyword.money_page_opportunity ? joinUrl(config.siteUrl, pillarSlug) : '');
    const slug = slugify(keyword.keyword);
    const type = contentTypeForKeyword(keyword, cluster?.isPillar ?? false);

    return {
      id: `content-${String(index + 1).padStart(4, '0')}`,
      type,
      title: keyword.title || keyword.keyword,
      primaryKeyword: keyword.keyword,
      secondaryKeywords: keyword.secondary_keywords ?? [],
      pillar,
      funnel: funnelFromIntent(keyword.intent),
      intent: keyword.intent,
      moneyPage,
      internalLinks: [],
      suggestedAnchorText: keyword.suggested_anchor_text || keyword.keyword,
      priority: priorityFromKeyword(keyword),
      status: keyword.refresh_priority === 'urgent' ? 'Refresh' : 'New',
      slug,
      volume: keyword.volume,
      organicDifficulty: keyword.organic_difficulty,
      cpc: keyword.cpc,
      cpcCurrency: keyword.cpc_currency,
      opportunityScore: keyword.opportunity_score,
      aiSearchScore: keyword.ai_search_priority_score,
    };
  });

  const itemsByPillar = new Map<string, ContentPlanItem[]>();
  for (const item of contentItems) {
    const list = itemsByPillar.get(item.pillar) ?? [];
    list.push(item);
    itemsByPillar.set(item.pillar, list);
  }

  for (const list of itemsByPillar.values()) {
    list.sort((a, b) => {
      const typeOrder = { Pillar: 0, Tool: 1, Cluster: 2 };
      const priorityOrder = { P1: 0, P2: 1, P3: 2 };
      return typeOrder[a.type] - typeOrder[b.type]
        || priorityOrder[a.priority] - priorityOrder[b.priority]
        || b.volume - a.volume;
    });
    const pillarItem = list.find(item => item.type === 'Pillar') ?? list[0];
    const pillarUrl = joinUrl(config.siteUrl, pillarItem.slug);
    for (const item of list) {
      const links = [item.moneyPage, item.id !== pillarItem.id ? pillarUrl : ''];
      const related = list.find(candidate => candidate.id !== item.id && candidate.id !== pillarItem.id);
      if (related) links.push(joinUrl(config.siteUrl, related.slug));
      item.internalLinks = [...new Set(links.filter(Boolean))].slice(0, 3);
    }
  }

  const derivedPillars: PlanPillarInput[] = explicitPillars.length > 0
    ? explicitPillars
    : [...itemsByPillar.keys()].map(name => ({ name }));
  const quotaMap = allocateMonthlyQuotas(derivedPillars, config.articlesPerMonth);

  const orderedPools = new Map<string, ContentPlanItem[]>();
  for (const pillar of derivedPillars) {
    orderedPools.set(pillar.name, [...(itemsByPillar.get(pillar.name) ?? [])]);
  }
  for (const [name, items] of itemsByPillar) {
    if (!orderedPools.has(name)) orderedPools.set(name, [...items]);
  }

  const requestedArticles = config.months * config.articlesPerMonth;
  const calendar: CalendarEntry[] = [];
  const used = new Set<string>();

  for (let monthIndex = 0; monthIndex < config.months; monthIndex++) {
    const month = monthKey(config.startMonth, monthIndex);
    const monthItems: ContentPlanItem[] = [];

    for (const [pillarName, pool] of orderedPools) {
      const quota = quotaMap.get(pillarName) ?? Math.floor(config.articlesPerMonth / Math.max(orderedPools.size, 1));
      for (const item of pool) {
        if (monthItems.filter(entry => entry.pillar === pillarName).length >= quota) break;
        if (used.has(item.id)) continue;
        monthItems.push(item);
        used.add(item.id);
      }
    }

    if (monthItems.length < config.articlesPerMonth) {
      const remaining = contentItems
        .filter(item => !used.has(item.id))
        .sort((a, b) => b.volume - a.volume);
      for (const item of remaining.slice(0, config.articlesPerMonth - monthItems.length)) {
        monthItems.push(item);
        used.add(item.id);
      }
    }

    const dates = businessDates(month, monthItems.length);
    monthItems.forEach((item, index) => {
      calendar.push({
        sequence: calendar.length + 1,
        monthIndex: monthIndex + 1,
        month,
        publishDate: dates[index] ?? `${month}-01`,
        contentItemId: item.id,
        title: item.title,
        primaryKeyword: item.primaryKeyword,
        pillar: item.pillar,
        contentType: item.type,
        funnel: item.funnel,
        priority: item.priority,
        moneyPage: item.moneyPage,
        internalLinks: item.internalLinks,
        status: item.status,
      });
    });
  }

  const pillars: PillarPlan[] = [...itemsByPillar.entries()].map(([name, items]) => ({
    name,
    pillarKeyword: (items.find(item => item.type === 'Pillar') ?? items[0])?.primaryKeyword ?? name,
    moneyPage: items.find(item => item.moneyPage)?.moneyPage ?? '',
    monthlyQuota: quotaMap.get(name) ?? 0,
    totalItems: items.length,
    p1: items.filter(item => item.priority === 'P1').length,
    p2: items.filter(item => item.priority === 'P2').length,
    p3: items.filter(item => item.priority === 'P3').length,
    tofu: items.filter(item => item.funnel === 'TOFU').length,
    mofu: items.filter(item => item.funnel === 'MOFU').length,
    bofu: items.filter(item => item.funnel === 'BOFU').length,
  })).sort((a, b) => b.totalItems - a.totalItems);

  const keywordSet = new Set(keywords.map(keyword => normalize(keyword.keyword)));
  const duplicateKeywords = duplicateValues(keywords.map(keyword => keyword.keyword));
  const duplicateTitles = duplicateValues(contentItems.map(item => item.title));
  const missingMoneyPages = contentItems.filter(item => !item.moneyPage).length;
  const missingInternalLinks = contentItems.filter(item => item.internalLinks.length === 0).length;
  const missingOrganicDifficulty = keywords.filter(keyword => typeof keyword.organic_difficulty !== 'number').length;
  const missingCpc = keywords.filter(keyword => typeof keyword.cpc !== 'number' || keyword.cpc <= 0).length;
  const calendarOutsideKeywordMaster = calendar.filter(entry => !keywordSet.has(normalize(entry.primaryKeyword))).length;
  const warnings: string[] = [];
  if (calendar.length < requestedArticles) {
    warnings.push(`มีคีย์เวิร์ดไม่พอสำหรับ ${requestedArticles} บทความ จัดตารางได้ ${calendar.length} บทความโดยไม่ทำคีย์เวิร์ดซ้ำ`);
  }
  if (missingMoneyPages > 0) warnings.push(`${missingMoneyPages} รายการยังไม่มี Money Page`);
  if (missingOrganicDifficulty > 0) warnings.push(`${missingOrganicDifficulty} คีย์เวิร์ดยังไม่มี Organic KD`);
  if (missingCpc > 0) warnings.push(`${missingCpc} คีย์เวิร์ดยังไม่มี CPC`);
  if (duplicateKeywords.length > 0) warnings.push(`พบคีย์เวิร์ดซ้ำ ${duplicateKeywords.length} รายการ`);
  if (duplicateTitles.length > 0) warnings.push(`พบชื่อบทความซ้ำ ${duplicateTitles.length} รายการ`);

  const qa: ContentPlanQa = {
    passes: duplicateKeywords.length === 0 && duplicateTitles.length === 0 && calendarOutsideKeywordMaster === 0,
    duplicateKeywords,
    duplicateTitles,
    missingMoneyPages,
    missingInternalLinks,
    missingOrganicDifficulty,
    missingCpc,
    calendarOutsideKeywordMaster,
    requestedArticles,
    scheduledArticles: calendar.length,
    warnings,
  };

  return {
    config,
    contentItems,
    pillars,
    calendar,
    qa,
    summary: {
      keywordCount: keywords.length,
      contentItemCount: contentItems.length,
      calendarCount: calendar.length,
      pillarCount: pillars.length,
      generatedAt: new Date().toISOString(),
    },
  };
}
