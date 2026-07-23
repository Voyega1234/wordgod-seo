/**
 * CPC currency policy for WordGod.
 *
 * All public CPC values are THB. Google Ads values are converted from the
 * account currency only when needed. DataForSEO values are converted from USD.
 */

export const CPC_OUTPUT_CURRENCY = 'THB' as const;

export type CpcRateSource = 'identity' | 'frankfurter';

export interface CpcConversion {
  sourceCurrency: string;
  targetCurrency: typeof CPC_OUTPUT_CURRENCY;
  rate: number; // 1 source-currency unit expressed in the output currency
  rateAsOf: string;
  rateSource: CpcRateSource;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const RATE_TTL_MS = 12 * 60 * 60 * 1000;
const rateCache = new Map<string, { conversion: CpcConversion; fetchedAt: number }>();

export function normalizeCurrencyCode(value: string): string {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error(`Invalid ISO 4217 currency code: ${value || '(empty)'}`);
  }
  return currency;
}

export function convertAmountToCpcCurrency(amount: number, conversion: CpcConversion | null): number {
  if (!conversion || !Number.isFinite(amount) || amount <= 0) return 0;
  const converted = amount * conversion.rate;
  // Keep four decimals internally so low CPC values do not become zero. The UI
  // and workbook can still display two decimals.
  return Math.round(converted * 10_000) / 10_000;
}

export function convertMicrosToCpcCurrency(
  micros: number | string | undefined | null,
  conversion: CpcConversion | null
): number {
  if (!conversion || micros === undefined || micros === null) return 0;
  const numericMicros = Number(micros);
  if (!Number.isFinite(numericMicros) || numericMicros <= 0) return 0;
  return convertAmountToCpcCurrency(numericMicros / 1_000_000, conversion);
}

export async function getCpcConversion(
  sourceCurrencyValue: string,
  fetcher: FetchLike = fetch
): Promise<CpcConversion> {
  const sourceCurrency = normalizeCurrencyCode(sourceCurrencyValue);
  const today = new Date().toISOString().slice(0, 10);

  if (sourceCurrency === CPC_OUTPUT_CURRENCY) {
    return {
      sourceCurrency,
      targetCurrency: CPC_OUTPUT_CURRENCY,
      rate: 1,
      rateAsOf: today,
      rateSource: 'identity',
    };
  }

  const cached = rateCache.get(sourceCurrency);
  if (cached && Date.now() - cached.fetchedAt < RATE_TTL_MS) {
    return cached.conversion;
  }

  const endpoint = `https://api.frankfurter.dev/v2/rate/${encodeURIComponent(sourceCurrency)}/${CPC_OUTPUT_CURRENCY}`;
  const response = await fetcher(endpoint, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`FX provider returned HTTP ${response.status} for ${sourceCurrency}/${CPC_OUTPUT_CURRENCY}`);
  }

  const data = await response.json();
  const base = normalizeCurrencyCode(String(data.base || ''));
  const quote = normalizeCurrencyCode(String(data.quote || ''));
  const rate = Number(data.rate);
  const rateAsOf = String(data.date || '');

  if (base !== sourceCurrency || quote !== CPC_OUTPUT_CURRENCY) {
    throw new Error(`FX provider returned unexpected pair ${base}/${quote}`);
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`FX provider returned invalid ${sourceCurrency}/${CPC_OUTPUT_CURRENCY} rate`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rateAsOf)) {
    throw new Error('FX provider returned an invalid rate date');
  }

  const conversion: CpcConversion = {
    sourceCurrency,
    targetCurrency: CPC_OUTPUT_CURRENCY,
    rate,
    rateAsOf,
    rateSource: 'frankfurter',
  };
  rateCache.set(sourceCurrency, { conversion, fetchedAt: Date.now() });
  return conversion;
}

export function clearCpcConversionCacheForTests(): void {
  rateCache.clear();
}
