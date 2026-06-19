/**
 * WordGod — Keyword Research & SEO Title Expert
 * Unit Tests — 3 test cases (no external API required)
 */

import { runKeywordResearchSeoTitleSkill } from './index';
import { normalizeVolume, deduplicateKeywords } from './modules';

// ─── Helper ───────────────────────────────────────────────────────────────────
function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

// ─── Test Case 1: Beauty & Personal Care ─────────────────────────────────────
function testBeautyPersonalCare() {
  console.log('\n[Test 1] Beauty & Personal Care');

  const result = runKeywordResearchSeoTitleSkill({
    business_name: 'CVC',
    business_type: 'content website',
    category: 'Beauty & Personal Care',
    target_language: 'th',
    target_country: 'Thailand',
    seed_keywords: ['สิว', 'ครีมกันแดด', 'เซรั่มหน้า', 'ครีมบำรุงหน้า', 'แชมพู'],
    keyword_rows: [
      { keyword: 'สิว', volume: 90500, source: 'manual' },
      { keyword: 'ครีมกันแดด', volume: 74000, source: 'manual' },
      { keyword: 'เซรั่มหน้า', volume: 49500, source: 'manual' },
    ],
    number_of_results: 100,
    output_mode: 'simple_csv',
    sort_by: 'volume',
  });

  assert(result.system_name === 'WordGod', 'system_name = WordGod');
  assert(result.skill_name === 'Keyword Research & SEO Title Expert', 'skill_name correct');
  assert(result.rows.length > 0, 'has rows');
  assert(result.csv_columns.join(',') === 'No.,Title (H1),Keyword,Volume', 'simple_csv columns correct');

  // First row must be สิว (highest volume)
  const firstRow = result.rows[0] as any;
  assert(firstRow['Keyword'] === 'สิว', 'first keyword = สิว (highest volume)');
  assert(firstRow['Volume'] === 90500, 'สิว volume = 90500');
  assert(typeof firstRow['Volume'] === 'number', 'Volume is number (no comma)');
  assert(firstRow['Title (H1)'].includes('สิว'), 'title contains keyword');
  assert(firstRow['No.'] === 1, 'No. starts at 1');

  // CSV format checks
  assert(result.csv_string.includes('No.,Title (H1),Keyword,Volume'), 'CSV has header');
  assert(!result.csv_string.includes('90,500'), 'Volume has no comma in CSV');
  assert(result.csv_string.startsWith('﻿'), 'CSV has UTF-8 BOM');

  // No forbidden phrases in any title
  const forbidden = ['ดีที่สุด', 'อันดับ 1', '100%', 'การันตี', 'เห็นผลแน่นอน'];
  result.rows.forEach((row: any) => {
    forbidden.forEach(f => {
      assert(!row['Title (H1)'].includes(f), `title does not contain "${f}"`);
    });
  });

  // Metadata
  assert(!result.metadata.has_missing_volume || result.metadata.missing_data.length >= 0, 'metadata.missing_data is array');
  assert(typeof result.metadata.generated_at === 'string', 'metadata.generated_at is string');

  console.log(`  → ${result.rows.length} rows exported`);
  console.log(`  → CSV preview:\n${result.csv_string.replace('﻿', '').split('\n').slice(0, 4).join('\n')}`);
}

// ─── Test Case 2: Visa / Travel Service ──────────────────────────────────────
function testVisaTravel() {
  console.log('\n[Test 2] Visa / Travel Service');

  const result = runKeywordResearchSeoTitleSkill({
    business_name: 'Co Journey Visa',
    business_type: 'visa agency',
    category: 'Visa / Travel',
    target_language: 'th',
    target_country: 'Thailand',
    seed_keywords: ['วีซ่าเยอรมัน', 'วีซ่าเชงเก้น', 'รับยื่นวีซ่า'],
    number_of_results: 50,
    output_mode: 'simple_csv',
    sort_by: 'volume',
  });

  assert(result.system_name === 'WordGod', 'system_name = WordGod');
  assert(result.rows.length > 0, 'has rows');
  assert(result.csv_columns.length === 4, 'simple_csv has 4 columns');

  // No forbidden visa phrases
  const visaForbidden = ['การันตีวีซ่า', 'ผ่านแน่นอน', '100%', 'รับประกัน'];
  result.rows.forEach((row: any) => {
    visaForbidden.forEach(f => {
      assert(!row['Title (H1)'].includes(f), `title does not contain "${f}"`);
    });
  });

  // Keywords generated from seeds
  const keywords = result.rows.map((r: any) => r['Keyword']);
  assert(keywords.some(k => k.includes('วีซ่า')), 'has วีซ่า-related keywords');

  // Volume = 0 for estimated (no keyword_rows provided)
  const allZeroVol = result.rows.every((r: any) => typeof r['Volume'] === 'number');
  assert(allZeroVol, 'all Volume fields are numbers');

  // Metadata should flag estimated volume
  assert(result.metadata.is_volume_estimated, 'metadata: volume is estimated');
  assert(result.metadata.has_missing_volume, 'metadata: has_missing_volume = true');

  console.log(`  → ${result.rows.length} rows | volume_note: ${result.summary.volume_source_note.slice(0, 60)}...`);
}

// ─── Test Case 3: Ecommerce — Full CSV ───────────────────────────────────────
function testEcommerceFullCsv() {
  console.log('\n[Test 3] Ecommerce — Home Appliance (full_csv)');

  const result = runKeywordResearchSeoTitleSkill({
    business_name: 'Example Store',
    business_type: 'ecommerce',
    category: 'Home Appliance',
    target_language: 'th',
    target_country: 'Thailand',
    seed_keywords: ['เครื่องฟอกอากาศ', 'พัดลมไอเย็น', 'หม้อทอดไร้น้ำมัน'],
    number_of_results: 50,
    output_mode: 'full_csv',
    sort_by: 'volume',
  });

  assert(result.system_name === 'WordGod', 'system_name = WordGod');
  assert(result.summary.output_mode === 'full_csv', 'output_mode = full_csv');

  const expectedCols = ['No.', 'Title (H1)', 'Keyword', 'Volume', 'Intent', 'Keyword Type', 'Priority', 'Opportunity Score', 'Content Type', 'Notes'];
  expectedCols.forEach(col => {
    assert(result.csv_columns.includes(col), `full_csv has column: ${col}`);
  });

  // Check full_csv rows have extra fields
  const firstRow = result.rows[0] as any;
  assert('Intent' in firstRow, 'row has Intent field');
  assert('Keyword Type' in firstRow, 'row has Keyword Type field');
  assert('Priority' in firstRow, 'row has Priority');
  assert('Opportunity Score' in firstRow, 'row has Opportunity Score');
  assert(['high', 'medium', 'low'].includes(firstRow['Priority']), 'Priority is valid value');
  assert(firstRow['Opportunity Score'] >= 0 && firstRow['Opportunity Score'] <= 100, 'Opportunity Score 0-100');
  assert('Content Type' in firstRow, 'row has Content Type');

  // Ecommerce should have buying-guide style titles
  const hasCommercialTitle = result.rows.some((r: any) =>
    r['Title (H1)'].includes('วิธีเลือก') ||
    r['Title (H1)'].includes('ก่อนซื้อ') ||
    r['Title (H1)'].includes('เปรียบเทียบ') ||
    r['Title (H1)'].includes('เหมาะกับ')
  );
  assert(hasCommercialTitle, 'has commercial/buying-guide titles');

  // Missing volume warning in metadata
  assert(result.metadata.warnings.length > 0, 'metadata has warnings about missing volume');
  assert(result.metadata.has_missing_volume, 'metadata: has_missing_volume = true');

  console.log(`  → ${result.rows.length} rows | cols: ${result.csv_columns.join(', ')}`);
  console.log(`  → Warnings: ${result.metadata.warnings.join(' | ')}`);
}

// ─── Unit: normalizeVolume ────────────────────────────────────────────────────
function testNormalizeVolume() {
  console.log('\n[Unit] normalizeVolume');

  assert(normalizeVolume('90,500').volume === 90500, '"90,500" → 90500');
  assert(normalizeVolume('90.5k').volume === 90500, '"90.5k" → 90500');
  assert(normalizeVolume('1.2M').volume === 1200000, '"1.2M" → 1200000');
  assert(normalizeVolume(74000).volume === 74000, '74000 → 74000');
  assert(normalizeVolume('').volume === 0, '"" → 0');
  assert(normalizeVolume(null).volume === 0, 'null → 0');
  assert(normalizeVolume(undefined).volume === 0, 'undefined → 0');
  assert(normalizeVolume('').missing === true, '"" → missing=true');
  assert(normalizeVolume(1000).missing === false, '1000 → missing=false');
}

// ─── Unit: deduplicateKeywords ────────────────────────────────────────────────
function testDeduplication() {
  console.log('\n[Unit] deduplicateKeywords');

  const input = [
    { keyword: 'สิว', volume: 100, source: 'manual' as const },
    { keyword: 'สิว', volume: 200, source: 'manual' as const },     // duplicate
    { keyword: ' สิว ', volume: 300, source: 'manual' as const },   // space duplicate
    { keyword: 'ครีมกันแดด', volume: 500, source: 'manual' as const },
  ];

  const result = deduplicateKeywords(input);
  assert(result.length === 2, 'dedup: 4 → 2 unique keywords');
  assert(result[0].keyword === 'สิว', 'first unique keyword is สิว');
  assert(result[1].keyword === 'ครีมกันแดด', 'second unique keyword is ครีมกันแดด');
}

// ─── Run All ──────────────────────────────────────────────────────────────────
async function runAll() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  WordGod — Keyword Research & SEO Title Expert');
  console.log('  Unit Tests');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  let passed = 0;
  let failed = 0;

  const tests = [
    testNormalizeVolume,
    testDeduplication,
    testBeautyPersonalCare,
    testVisaTravel,
    testEcommerceFullCsv,
  ];

  for (const test of tests) {
    try {
      test();
      passed++;
    } catch (e: any) {
      console.error(`  ✗ ${e.message}`);
      failed++;
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (failed > 0) process.exit(1);
}

runAll();
