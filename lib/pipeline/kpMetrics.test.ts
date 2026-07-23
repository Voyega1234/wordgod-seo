/**
 * Tests for kpMetrics — pure KP trend derivations.
 * Run: npx ts-node --project tsconfig.test.json lib/pipeline/kpMetrics.test.ts
 */
import {
  textSparkline,
  threeMonthChange,
  volStats,
  formatPercentChange,
  CHANGE_UNAVAILABLE,
} from './kpMetrics';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

console.log('kpMetrics');

// ── textSparkline ──────────────────────────────────────────────────────────
console.log(' textSparkline');
assert(textSparkline([]) === '', 'empty series → empty string');
assert(textSparkline(undefined) === '', 'undefined → empty string');
assert(textSparkline([5, 5, 5]) === '▄▄▄', 'flat series → mid blocks, same length');
{
  const s = textSparkline([0, 100]);
  assert(s.length === 2, 'two points → two glyphs');
  assert(s[0] === '▁' && s[1] === '█', 'min→lowest block, max→highest block');
}
{
  const s = textSparkline([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
  assert(s.length === 12, '12 months → 12 glyphs');
  assert(s[0] === '▁' && s[11] === '█', 'monotonic ramp lowest→highest');
}
assert(textSparkline([3, -1, 4]).length === 2, 'negatives are dropped from the series');

// ── threeMonthChange ───────────────────────────────────────────────────────
console.log(' threeMonthChange');
assert(threeMonthChange([]) === null, 'empty → null');
assert(threeMonthChange([1, 2, 3]) === null, 'fewer than 4 points → null');
assert(threeMonthChange([100, 1, 1, 150]) === 0.5, 'latest vs 3-months-prior = +50%');
assert(threeMonthChange([200, 1, 1, 100]) === -0.5, 'decline = -50%');
assert(threeMonthChange([0, 9, 9, 100]) === null, 'zero base → null (no divide-by-zero)');
{
  // 12-month series: base = index 8 (value 90), latest = 120 → (120-90)/90
  const v = threeMonthChange([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
  assert(v !== null && Math.abs(v - (120 - 90) / 90) < 1e-9, '12-month series uses month[-1] vs month[-4]');
}

// ── volStats ───────────────────────────────────────────────────────────────
console.log(' volStats');
{
  const s = volStats([10, 40, 20, 30]);
  assert(s.low === 10 && s.high === 40, 'low/high correct');
  assert(s.latest === 30, 'latest = last element');
  assert(s.average === 25, 'average rounded');
}
{
  const s = volStats([]);
  assert(s.low === null && s.high === null && s.latest === null && s.average === null, 'empty → all null');
}

// ── formatPercentChange ────────────────────────────────────────────────────
console.log(' formatPercentChange');
assert(formatPercentChange(null) === CHANGE_UNAVAILABLE, 'null → "-"');
assert(formatPercentChange(0.5) === '+50%', '+0.5 → "+50%"');
assert(formatPercentChange(-0.18) === '-18%', '-0.18 → "-18%"');
assert(formatPercentChange(0) === '0%', '0 → "0%"');
assert(CHANGE_UNAVAILABLE === '-', 'unavailable placeholder is a dash');

console.log(`\n✅ kpMetrics: ${passed} assertions passed`);
