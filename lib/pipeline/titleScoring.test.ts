/**
 * Tests for titleScoring — deterministic title quality checks.
 * Run: npx ts-node --project tsconfig.test.json lib/pipeline/titleScoring.test.ts
 */
import { scoreTitle } from './titleScoring';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

function main(): void {
  console.log('titleScoring');

  // A solid, on-length, keyword-bearing Thai title scores high and is valid.
  const good = scoreTitle(
    'เจาะลึกสินเชื่อบ้านสำหรับมนุษย์เงินเดือน เลือกอย่างไรให้คุ้มที่สุดในปีนี้',
    'สินเชื่อบ้าน',
  );
  assert(good.valid, 'good title is valid');
  assert(good.score >= 85, 'good title scores high');

  // Missing keyword → invalid + capped low.
  const noKw = scoreTitle('เทคนิคการออมเงินที่ทุกคนควรรู้ก่อนวางแผนการเงินระยะยาว', 'สินเชื่อบ้าน');
  assert(!noKw.valid, 'missing keyword → invalid');
  assert(noKw.score <= 40, 'missing keyword → capped low score');
  assert(noKw.issues.some(i => i.includes('keyword')), 'flags missing keyword');

  // Forbidden phrase → invalid.
  const forbidden = scoreTitle('สินเชื่อบ้าน ดอกเบี้ยต่ำ การันตี อนุมัติไว', 'สินเชื่อบ้าน');
  assert(!forbidden.valid, 'forbidden phrase → invalid');
  assert(forbidden.issues.some(i => i.includes('คำต้องห้าม')), 'flags forbidden phrase');

  // Banned platform → invalid.
  const platform = scoreTitle('รีวิวสินเชื่อบ้านจาก pantip ที่คนพูดถึงมากที่สุด', 'สินเชื่อบ้าน');
  assert(!platform.valid, 'banned platform → invalid');

  // Generic fallback opener → penalised but still valid.
  const generic = scoreTitle('สินเชื่อบ้าน คืออะไร? รวมข้อควรรู้ที่ควรเข้าใจก่อนเริ่มใช้บริการ', 'สินเชื่อบ้าน');
  assert(generic.valid, 'generic-opener title still valid (keyword + length ok)');
  assert(generic.issues.some(i => i.includes('รูปแบบซ้ำ')), 'flags the overused opener');
  assert(generic.score < good.score, 'generic opener scores below a fresh title');

  // Too short → length penalty + invalid when far below floor.
  const short = scoreTitle('สินเชื่อบ้าน', 'สินเชื่อบ้าน');
  assert(short.issues.some(i => i.includes('สั้น')), 'flags short title');
  assert(short.score < good.score, 'short title scores lower');

  // Keyword stuffing → penalised.
  const stuffed = scoreTitle('สินเชื่อบ้าน สินเชื่อบ้าน สินเชื่อบ้าน ดอกเบี้ยเท่าไหร่ต้องรู้', 'สินเชื่อบ้าน');
  assert(stuffed.issues.some(i => i.includes('ซ้ำมากเกินไป')), 'flags keyword stuffing');

  // English keyword: any word token match counts.
  const eng = scoreTitle('Complete home loan guide for first-time buyers in 2025 and beyond', 'home loan');
  assert(eng.valid, 'english title with keyword token is valid');

  // Intent alignment: a comparison title with a comparison cue is not penalised;
  // one without a cue takes a small soft penalty and is flagged.
  const cmpAligned = scoreTitle('เปรียบเทียบสินเชื่อบ้านแต่ละธนาคาร แบบไหนเหมาะกับคุณมากที่สุด', 'สินเชื่อบ้าน', 'comparison');
  const cmpMisaligned = scoreTitle('เจาะลึกสินเชื่อบ้าน เลือกอย่างไรให้เหมาะกับรายได้ของคุณในระยะยาว', 'สินเชื่อบ้าน', 'comparison');
  assert(!cmpAligned.issues.some(i => i.includes('intent')), 'comparison title with cue → no intent flag');
  assert(cmpMisaligned.issues.some(i => i.includes('intent')), 'comparison title without cue → intent flag');
  assert(cmpMisaligned.score < cmpAligned.score, 'intent-misaligned title scores lower');

  // informational intent is never penalised for lacking a marker word.
  const info = scoreTitle('เจาะลึกสินเชื่อบ้าน เลือกอย่างไรให้เหมาะกับรายได้ของคุณในระยะยาว', 'สินเชื่อบ้าน', 'informational');
  assert(!info.issues.some(i => i.includes('intent')), 'informational intent → no intent penalty');

  // Empty title → 0 / invalid.
  const empty = scoreTitle('', 'สินเชื่อบ้าน');
  assert(!empty.valid && empty.score === 0, 'empty title → invalid, score 0');

  // Determinism.
  const a = scoreTitle('เจาะลึกสินเชื่อบ้าน เลือกอย่างไรให้เหมาะกับรายได้ของคุณในระยะยาว', 'สินเชื่อบ้าน');
  const b = scoreTitle('เจาะลึกสินเชื่อบ้าน เลือกอย่างไรให้เหมาะกับรายได้ของคุณในระยะยาว', 'สินเชื่อบ้าน');
  assert(a.score === b.score && a.valid === b.valid, 'same input → same output (deterministic)');

  console.log(`\n✅ titleScoring: ${passed} assertions passed`);
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
