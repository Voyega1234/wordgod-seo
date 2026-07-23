import { getSerpTop } from './dataForSeoService';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

const mockSerpBody = {
  tasks: [
    {
      result: [
        {
          items: [
            {
              type: 'organic',
              rank_absolute: 2,
              url: 'https://competitor-b.com/page',
              domain: 'competitor-b.com',
              title: 'Competitor B result',
            },
            {
              type: 'organic',
              rank_absolute: 1,
              url: 'https://www.competitor-a.com/page',
              // domain field absent — should be derived from url, www. stripped
              title: 'Competitor A result',
            },
            {
              type: 'featured_snippet',
              rank_absolute: 0,
              url: 'https://example.com/snippet',
              title: 'Should be filtered out (non-organic)',
            },
            {
              type: 'organic',
              rank_absolute: 3,
              url: 'https://competitor-c.com/page',
              domain: 'competitor-c.com',
              title: 'Competitor C result',
            },
          ],
        },
      ],
    },
  ],
};

async function run(): Promise<void> {
  console.log('\n[DataForSEO SERP top]');
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

    const noCredsResult = await getSerpTop('best running shoes');
    assert(noCredsResult.hasCreds === false, 'no-creds: hasCreds is false');
    assert(noCredsResult.results.length === 0, 'no-creds: results array is empty');
    assert(!fetchCalledWithoutCreds, 'no-creds: fetch was not called');

    // Restore creds for remaining tests
    process.env.DATAFORSEO_LOGIN = 'test-login';
    process.env.DATAFORSEO_PASSWORD = 'test-password';

    // (b) happy path with realistic mock body
    let capturedBody: any = null;
    globalThis.fetch = (async (_input: any, init?: any) => {
      capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify(mockSerpBody), { status: 200 });
    }) as unknown as typeof fetch;

    const happyResult = await getSerpTop('best running shoes');
    assert(happyResult.hasCreds === true, 'happy path: hasCreds is true');
    assert(happyResult.results.length === 3, 'happy path: non-organic item filtered out, 3 results returned');

    // sorted ascending by position
    assert(happyResult.results[0].position === 1, 'happy path: first result is position 1');
    assert(happyResult.results[1].position === 2, 'happy path: second result is position 2');
    assert(happyResult.results[2].position === 3, 'happy path: third result is position 3');

    const first = happyResult.results[0];
    assert(first.domain === 'competitor-a.com', 'happy path: domain derived from url and www. stripped');
    assert(first.url === 'https://www.competitor-a.com/page', 'happy path: url parsed correctly');
    assert(first.title === 'Competitor A result', 'happy path: title parsed correctly');

    const second = happyResult.results[1];
    assert(second.domain === 'competitor-b.com', 'happy path: domain field used when present');

    // (c) request body assertion
    assert(capturedBody[0].keyword === 'best running shoes', 'request body: keyword present');
    assert(capturedBody[0].location_code === 2764, 'request body: default location_code is 2764');
    assert(capturedBody[0].language_code === 'th', 'request body: default language_code is th');

    console.log('  ✓ DataForSEO SERP top test suite passed\n');
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
