/**
 * Tests for seoTitleAiSkill — buildSerpFewShotBlock (competitor-title few-shot).
 * Run: npx ts-node --project tsconfig.test.json lib/skills/seoTitleAiSkill.test.ts
 */
import { buildSerpFewShotBlock } from './seoTitleAiSkill';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

function main(): void {
  console.log('seoTitleAiSkill');

  // No entries → empty string (caller prepends unconditionally).
  assert(buildSerpFewShotBlock([]) === '', 'no entries → empty string');

  // Entry with only blank titles → contributes nothing → empty string.
  assert(
    buildSerpFewShotBlock([{ keyword: 'สินเชื่อบ้าน', competitorTitles: ['', '   '] }]) === '',
    'entry with only blank titles → empty string',
  );

  // Real entries → renders one line per keyword with its titles.
  const block = buildSerpFewShotBlock([
    { keyword: 'สินเชื่อบ้าน', competitorTitles: ['สินเชื่อบ้าน ธนาคาร A', 'กู้บ้าน ดอกเบี้ยต่ำ'] },
    { keyword: 'รีไฟแนนซ์บ้าน', competitorTitles: ['รีไฟแนนซ์บ้าน 2025'] },
  ]);
  assert(block.includes('บริบทคู่แข่งจาก Google'), 'renders the competitor-context header');
  assert(block.includes('ห้ามลอก'), 'instructs the model not to copy');
  assert(block.includes('"สินเชื่อบ้าน"') && block.includes('สินเชื่อบ้าน ธนาคาร A'),
         'includes the keyword and its competitor titles');
  assert(block.includes('รีไฟแนนซ์บ้าน 2025'), 'includes the second keyword line');

  // Caps at 5 titles per keyword.
  const capped = buildSerpFewShotBlock([
    { keyword: 'x', competitorTitles: ['t1', 't2', 't3', 't4', 't5', 't6', 't7'] },
  ]);
  assert(capped.includes('t5') && !capped.includes('t6'), 'caps at 5 competitor titles');

  // Blank titles inside a mixed entry are dropped, real ones kept.
  const mixed = buildSerpFewShotBlock([
    { keyword: 'y', competitorTitles: ['', 'good title', '  '] },
  ]);
  assert(mixed.includes('good title') && mixed.includes('"y"'), 'keeps real titles, drops blanks');

  console.log(`\n✅ seoTitleAiSkill: ${passed} assertions passed`);
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
