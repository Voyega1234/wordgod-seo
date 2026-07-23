/**
 * WordGod — Keyword Planner trend metrics (pure, deterministic)
 *
 * Derives presentation values from the KP trailing ~12-month monthly search
 * series (`monthly_trend`, oldest→newest). No network, no LLM, no randomness.
 *
 * Honesty rule:
 * - "Three month change" is the KP definition (most-recent month vs 3 months
 *   prior) and IS computable from the 12-month array. When the series is too
 *   short (or the base month is 0) we render `CHANGE_UNAVAILABLE` ("-") rather
 *   than fabricate a number.
 * (YoY change is intentionally NOT produced: the API returns only ~12 months,
 *  so a true year-over-year value is not available and the column is omitted.)
 */

const SPARK_BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/** Placeholder shown when a change value cannot be computed from the series. */
export const CHANGE_UNAVAILABLE = '-';

function cleanSeries(trend: number[] | undefined | null): number[] {
  if (!Array.isArray(trend)) return [];
  return trend.filter((v) => typeof v === 'number' && isFinite(v) && v >= 0);
}

/**
 * Unicode block sparkline (▁▂▃▄▅▆▇█) of the monthly series, min–max normalized.
 * Empty series → ''. A flat series → all mid-blocks.
 */
export function textSparkline(trend: number[] | undefined | null): string {
  const s = cleanSeries(trend);
  if (s.length === 0) return '';
  const min = Math.min(...s);
  const max = Math.max(...s);
  if (max === min) return SPARK_BLOCKS[3].repeat(s.length); // flat line
  const span = max - min;
  return s
    .map((v) => {
      const idx = Math.round(((v - min) / span) * (SPARK_BLOCKS.length - 1));
      return SPARK_BLOCKS[Math.min(SPARK_BLOCKS.length - 1, Math.max(0, idx))];
    })
    .join('');
}

/**
 * KP "Three month change": most-recent month vs 3 months prior, as a fraction
 * (0.5 = +50%). Returns null when there is not enough data or the base is 0.
 */
export function threeMonthChange(trend: number[] | undefined | null): number | null {
  const s = cleanSeries(trend);
  if (s.length < 4) return null;
  const latest = s[s.length - 1];
  const base = s[s.length - 4];
  if (base <= 0) return null;
  return (latest - base) / base;
}

export interface VolStats {
  low: number | null;
  high: number | null;
  latest: number | null;
  average: number | null;
}

/** Low / high / latest / average of the monthly series (null when empty). */
export function volStats(trend: number[] | undefined | null): VolStats {
  const s = cleanSeries(trend);
  if (s.length === 0) return { low: null, high: null, latest: null, average: null };
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    low: Math.min(...s),
    high: Math.max(...s),
    latest: s[s.length - 1],
    average: Math.round(sum / s.length),
  };
}

/**
 * Format a fractional change (0.5 → "+50%", -0.18 → "-18%", 0 → "0%").
 * null → CHANGE_UNAVAILABLE ("-").
 */
export function formatPercentChange(fraction: number | null): string {
  if (fraction === null || !isFinite(fraction)) return CHANGE_UNAVAILABLE;
  const pct = Math.round(fraction * 100);
  if (pct > 0) return `+${pct}%`;
  return `${pct}%`; // 0 → "0%", negatives already carry "-"
}
