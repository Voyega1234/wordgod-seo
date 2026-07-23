/**
 * Tests for Thai romanization + Latin slugs.
 * Run: npx ts-node --project tsconfig.test.json lib/text/thai.test.ts
 */
import { romanizeThai, slugifyLatin } from './thai';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

function main(): void {
  console.log('thai');

  // The regression this exists for: `\p{L}` drops Thai vowel/tone marks
  // (Unicode Mn), which turned "คือ" into "ค-อ" and "วิธี" into "ว-ธ".
  assert(!slugifyLatin('คือ').includes('ค'), 'slug keeps no raw Thai consonants');
  assert(slugifyLatin('คือ').length > 0, 'slug is not empty for Thai input');
  assert(!/-{2,}/.test(slugifyLatin('วิธีแก้บัญชี app ถูกระงับ')), 'no doubled separators');
  assert(!/^-|-$/.test(slugifyLatin('วิธีสมัคร mobile app')), 'no leading/trailing separator');

  // Vowels must survive as letters, not be dropped.
  assert(romanizeThai('คือ') === 'khue', 'คือ → khue');
  assert(romanizeThai('แบงก์') === 'baeng', 'แบงก์ → baeng (thanthakhat silences ก)');
  assert(romanizeThai('ประกัน').startsWith('p'), 'ประกัน starts with p');

  // Latin and digits inside a mixed string pass through untouched.
  const mixed = romanizeThai('วิธีสมัคร mobile app');
  assert(mixed.includes('mobile app'), 'Latin segment preserved in mixed string');
  assert(!/[฀-๿]/.test(mixed), 'no Thai codepoints remain');

  // Slug output is URL-safe ASCII.
  const slug = slugifyLatin('ยืมเงินผ่าน app ยังไงให้ผ่าน');
  assert(/^[a-z0-9-]+$/.test(slug), `slug is ascii-safe (${slug})`);
  assert(slug.includes('app'), 'slug retains the Latin token');

  // Pure-Latin input is unchanged apart from casing/separators.
  assert(slugifyLatin('Mobile App Personal Loan') === 'mobile-app-personal-loan', 'latin input slugs normally');
  assert(romanizeThai('burger king') === 'burger king', 'latin input passes through romanize');

  // Length cap and trailing-separator cleanup.
  const long = slugifyLatin('a'.repeat(200));
  assert(long.length <= 90, 'slug respects max length');
  assert(!long.endsWith('-'), 'truncation never leaves a trailing separator');

  // Determinism.
  assert(
    slugifyLatin('วิธีสมัคร mobile app') === slugifyLatin('วิธีสมัคร mobile app'),
    'same input → same slug (deterministic)',
  );

  console.log(`\n✅ thai: ${passed} assertions passed`);
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
