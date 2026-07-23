import { NextRequest, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/auth/access';

const THAI_HOLIDAYS: Record<string, string> = {
  '01-01': 'วันขึ้นปีใหม่',
  '04-06': 'วันจักรี',
  '04-13': 'วันสงกรานต์',
  '04-14': 'วันสงกรานต์',
  '04-15': 'วันสงกรานต์',
  '05-01': 'วันแรงงานแห่งชาติ',
  '05-04': 'วันฉัตรมงคล',
  '06-03': 'วันเฉลิมพระชนมพรรษาสมเด็จพระราชินี',
  '07-28': 'วันเฉลิมพระชนมพรรษา ร.10',
  '08-12': 'วันแม่แห่งชาติ',
  '10-13': 'วันคล้ายวันสวรรคต ร.9',
  '10-23': 'วันปิยมหาราช',
  '12-05': 'วันพ่อแห่งชาติ',
  '12-10': 'วันรัฐธรรมนูญ',
  '12-31': 'วันสิ้นปี',
};

const LUNAR_HOLIDAYS: Record<number, Record<string, string>> = {
  2025: {
    '02-12': 'วันมาฆบูชา',
    '05-12': 'วันวิสาขบูชา',
    '07-10': 'วันอาสาฬหบูชา',
    '07-11': 'วันเข้าพรรษา',
    '10-06': 'วันออกพรรษา',
  },
  2026: {
    '03-03': 'วันมาฆบูชา',
    '05-31': 'วันวิสาขบูชา',
    '07-29': 'วันอาสาฬหบูชา',
    '07-30': 'วันเข้าพรรษา',
    '10-25': 'วันออกพรรษา',
  },
  2027: {
    '02-20': 'วันมาฆบูชา',
    '05-20': 'วันวิสาขบูชา',
    '07-18': 'วันอาสาฬหบูชา',
    '07-19': 'วันเข้าพรรษา',
    '10-14': 'วันออกพรรษา',
  },
};

const THAI_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

function parseDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00');
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, n: number): string {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  return formatDate(d);
}

function getHolidayName(dateStr: string): string | null {
  const year = Number(dateStr.slice(0, 4));
  const mmdd = dateStr.slice(5);
  return THAI_HOLIDAYS[mmdd] ?? LUNAR_HOLIDAYS[year]?.[mmdd] ?? null;
}

function isWeekend(dateStr: string): boolean {
  const day = parseDate(dateStr).getDay();
  return day === 0 || day === 6;
}

// ISO week number — Mon = start of week
function getISOWeek(dateStr: string): number {
  const d = parseDate(dateStr);
  const dayOfWeek = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  const nearestThursday = new Date(d);
  nearestThursday.setDate(d.getDate() - dayOfWeek + 3);
  const yearStart = new Date(nearestThursday.getFullYear(), 0, 4);
  const yearStartDow = (yearStart.getDay() + 6) % 7;
  const weekStart = new Date(yearStart);
  weekStart.setDate(yearStart.getDate() - yearStartDow);
  return Math.ceil(((nearestThursday.getTime() - weekStart.getTime()) / 86400000 + 1) / 7);
}

// Calendar week label relative to the start date's week
function getRelativeWeek(dateStr: string, startWeek: number, startYear: number): string {
  const d = parseDate(dateStr);
  const year = d.getFullYear();
  const week = getISOWeek(dateStr);
  // Compute offset in weeks
  const startMonday = getMondayOfISOWeek(startWeek, startYear);
  const thisMonday = getMondayOfISOWeek(week, year);
  const diffDays = Math.round((thisMonday.getTime() - startMonday.getTime()) / 86400000);
  const weekNum = Math.max(Math.floor(diffDays / 7) + 1, 1);
  return `สัปดาห์ที่ ${weekNum}`;
}

function getMondayOfISOWeek(week: number, year: number): Date {
  const jan4 = new Date(year, 0, 4);
  const jan4Dow = (jan4.getDay() + 6) % 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - jan4Dow + (week - 1) * 7);
  return monday;
}

// Thai date display: "จ. 23 มิ.ย. 69"
function thaiShortDate(dateStr: string): string {
  const d = parseDate(dateStr);
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const be = (d.getFullYear() + 543) % 100;
  return `${d.getDate()} ${months[d.getMonth()]} ${be < 10 ? '0' + be : be}`;
}

function seoScore(k: any): number {
  const intentScore: Record<string, number> = {
    transactional: 1000,
    commercial: 800,
    'commercial investigation': 750,
    navigational: 400,
    informational: 200,
    update: 100,
  };
  const priorityScore = k.priority === 'high' ? 300 : k.priority === 'medium' ? 150 : 0;
  const volScore = Math.min((k.volume ?? 0) / 10, 100);
  const oppScore = (k.opportunity_score ?? 0) * 2;
  // Pillar bonus: parent_topic must always outrank supporting articles
  // so it schedules before any child in the same cluster
  const pillarBonus = (k.topic_cluster_role === 'parent_topic') ? 500 : 0;
  return (intentScore[k.intent] ?? 200) + priorityScore + volScore + oppScore + pillarBonus;
}

// After global sort, enforce cluster ordering:
// For each article_group, the pillar (parent_topic) must come before all its
// supporting articles — even if a supporting article scored higher globally.
function enforceClusterOrder(sorted: any[]): any[] {
  // Find the position of each pillar (first parent_topic per article_group)
  const pillarPos = new Map<string, number>(); // group → index in sorted
  sorted.forEach((k, i) => {
    const group = k.article_group;
    if (!group) return;
    if (k.topic_cluster_role === 'parent_topic' && !pillarPos.has(group)) {
      pillarPos.set(group, i);
    }
  });

  // For each supporting article whose group has a pillar that comes AFTER it,
  // move the pillar to just before the first supporting article in that group.
  const result = [...sorted];
  for (const [group, pIdx] of pillarPos.entries()) {
    // Find the first supporting article in this group that appears before the pillar
    const firstSupportingIdx = result.findIndex(
      (k, i) => i < pIdx && k.article_group === group && k.topic_cluster_role !== 'parent_topic'
    );
    if (firstSupportingIdx === -1) continue; // pillar already before all supporting

    // Extract pillar and re-insert before firstSupportingIdx
    const [pillar] = result.splice(pIdx, 1);
    result.splice(firstSupportingIdx, 0, pillar);
  }
  return result;
}

export async function POST(req: NextRequest) {
  const denied = await authorizeApiRequest();
  if (denied) return denied;

  const { keywords, days, startDate: rawStart } = await req.json();
  if (!keywords || !Array.isArray(keywords) || !days) {
    return NextResponse.json({ error: 'keywords[] and days required' }, { status: 400 });
  }

  const totalDays = Math.min(Math.max(Number(days), 7), 365);
  const today = new Date().toISOString().slice(0, 10);
  const startDate = rawStart && /^\d{4}-\d{2}-\d{2}$/.test(rawStart) ? rawStart : today;

  const startWeek = getISOWeek(startDate);
  const startYear = parseDate(startDate).getFullYear();

  // Sort by SEO priority (transactional → commercial → informational, then volume)
  // Pillar articles get +500 bonus so they naturally precede supporting articles.
  // enforceClusterOrder then hard-guarantees pillar-before-supporting within each group.
  const sorted = enforceClusterOrder([...keywords].sort((a, b) => seoScore(b) - seoScore(a)));

  // ── 80/20 Publish Rule ─────────────────────────────────────────────────────
  // Phase 1 (first 20–30% of working days): publish 80% of articles (Core)
  // Phase 2 (remaining 70–80% of working days): publish 20% of articles (Support)
  //
  // Core = top 80% by SEO score → goes DENSE in phase 1 (1 article per working day)
  // Support = bottom 20%        → goes SPREAD in phase 2 (every 3rd working day)
  //
  // If total keywords ≤ totalDays*0.2 (very few articles vs many days),
  // use 1-per-day for everything — don't force artificial spreading.

  const totalKws = sorted.length;
  const coreCount = Math.ceil(totalKws * 0.8);
  const coreKws   = sorted.slice(0, coreCount).map(k => ({ ...k, isCore: true }));
  const supportKws = sorted.slice(coreCount).map(k => ({ ...k, isCore: false }));

  // Build calendar: collect all working days first, then assign articles
  const publishEntries: any[] = [];
  const offEntries: any[] = [];

  // Collect all calendar days in window (extend until all articles placed)
  const maxScanDays = totalDays + 180;
  const workingDays: Array<{ dateStr: string; thaiDate: string; dayOfWeek: string; weekLabel: string; weekIso: number }> = [];

  for (let d = 0; d < maxScanDays; d++) {
    const dateStr = addDays(startDate, d);
    const weekend = isWeekend(dateStr);
    const holidayName = getHolidayName(dateStr);
    const weekLabel = getRelativeWeek(dateStr, startWeek, startYear);
    const weekIso = getISOWeek(dateStr);
    const dayObj = parseDate(dateStr);

    if (weekend || holidayName) {
      offEntries.push({
        date: dateStr,
        thaiDate: thaiShortDate(dateStr),
        dayOfWeek: THAI_DAYS[dayObj.getDay()],
        isWeekend: weekend,
        holidayName: holidayName ?? null,
        weekLabel,
        weekIso,
      });
    } else {
      workingDays.push({
        dateStr,
        thaiDate: thaiShortDate(dateStr),
        dayOfWeek: THAI_DAYS[dayObj.getDay()],
        weekLabel,
        weekIso,
      });
    }
    // Stop scanning once we have enough working days to place all articles
    if (workingDays.length >= totalKws && d >= totalDays) break;
  }

  const workingDaysTotal = workingDays.length;

  // Phase boundary: first 20% of working days = Phase 1 (Core dense)
  // remaining 80% = Phase 2 (Support spread)
  const phase1Days = Math.max(1, Math.round(workingDaysTotal * 0.20));
  const phase2Days = Math.max(1, workingDaysTotal - phase1Days);

  const phase1WorkingDays = workingDays.slice(0, phase1Days);
  const phase2WorkingDays = workingDays.slice(phase1Days);

  // ── Phase 1: distribute ALL Core keywords across phase1WorkingDays ──────────
  // Multiple articles per day if coreKws > phase1Days
  const articlesPerDayP1 = Math.ceil(coreKws.length / phase1Days);
  let coreIdx = 0;
  for (const wd of phase1WorkingDays) {
    const batch = Math.min(articlesPerDayP1, coreKws.length - coreIdx);
    for (let b = 0; b < batch; b++) {
      if (coreIdx >= coreKws.length) break;
      const kw = coreKws[coreIdx++];
      publishEntries.push({
        date: wd.dateStr,
        thaiDate: wd.thaiDate,
        dayOfWeek: wd.dayOfWeek,
        isHoliday: false,
        keyword: kw.keyword,
        title: kw.title ?? '',
        priority: kw.priority ?? 'medium',
        volume: kw.volume ?? 0,
        volume_source: kw.volume_source ?? 'gemini_estimated',
        volume_proxy_keyword: kw.volume_proxy_keyword ?? null,
        intent: kw.intent ?? '',
        opportunity_score: kw.opportunity_score ?? 0,
        isCore: true,
        phase: 1,
        weekLabel: wd.weekLabel,
        weekIso: wd.weekIso,
      });
    }
    if (coreIdx >= coreKws.length) break;
  }

  // ── Phase 2: distribute ALL Support keywords across phase2WorkingDays ───────
  // Spread evenly — multiple per day if more support than phase2 days
  const supportSpread = supportKws.length > 0 && phase2WorkingDays.length > 0
    ? Math.max(1, Math.floor(phase2WorkingDays.length / supportKws.length))
    : 1;
  let supportIdx = 0;
  for (let i = 0; i < phase2WorkingDays.length && supportIdx < supportKws.length; i++) {
    if (i % supportSpread === 0) {
      const wd = phase2WorkingDays[i];
      const kw = supportKws[supportIdx++];
      publishEntries.push({
        date: wd.dateStr,
        thaiDate: wd.thaiDate,
        dayOfWeek: wd.dayOfWeek,
        isHoliday: false,
        keyword: kw.keyword,
        title: kw.title ?? '',
        priority: kw.priority ?? 'medium',
        volume: kw.volume ?? 0,
        volume_source: kw.volume_source ?? 'gemini_estimated',
        volume_proxy_keyword: kw.volume_proxy_keyword ?? null,
        intent: kw.intent ?? '',
        opportunity_score: kw.opportunity_score ?? 0,
        isCore: false,
        phase: 2,
        weekLabel: wd.weekLabel,
        weekIso: wd.weekIso,
      });
    }
  }

  // Sort all entries by date
  publishEntries.sort((a, b) => a.date.localeCompare(b.date));

  // Build weekly summary for chart: include both publish + off days
  // Group publish entries by weekLabel
  const weekMap: Record<string, {
    label: string;
    weekIso: number;
    mondayDate: string;
    core: number;
    support: number;
    holidays: string[];     // holiday names in this week
    weekendDays: number;
  }> = {};

  for (const e of publishEntries) {
    if (!weekMap[e.weekLabel]) {
      const d = parseDate(e.date);
      const dow = (d.getDay() + 6) % 7; // Mon=0
      const monday = new Date(d);
      monday.setDate(d.getDate() - dow);
      weekMap[e.weekLabel] = {
        label: e.weekLabel,
        weekIso: e.weekIso,
        mondayDate: formatDate(monday),
        core: 0, support: 0,
        holidays: [], weekendDays: 0,
      };
    }
    if (e.isCore) weekMap[e.weekLabel].core++;
    else weekMap[e.weekLabel].support++;
  }

  // Fill in off entries into the right week bucket (create bucket if first entry in week)
  for (const o of offEntries) {
    if (!weekMap[o.weekLabel]) {
      const d = parseDate(o.date);
      const dow = (d.getDay() + 6) % 7;
      const monday = new Date(d);
      monday.setDate(d.getDate() - dow);
      weekMap[o.weekLabel] = {
        label: o.weekLabel,
        weekIso: o.weekIso,
        mondayDate: formatDate(monday),
        core: 0, support: 0,
        holidays: [], weekendDays: 0,
      };
    }
    if (o.isWeekend) weekMap[o.weekLabel].weekendDays++;
    if (o.holidayName) weekMap[o.weekLabel].holidays.push(o.holidayName);
  }

  const weeks = Object.values(weekMap).sort((a, b) => {
    if (a.mondayDate < b.mondayDate) return -1;
    if (a.mondayDate > b.mondayDate) return 1;
    return 0;
  });

  const endDate = publishEntries.length > 0 ? publishEntries[publishEntries.length - 1].date : startDate;

  return NextResponse.json({
    days: totalDays,
    startDate,
    endDate,
    publishDays: publishEntries.length,
    skippedDays: offEntries.length,
    phase1Days,
    phase2Days,
    coreCount,
    supportCount: supportKws.length,
    supportSpread,
    entries: publishEntries,
    weeks,
  });
}
