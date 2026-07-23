/**
 * WordGod — Rule-Based E-E-A-T Scoring Skill
 *
 * Distilled from Convert Cake's E-E-A-T DPAM rubric (Experience, Expertise,
 * Authoritativeness, Trust). This is a rule-based ESTIMATE only — every
 * point awarded is tied to a concrete detected signal (evidence), and every
 * unmet condition is recorded as an honest gap. It NEVER fabricates a score:
 * pages that were not actually read (fetch failed or no text captured) are
 * left unscored rather than guessed.
 *
 * Deep judgment calls — nuance of first-hand experience, quality of
 * citations, depth of expert credibility — are out of scope for this rule
 * pass and belong to an optional later Gemini synthesis layer.
 *
 * Additive only. No network calls, no LLM calls. Consumes the output of
 * siteCrawlService.ts (CrawledPage / DeepCrawlResult) without modifying it.
 */

import type { CrawledPage, DeepCrawlResult } from '../services/siteCrawlService';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface EeatDimensionScore {
  score: number;
  evidence: string[];
  gaps: string[];
}

export interface EeatScore {
  url: string;
  experience: EeatDimensionScore;
  expertise: EeatDimensionScore;
  authority: EeatDimensionScore;
  trust: EeatDimensionScore;
  overall: number;
  method: 'rule-based';
  scored: boolean;
  notes: string[];
}

export interface SiteEeatSignals {
  hasAboutPage: boolean;
  hasContactPage: boolean;
  hasPrivacyOrTerms: boolean;
  hasAuthorPages: boolean;
}

export interface EeatCrawlSummary {
  pagesScored: number;
  pagesUnread: number;
  avgExperience: number;
  avgExpertise: number;
  avgAuthority: number;
  avgTrust: number;
  avgOverall: number;
  weakPages: { url: string; overall: number; topGaps: string[] }[];
}

// ─── Regex detectors ───────────────────────────────────────────────────────────

const ABOUT_RE = /about|เกี่ยวกับ|about-us/i;
const CONTACT_PAGE_RE = /contact|ติดต่อ/i;
const PRIVACY_TERMS_RE = /privacy|policy|terms|เงื่อนไข|ความเป็นส่วนตัว|นโยบาย/i;
const AUTHOR_PAGES_RE = /author|\/team|ทีมงาน|ผู้เขียน/i;

// NOTE: JS regex \b is defined over ASCII \w only and never matches around
// Thai script (Thai characters are not \w), so \b is applied only to the
// English/alphanumeric alternatives below; Thai terms are matched as plain
// substrings — otherwise these detectors would never fire on Thai content.
const FIRST_PERSON_RE = /เรา|ผม|ดิฉัน|ฉัน|\bour team\b|\bour experience\b|\bwe tested\b|\bwe tried\b|\bin my experience\b|\bI tested\b|ทดลอง|ลองใช้|รีวิว|ประสบการณ์/i;
const CREDENTIAL_RE = /\bDr\.|ดร\.|ผู้เชี่ยวชาญ|ปริญญา|\bcertified\b|\bPhD\b|\bM\.D\.|นักวิชาการ|\bexpert\b|ได้รับการรับรอง/i;
const EXAMPLE_MEDIA_RE = /ตัวอย่าง|เช่น|\bfor example\b|\bcase study\b|กรณีศึกษา|ภาพประกอบ|ขั้นตอน|\bstep[- ]by[- ]step\b/i;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(10, n));
}

function emptyDimension(gap: string): EeatDimensionScore {
  return { score: 0, evidence: [], gaps: [gap] };
}

// ─── Site-level signal derivation ─────────────────────────────────────────────

export function deriveSiteEeatSignals(pages: CrawledPage[]): SiteEeatSignals {
  const matches = (re: RegExp): boolean =>
    pages.some(page => re.test(pathnameOf(page.url)) || re.test(page.title));

  return {
    hasAboutPage: matches(ABOUT_RE),
    hasContactPage: matches(CONTACT_PAGE_RE),
    hasPrivacyOrTerms: matches(PRIVACY_TERMS_RE),
    hasAuthorPages: matches(AUTHOR_PAGES_RE),
  };
}

// ─── Per-page scoring ──────────────────────────────────────────────────────────

function scoreExperience(page: CrawledPage): EeatDimensionScore {
  let score = 0;
  const evidence: string[] = [];
  const gaps: string[] = [];

  if (page.eeat.hasAuthorByline) {
    score += 3;
    evidence.push('มี author byline');
  } else {
    gaps.push('no-author-byline');
  }

  if (FIRST_PERSON_RE.test(page.text)) {
    score += 3;
    evidence.push('พบสัญญาณประสบการณ์ตรง (first-person)');
  } else {
    gaps.push('no-first-hand-signal');
  }

  if (page.wordCount >= 600) {
    score += 2;
    evidence.push('เนื้อหายาว ≥600 คำ');
  } else if (page.wordCount >= 300) {
    score += 1;
    evidence.push('เนื้อหา ≥300 คำ');
  } else {
    gaps.push('thin-content');
  }

  if (EXAMPLE_MEDIA_RE.test(page.text)) {
    score += 2;
    evidence.push('มีตัวอย่าง/กรณีศึกษา');
  } else {
    gaps.push('no-examples');
  }

  return { score: clampScore(score), evidence, gaps };
}

function scoreExpertise(page: CrawledPage): EeatDimensionScore {
  let score = 0;
  const evidence: string[] = [];
  const gaps: string[] = [];

  if (page.eeat.hasAuthorByline) {
    score += 3;
    evidence.push('มี author byline');
  } else {
    gaps.push('no-author');
  }

  if (CREDENTIAL_RE.test(`${page.text} ${page.title}`)) {
    score += 3;
    evidence.push('พบสัญญาณความเชี่ยวชาญ/วุฒิ');
  } else {
    gaps.push('no-credentials-signal');
  }

  if (page.eeat.headingCount >= 3) {
    score += 2;
    evidence.push('โครงสร้างหัวข้อชัดเจน ≥3');
  } else {
    gaps.push('weak-structure');
  }

  if (page.wordCount >= 800) {
    score += 2;
    evidence.push('เจาะลึก ≥800 คำ');
  } else if (page.wordCount >= 400) {
    score += 1;
  } else {
    gaps.push('shallow-depth');
  }

  return { score: clampScore(score), evidence, gaps };
}

function scoreAuthority(page: CrawledPage, site?: SiteEeatSignals): EeatDimensionScore {
  let score = 0;
  const evidence: string[] = [];
  const gaps: string[] = [];

  if (page.eeat.hasStructuredData) {
    score += 3;
    evidence.push('มี structured data (schema)');
  } else {
    gaps.push('no-schema');
  }

  if (site?.hasAboutPage) {
    score += 2;
    evidence.push('เว็บมีหน้า About');
  } else {
    gaps.push('no-about-page');
  }

  if (site?.hasAuthorPages) {
    score += 2;
    evidence.push('เว็บมีหน้า author/team');
  } else {
    gaps.push('no-author-pages');
  }

  if (page.eeat.hasContactInfo || site?.hasContactPage) {
    score += 2;
    evidence.push('มีช่องทางติดต่อ');
  } else {
    gaps.push('no-contact');
  }

  if (page.metaDescription.trim().length > 0) {
    score += 1;
    evidence.push('มี meta description');
  } else {
    gaps.push('no-meta-description');
  }

  return { score: clampScore(score), evidence, gaps };
}

function scoreTrust(page: CrawledPage, site?: SiteEeatSignals): EeatDimensionScore {
  let score = 0;
  const evidence: string[] = [];
  const gaps: string[] = [];

  if (page.eeat.hasContactInfo || site?.hasContactPage) {
    score += 3;
    evidence.push('มีช่องทางติดต่อ');
  } else {
    gaps.push('no-contact');
  }

  if (page.eeat.hasPublishDate) {
    score += 2;
    evidence.push('ระบุวันที่เผยแพร่');
  } else {
    gaps.push('no-publish-date');
  }

  if (site?.hasPrivacyOrTerms) {
    score += 2;
    evidence.push('เว็บมี privacy/terms');
  } else {
    gaps.push('no-privacy-terms');
  }

  if (page.eeat.hasStructuredData) {
    score += 2;
    evidence.push('มี structured data (schema)');
  } else {
    gaps.push('no-schema');
  }

  if (page.metaDescription.trim().length > 0) {
    score += 1;
    evidence.push('มี meta description');
  } else {
    gaps.push('no-meta-description');
  }

  return { score: clampScore(score), evidence, gaps };
}

export function scoreEeatForPage(page: CrawledPage, site?: SiteEeatSignals): EeatScore {
  // Honesty gate: never guess a score for content we never actually read.
  if (page.ok === false || page.wordCount === 0) {
    return {
      url: page.url,
      experience: emptyDimension('not-read'),
      expertise: emptyDimension('not-read'),
      authority: emptyDimension('not-read'),
      trust: emptyDimension('not-read'),
      overall: 0,
      method: 'rule-based',
      scored: false,
      notes: ['page content not readable — not scored (never guessed)'],
    };
  }

  const experience = scoreExperience(page);
  const expertise = scoreExpertise(page);
  const authority = scoreAuthority(page, site);
  const trust = scoreTrust(page, site);

  const overall = Math.round(
    ((experience.score + expertise.score + authority.score + trust.score) / 4) * 10
  ) / 10;

  const notes: string[] = [];
  if (!site) {
    notes.push('ประเมิน Authority/Trust แบบหน้าเดียว (ไม่มีสัญญาณระดับเว็บ)');
  }

  return {
    url: page.url,
    experience,
    expertise,
    authority,
    trust,
    overall,
    method: 'rule-based',
    scored: true,
    notes,
  };
}

// ─── Crawl-level scoring ───────────────────────────────────────────────────────

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function scoreEeatForCrawl(
  result: DeepCrawlResult
): { siteSignals: SiteEeatSignals; scores: EeatScore[]; summary: EeatCrawlSummary } {
  const siteSignals = deriveSiteEeatSignals(result.pages);
  const scores = result.pages.map(page => scoreEeatForPage(page, siteSignals));

  const scoredPages = scores.filter(s => s.scored);
  const pagesScored = scoredPages.length;
  const pagesUnread = scores.length - pagesScored;

  const avg = (pick: (s: EeatScore) => number): number =>
    pagesScored > 0 ? round1(scoredPages.reduce((sum, s) => sum + pick(s), 0) / pagesScored) : 0;

  const avgExperience = avg(s => s.experience.score);
  const avgExpertise = avg(s => s.expertise.score);
  const avgAuthority = avg(s => s.authority.score);
  const avgTrust = avg(s => s.trust.score);
  const avgOverall = avg(s => s.overall);

  const weakPages = scoredPages
    .filter(s => s.overall < 5)
    .sort((a, b) => a.overall - b.overall)
    .slice(0, 20)
    .map(s => {
      const allGaps = [
        ...s.experience.gaps,
        ...s.expertise.gaps,
        ...s.authority.gaps,
        ...s.trust.gaps,
      ];
      const topGaps = Array.from(new Set(allGaps)).slice(0, 4);
      return { url: s.url, overall: s.overall, topGaps };
    });

  const summary: EeatCrawlSummary = {
    pagesScored,
    pagesUnread,
    avgExperience,
    avgExpertise,
    avgAuthority,
    avgTrust,
    avgOverall,
    weakPages,
  };

  return { siteSignals, scores, summary };
}
