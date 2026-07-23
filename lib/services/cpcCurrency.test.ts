import {
  CPC_OUTPUT_CURRENCY,
  clearCpcConversionCacheForTests,
  convertAmountToCpcCurrency,
  convertMicrosToCpcCurrency,
  getCpcConversion,
  normalizeCurrencyCode,
} from './cpcCurrency';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

async function run(): Promise<void> {
  console.log('\n[CPC currency policy]');
  clearCpcConversionCacheForTests();

  assert(CPC_OUTPUT_CURRENCY === 'THB', 'ล็อกสกุลเงินปลายทางเป็น THB');
  assert(normalizeCurrencyCode(' thb ') === 'THB', 'ปรับ ISO currency code เป็นตัวพิมพ์ใหญ่');

  const identity = await getCpcConversion('THB');
  assert(identity.rate === 1 && identity.rateSource === 'identity', 'THB ไม่ถูกแปลงซ้ำ');

  let requestedUrl = '';
  const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({
      date: '2026-07-22',
      base: 'USD',
      quote: 'THB',
      rate: 32.75,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const usd = await getCpcConversion('USD', fakeFetch);
  assert(requestedUrl.endsWith('/USD/THB'), 'เรียกอัตรา USD ต่อ THB ที่ถูกคู่');
  assert(usd.targetCurrency === 'THB' && usd.rateAsOf === '2026-07-22', 'เก็บปลายทางและวันที่อัตราแลกเปลี่ยน');
  assert(convertAmountToCpcCurrency(2, usd) === 65.5, 'แปลงจำนวนเงินจาก USD เป็น THB');
  assert(convertMicrosToCpcCurrency(25_000_000, usd) === 818.75, 'แปลง Google Ads micros เป็น THB');
  assert(convertMicrosToCpcCurrency(25_000_000, null) === 0, 'ไม่มี FX rate ต้องไม่ปล่อย CPC สกุลเดิม');

  let rejected = false;
  try {
    normalizeCurrencyCode('US dollars');
  } catch {
    rejected = true;
  }
  assert(rejected, 'ปฏิเสธ currency code ที่ไม่ใช่ ISO 4217');

  console.log('  ✓ CPC currency policy test suite passed\n');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
