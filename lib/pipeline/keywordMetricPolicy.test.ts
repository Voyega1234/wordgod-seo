import {
  getCandidateTarget,
  isDirectMetricSource,
  isMetricLookupCandidate,
  summarizeMetricSources,
} from './keywordMetricPolicy';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function run(): void {
  console.log('\n[Keyword metric policy]');

  assert(getCandidateTarget(50) === 150, 'สร้าง candidate 3 เท่าสำหรับงานขนาดเล็ก');
  assert(getCandidateTarget(1500) === 3000, 'จำกัด candidate สูงสุดที่ 3,000');
  assert(isDirectMetricSource('keyword_planner'), 'Keyword Planner เป็นข้อมูล API โดยตรง');
  assert(isDirectMetricSource('dataforseo'), 'DataForSEO เป็นข้อมูล API โดยตรง');
  assert(!isDirectMetricSource('planner_variant'), 'Planner variant ไม่ถูกนับเป็นข้อมูลตรง');
  assert(!isDirectMetricSource('gemini_estimated'), 'Gemini estimate ไม่ถูกนับเป็นข้อมูลตรง');
  assert(isMetricLookupCandidate('ประกันเดินทางต่างประเทศ', 'th'), 'คำสั้น/ปานกลางส่งไปตรวจ metric');
  assert(!isMetricLookupCandidate('วิธีเลือกประกันเดินทางต่างประเทศให้เหมาะกับครอบครัวที่มีเด็กเล็ก', 'th'), 'คำยาวมากไม่ใช้โควตา metric provider');

  const summary = summarizeMetricSources([
    { volume_source: 'keyword_planner' },
    { volume_source: 'dataforseo' },
    { volume_source: 'planner_variant' },
    { volume_source: 'gemini_estimated' },
  ]);
  assert(summary.apiBacked === 2, 'สรุปจำนวนข้อมูล API จริงถูกต้อง');
  assert(summary.derived === 1 && summary.estimated === 1, 'แยก derived และ estimated ออกจากข้อมูลจริง');

  console.log('  ✓ Keyword metric policy test suite passed\n');
}

run();
