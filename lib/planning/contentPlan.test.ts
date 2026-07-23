import { isAllowedCorporateEmail } from '../auth/domain';
import { buildContentPlan, type PlanningKeyword } from './contentPlan';
import type { ClusterResult } from '../skills/topicClusterSkill';
import { countWords, segmentWords, tokenSimilarity } from '../text/thai';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function keyword(name: string, index: number, group: string): PlanningKeyword {
  return {
    keyword: name,
    title: `คู่มือ ${name} ฉบับใช้งานจริง ${index}`,
    volume: 5000 - index * 100,
    volume_source: 'keyword_planner',
    competition: index % 2 ? 'MEDIUM' : 'LOW',
    competition_index: 30 + index,
    organic_difficulty: 20 + index,
    cpc: 12.5 + index,
    intent: index % 3 === 0 ? 'transactional' : index % 3 === 1 ? 'commercial' : 'informational',
    keyword_type: 'guide',
    content_type: 'article',
    opportunity_score: 90 - index,
    priority_score: 88 - index,
    priority: index < 8 ? 'high' : index < 18 ? 'medium' : 'low',
    keyword_group: group,
    metric_source: 'keyword_planner+dataforseo',
    metric_as_of: '2026-07-22',
    metric_confidence: 'high',
  };
}

function buildFixtures() {
  const savings = Array.from({ length: 12 }, (_, index) => keyword(`เงินออมระยะยาว ${index + 1}`, index, 'เงินออม'));
  const loans = Array.from({ length: 12 }, (_, index) => keyword(`สินเชื่อออนไลน์ ${index + 1}`, index + 12, 'สินเชื่อ'));
  const keywords = [...savings, ...loans];
  const clusters: ClusterResult = {
    clusters: [
      {
        cluster_id: 1,
        cluster_name: 'เงินออม',
        pillar: { ...savings[0], role: 'pillar', slug: 'savings', aeo_question: '' },
        supporting: savings.slice(1).map(item => ({ ...item, role: 'supporting' as const, slug: item.keyword, aeo_question: '' })),
        total_volume: savings.reduce((sum, item) => sum + item.volume, 0),
      },
      {
        cluster_id: 2,
        cluster_name: 'สินเชื่อ',
        pillar: { ...loans[0], role: 'pillar', slug: 'loans', aeo_question: '' },
        supporting: loans.slice(1).map(item => ({ ...item, role: 'supporting' as const, slug: item.keyword, aeo_question: '' })),
        total_volume: loans.reduce((sum, item) => sum + item.volume, 0),
      },
    ],
    ungrouped: [],
  };
  return { keywords, clusters };
}

function testThaiSegmentation(): void {
  console.log('\n[Thai text]');
  const words = segmentWords('วิธีสมัครสินเชื่อออนไลน์สำหรับเจ้าของธุรกิจ');
  assert(words.length >= 4, 'ตัดคำภาษาไทยได้โดยไม่พึ่งช่องว่าง');
  assert(countWords('วิธีสมัครสินเชื่อออนไลน์') > 1, 'นับคำภาษาไทยได้มากกว่า 1 คำ');
  assert(tokenSimilarity('สินเชื่อออนไลน์สมัครง่าย', 'สมัครสินเชื่อออนไลน์') > 0.4, 'วัด semantic token overlap ภาษาไทยได้');
}

function testDomainGuard(): void {
  console.log('\n[Auth domain]');
  assert(isAllowedCorporateEmail('SEO@convertcake.com'), 'ยอมรับโดเมนบริษัทแบบ case-insensitive');
  assert(!isAllowedCorporateEmail('seo@sub.convertcake.com'), 'ไม่ยอมรับ subdomain');
  assert(!isAllowedCorporateEmail('seo@convertcake.com.attacker.test'), 'ป้องกัน suffix domain spoofing');
  assert(!isAllowedCorporateEmail('convertcake.com'), 'ปฏิเสธค่าที่ไม่ใช่อีเมล');
}

function testTwelveMonthPlan(): void {
  console.log('\n[12-month plan]');
  const { keywords, clusters } = buildFixtures();
  const plan = buildContentPlan(keywords, clusters, {
    mode: 'full_plan',
    months: 12,
    articlesPerMonth: 2,
    startMonth: '2026-08',
    niche: 'การเงินส่วนบุคคล',
    siteUrl: 'https://example.com',
    pillars: [
      { name: 'เงินออม', seed: 'เงินออม', moneyPage: 'https://example.com/savings/', articlesPerMonth: 1 },
      { name: 'สินเชื่อ', seed: 'สินเชื่อ', moneyPage: 'https://example.com/loans/', articlesPerMonth: 1 },
    ],
  });

  assert(plan.config.months === 12, 'รองรับแผน 12 เดือน');
  assert(plan.calendar.length === 24, 'จัด Calendar ได้ 2 บทความ × 12 เดือน');
  assert(new Set(plan.calendar.map(item => item.primaryKeyword)).size === 24, 'ไม่ใช้ Primary Keyword ซ้ำเพื่อเติม Calendar');
  assert(new Set(plan.calendar.map(item => item.month)).size === 12, 'Calendar ครบ 12 เดือน');
  assert(plan.calendar.every(item => ![0, 6].includes(new Date(`${item.publishDate}T00:00:00Z`).getUTCDay())), 'วันเผยแพร่เป็นวันทำงาน');
  assert(plan.qa.calendarOutsideKeywordMaster === 0, 'ทุก Calendar item ตรวจย้อนกลับถึง Keyword Master ได้');
  assert(plan.qa.duplicateKeywords.length === 0 && plan.qa.duplicateTitles.length === 0, 'QA ไม่พบ Keyword/Title ซ้ำ');
  assert(plan.contentItems.every(item => item.internalLinks.length > 0), 'ทุก Content item มี Internal Link');
}

function testBoundsAndShortage(): void {
  console.log('\n[Bounds and shortage]');
  const { keywords, clusters } = buildFixtures();
  const oneMonth = buildContentPlan(keywords.slice(0, 3), clusters, {
    mode: 'full_plan', months: 0, articlesPerMonth: 50, startMonth: '2026-08', niche: 'การเงิน',
  });
  assert(oneMonth.config.months === 1, 'บังคับค่าต่ำสุดเป็น 1 เดือน');
  assert(oneMonth.calendar.length === 3, 'เมื่อ Keyword ไม่พอจะไม่สร้าง Primary Keyword ปลอม/ซ้ำ');
  assert(oneMonth.qa.warnings.some(message => message.includes('คีย์เวิร์ดไม่พอ')), 'QA แจ้งเตือนเมื่อจำนวน Keyword ไม่พอกับเป้าหมายบทความ');

  const capped = buildContentPlan(keywords, clusters, {
    mode: 'full_plan', months: 99, articlesPerMonth: 1, startMonth: '2026-08', niche: 'การเงิน',
  });
  assert(capped.config.months === 12, 'บังคับค่าสูงสุดเป็น 12 เดือน');
}

async function runAll(): Promise<void> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  WordGod — Planning, Thai & Auth Tests');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const tests = [testThaiSegmentation, testDomainGuard, testTwelveMonthPlan, testBoundsAndShortage];
  let failed = 0;
  for (const test of tests) {
    try {
      test();
    } catch (error) {
      failed++;
      console.error(error instanceof Error ? `  ✗ ${error.message}` : error);
    }
  }
  if (failed > 0) process.exit(1);
  console.log('\n  ✓ Planning test suite passed\n');
}

runAll();
