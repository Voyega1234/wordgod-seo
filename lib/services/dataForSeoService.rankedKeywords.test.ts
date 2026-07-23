import { getRankedKeywordsForDomain } from './dataForSeoService';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

const mockRankedKeywordsBody = {
  tasks: [
    {
      result: [
        {
          items: [
            {
              keyword_data: {
                keyword: 'best running shoes',
                keyword_info: {
                  search_volume: 1200,
                  cpc: 1.35,
                  competition: 'HIGH',
                },
              },
              ranked_serp_element: {
                serp_item: {
                  rank_absolute: 3,
                  rank_group: 3,
                  url: 'https://example.com/best-running-shoes',
                },
              },
            },
            {
              keyword_data: {
                keyword: 'trail running shoes',
                keyword_info: {
                  search_volume: 800,
                  cpc: null,
                  competition: null,
                },
              },
              ranked_serp_element: {
                serp_item: {
                  rank_absolute: 7,
                  rank_group: 7,
                  url: 'https://example.com/trail-running-shoes',
                },
              },
            },
            {
              // malformed: missing keyword entirely
              keyword_data: {
                keyword_info: {
                  search_volume: 500,
                },
              },
              ranked_serp_element: {
                serp_item: {
                  rank_absolute: 10,
                  rank_group: 10,
                },
              },
            },
          ],
        },
      ],
    },
  ],
};

async function run(): Promise<void> {
  console.log('\n[DataForSEO ranked keywords]');
  const originalFetch = globalThis.fetch;
  const originalLogin = process.env.DATAFORSEO_LOGIN;
  const originalPassword = process.env.DATAFORSEO_PASSWORD;

  try {
    // (a) no-creds path: no network call should be made
    delete process.env.DATAFORSEO_LOGIN;
    delete process.env.DATAFORSEO_PASSWORD;
    let fetchCalledWithoutCreds = false;
    globalThis.fetch = (async () => {
      fetchCalledWithoutCreds = true;
      throw new Error('fetch should not be called without creds');
    }) as unknown as typeof fetch;

    const noCredsResult = await getRankedKeywordsForDomain('example.com');
    assert(noCredsResult.hasCreds === false, 'no-creds: hasCreds is false');
    assert(noCredsResult.keywords.length === 0, 'no-creds: keywords array is empty');
    assert(!fetchCalledWithoutCreds, 'no-creds: fetch was not called');

    // Restore creds for remaining tests
    process.env.DATAFORSEO_LOGIN = 'test-login';
    process.env.DATAFORSEO_PASSWORD = 'test-password';

    // (b) happy path with realistic mock body
    let capturedBody: any = null;
    globalThis.fetch = (async (_input: any, init?: any) => {
      capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify(mockRankedKeywordsBody), { status: 200 });
    }) as unknown as typeof fetch;

    const happyResult = await getRankedKeywordsForDomain('example.com');
    assert(happyResult.hasCreds === true, 'happy path: hasCreds is true');
    assert(happyResult.keywords.length === 2, 'happy path: malformed item skipped, 2 keywords returned');

    const first = happyResult.keywords.find(k => k.keyword === 'best running shoes');
    assert(!!first, 'happy path: first keyword found');
    assert(first!.searchVolume === 1200, 'happy path: searchVolume parsed correctly');
    assert(first!.rankAbsolute === 3, 'happy path: rankAbsolute parsed correctly');
    assert(first!.url === 'https://example.com/best-running-shoes', 'happy path: url parsed correctly');
    assert(first!.cpc === 1.35, 'happy path: cpc parsed correctly');
    assert(first!.competition === 'HIGH', 'happy path: competition parsed correctly');

    const second = happyResult.keywords.find(k => k.keyword === 'trail running shoes');
    assert(!!second, 'happy path: second keyword found');
    assert(second!.cpc === null, 'happy path: null cpc coerced to null');
    assert(second!.competition === null, 'happy path: null competition coerced to null');

    // (c) domain normalization
    const normResult = await getRankedKeywordsForDomain('https://www.example.com/blog');
    assert(capturedBody[0].target === 'example.com', 'domain normalization: target used is bare host');
    assert(normResult.domain === 'example.com', 'domain normalization: result.domain is bare host');

    console.log('  ✓ DataForSEO ranked keywords test suite passed\n');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLogin === undefined) delete process.env.DATAFORSEO_LOGIN;
    else process.env.DATAFORSEO_LOGIN = originalLogin;
    if (originalPassword === undefined) delete process.env.DATAFORSEO_PASSWORD;
    else process.env.DATAFORSEO_PASSWORD = originalPassword;
  }
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
