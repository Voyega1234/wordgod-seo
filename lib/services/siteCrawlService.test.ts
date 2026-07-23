import { crawlSiteDeep, type FetchLike } from './siteCrawlService';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html' } });
}

function xmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'application/xml' } });
}

function notFoundResponse(): Response {
  return new Response('Not Found', { status: 404 });
}

const RICH_HTML = `<!doctype html>
<html><head><title>Great Article | Example</title>
<meta name="description" content="A great article about things.">
<script type="application/ld+json">{"@type":"Article"}</script>
</head>
<body>
<div class="author-box" itemprop="author">By Jane Doe</div>
<time itemprop="datePublished" datetime="2026-01-01">January 1, 2026</time>
<h1>Great Article Heading</h1>
<h2>Section One</h2>
<h2>Section Two</h2>
<p>${'This is a well written and lengthy paragraph about the topic at hand. '.repeat(40)}</p>
<footer>Contact us: mailto:hello@example.com</footer>
</body></html>`;

const THIN_HTML = `<!doctype html>
<html><head><title>Thin Page</title></head>
<body><p>Just a little bit of text here, nothing more.</p></body></html>`;

async function testSitemapDiscovery(): Promise<void> {
  console.log('\n[Sitemap discovery]');

  const sitemapXml = `<?xml version="1.0"?>
<urlset>
  <url><loc>https://example.com/page-1</loc></url>
  <url><loc>https://example.com/page-2</loc></url>
</urlset>`;

  const fetcher: FetchLike = async (input) => {
    const url = String(input);
    if (url === 'https://example.com/sitemap.xml') return xmlResponse(sitemapXml);
    if (url === 'https://example.com/page-1') return htmlResponse(RICH_HTML);
    if (url === 'https://example.com/page-2') return htmlResponse(THIN_HTML);
    return notFoundResponse();
  };

  const result = await crawlSiteDeep('https://example.com', {}, fetcher);

  assert(result.sitemapFound === true, 'sitemap พบและถูกใช้เป็นแหล่งค้นพบ URL');
  assert(result.coverage.source === 'sitemap', 'coverage.source เป็น sitemap');
  assert(result.pages.length === 2, 'พบ 2 หน้าจาก sitemap');
  assert(result.coverage.discovered === 2 && result.coverage.fetched === 2, 'coverage นับหน้าที่พบและดึงข้อมูลสำเร็จถูกต้อง');
}

async function testBfsFallback(): Promise<void> {
  console.log('\n[BFS fallback when no sitemap]');

  const homeHtml = `<!doctype html><html><head><title>Home</title></head>
  <body>
    <a href="https://example.com/about">About</a>
    <a href="https://example.com/contact">Contact</a>
    <a href="https://other-domain.com/external">External</a>
  </body></html>`;

  const fetcher: FetchLike = async (input) => {
    const url = String(input);
    if (url === 'https://example.com/sitemap.xml') return notFoundResponse();
    if (url === 'https://example.com') return htmlResponse(homeHtml);
    if (url === 'https://example.com/about') return htmlResponse(RICH_HTML);
    if (url === 'https://example.com/contact') return htmlResponse(THIN_HTML);
    return notFoundResponse();
  };

  const result = await crawlSiteDeep('https://example.com', {}, fetcher);

  assert(result.sitemapFound === false, 'ไม่มี sitemap');
  assert(result.coverage.source === 'bfs', 'coverage.source เป็น bfs');
  assert(result.pages.some(p => p.url === 'https://example.com'), 'พบหน้า home');
  assert(result.pages.some(p => p.url === 'https://example.com/about'), 'พบหน้า about ผ่านลิงก์');
  assert(!result.pages.some(p => p.url.includes('other-domain.com')), 'ไม่ crawl ข้าม origin');
}

async function testMaxPagesCap(): Promise<void> {
  console.log('\n[maxPages cap]');

  const sitemapXml = `<?xml version="1.0"?>
<urlset>
${Array.from({ length: 10 }, (_, i) => `  <url><loc>https://example.com/page-${i}</loc></url>`).join('\n')}
</urlset>`;

  const fetcher: FetchLike = async (input) => {
    const url = String(input);
    if (url === 'https://example.com/sitemap.xml') return xmlResponse(sitemapXml);
    if (/^https:\/\/example\.com\/page-\d+$/.test(url)) return htmlResponse(RICH_HTML);
    return notFoundResponse();
  };

  const result = await crawlSiteDeep('https://example.com', { maxPages: 3 }, fetcher);

  assert(result.pages.length === 3, 'จำกัดจำนวนหน้าตาม maxPages');
  assert(result.coverage.capped === true, 'coverage.capped เป็น true');
  assert(result.coverage.capReason === 'pages', 'coverage.capReason เป็น pages');
}

async function testEeatDetection(): Promise<void> {
  console.log('\n[EEAT rule-based detection]');

  const sitemapXml = `<?xml version="1.0"?>
<urlset>
  <url><loc>https://example.com/rich</loc></url>
  <url><loc>https://example.com/thin</loc></url>
</urlset>`;

  const fetcher: FetchLike = async (input) => {
    const url = String(input);
    if (url === 'https://example.com/sitemap.xml') return xmlResponse(sitemapXml);
    if (url === 'https://example.com/rich') return htmlResponse(RICH_HTML);
    if (url === 'https://example.com/thin') return htmlResponse(THIN_HTML);
    return notFoundResponse();
  };

  const result = await crawlSiteDeep('https://example.com', {}, fetcher);
  const richPage = result.pages.find(p => p.url === 'https://example.com/rich');
  const thinPage = result.pages.find(p => p.url === 'https://example.com/thin');

  assert(!!richPage, 'พบหน้าเนื้อหาสมบูรณ์');
  assert(richPage!.eeat.hasAuthorByline === true, 'ตรวจพบ author byline');
  assert(richPage!.eeat.hasPublishDate === true, 'ตรวจพบ publish date');
  assert(richPage!.eeat.hasStructuredData === true, 'ตรวจพบ structured data (ld+json)');
  assert(richPage!.eeat.hasContactInfo === true, 'ตรวจพบข้อมูลติดต่อ');

  assert(!!thinPage, 'พบหน้าเนื้อหาบาง');
  assert(thinPage!.missingSignals.includes('author'), 'missingSignals มี author สำหรับหน้าเนื้อหาบาง');
  assert(thinPage!.missingSignals.includes('thinContent'), 'missingSignals มี thinContent สำหรับหน้าเนื้อหาบาง');

  assert(result.eeatSummary.totalPages === 2, 'eeatSummary.totalPages ถูกต้อง');
  assert(result.eeatSummary.pagesThinContent >= 1, 'eeatSummary.pagesThinContent นับหน้าเนื้อหาบาง');
}

async function run(): Promise<void> {
  console.log('\n[Deep site crawl + EEAT signals]');

  await testSitemapDiscovery();
  await testBfsFallback();
  await testMaxPagesCap();
  await testEeatDetection();

  console.log('  ✓ Deep site crawl test suite passed\n');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
