import { domainMatches, buildRankAnalysis } from './rankValidation';
import type { SerpResultItem } from '../services/dataForSeoService';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function makeSerpResults(): SerpResultItem[] {
  return [
    { position: 1, url: 'https://other-a.com/x', domain: 'other-a.com', title: 'A' },
    { position: 2, url: 'https://other-b.com/x', domain: 'other-b.com', title: 'B' },
    { position: 3, url: 'https://target.com/x', domain: 'target.com', title: 'Target' },
    { position: 4, url: 'https://other-c.com/x', domain: 'other-c.com', title: 'C' },
    { position: 5, url: 'https://other-d.com/x', domain: 'other-d.com', title: 'D' },
    { position: 6, url: 'https://other-e.com/x', domain: 'other-e.com', title: 'E' },
    { position: 7, url: 'https://other-f.com/x', domain: 'other-f.com', title: 'F' },
  ];
}

async function run(): Promise<void> {
  console.log('\n[Rank Validation]');

  // domainMatches
  assert(domainMatches('www.example.com', 'example.com'), 'domainMatches: www. prefix stripped, equal');
  assert(domainMatches('example.com', 'www.example.com'), 'domainMatches: www. prefix stripped (reverse order)');
  assert(domainMatches('blog.example.com', 'example.com'), 'domainMatches: subdomain matches parent domain');
  assert(domainMatches('example.com', 'blog.example.com'), 'domainMatches: parent domain matches subdomain (reverse order)');
  assert(!domainMatches('example.com', 'different.com'), 'domainMatches: mismatch returns false');
  assert(domainMatches('https://www.Example.com/page', 'example.com'), 'domainMatches: case-insensitive with protocol/path');

  // HIGH: siteRank 3, l2 4 (within 3), grounding includes domain
  {
    const serpResults = makeSerpResults();
    const analysis = buildRankAnalysis({
      keyword: 'test keyword',
      serpResults,
      targetDomain: 'target.com',
      rankedKeywordRank: 4,
      groundingDomains: ['other-a.com', 'target.com'],
    });
    assert(analysis.siteRank === 3, 'HIGH case: siteRank is 3');
    assert(analysis.inTop5 === true, 'HIGH case: inTop5 is true');
    assert(analysis.rankConfidence === 'high', 'HIGH case: rankConfidence is high');
    assert(analysis.needsRefetch === false, 'HIGH case: needsRefetch is false');
    assert(analysis.layers.l1Rank === 3, 'HIGH case: layers.l1Rank is 3');
    assert(analysis.layers.l2Rank === 4, 'HIGH case: layers.l2Rank is 4');
    assert(analysis.layers.l3Present === true, 'HIGH case: layers.l3Present is true');
  }

  // MEDIUM: only L1 available (no l2, no grounding)
  {
    const serpResults = makeSerpResults();
    const analysis = buildRankAnalysis({
      keyword: 'test keyword',
      serpResults,
      targetDomain: 'target.com',
    });
    assert(analysis.siteRank === 3, 'MEDIUM case: siteRank is 3');
    assert(analysis.rankConfidence === 'medium', 'MEDIUM case: rankConfidence is medium (only L1)');
    assert(analysis.needsRefetch === false, 'MEDIUM case: needsRefetch is false');
    assert(analysis.layers.l2Rank === null, 'MEDIUM case: layers.l2Rank is null');
    assert(analysis.layers.l3Present === null, 'MEDIUM case: layers.l3Present is null');
  }

  // LOW: contradiction — siteRank 2 but l2 40 and grounding says domain absent
  {
    const serpResults: SerpResultItem[] = [
      { position: 1, url: 'https://other-a.com/x', domain: 'other-a.com', title: 'A' },
      { position: 2, url: 'https://target.com/x', domain: 'target.com', title: 'Target' },
    ];
    const analysis = buildRankAnalysis({
      keyword: 'test keyword',
      serpResults,
      targetDomain: 'target.com',
      rankedKeywordRank: 40,
      groundingDomains: ['other-a.com'],
    });
    assert(analysis.siteRank === 2, 'LOW case: siteRank is 2');
    assert(analysis.rankConfidence === 'low', 'LOW case: rankConfidence is low (contradicting layers)');
    assert(analysis.needsRefetch === true, 'LOW case: needsRefetch is true');
  }

  // not-in-serp: siteRank null, l2 25 (>10), grounding false — both layers agree domain not ranked
  {
    const serpResults: SerpResultItem[] = [
      { position: 1, url: 'https://other-a.com/x', domain: 'other-a.com', title: 'A' },
      { position: 2, url: 'https://other-b.com/x', domain: 'other-b.com', title: 'B' },
    ];
    const analysis = buildRankAnalysis({
      keyword: 'test keyword',
      serpResults,
      targetDomain: 'target.com',
      rankedKeywordRank: 25,
      groundingDomains: ['other-a.com', 'other-b.com'],
    });
    assert(analysis.siteRank === null, 'not-in-serp case: siteRank is null');
    assert(analysis.inTop5 === false, 'not-in-serp case: inTop5 is false');
    assert(analysis.rankConfidence !== 'low', 'not-in-serp case: rankConfidence is not low (layers agree)');
  }

  // top5Competitors: length <= 5, correct order
  {
    const serpResults = makeSerpResults(); // 7 items
    const analysis = buildRankAnalysis({
      keyword: 'test keyword',
      serpResults,
      targetDomain: 'target.com',
    });
    assert(analysis.top5Competitors.length === 5, 'top5Competitors: length is capped at 5');
    assert(
      analysis.top5Competitors.every((c, i) => i === 0 || c.position > analysis.top5Competitors[i - 1].position),
      'top5Competitors: ascending order by position'
    );
    assert(analysis.top5Competitors[0].position === 1, 'top5Competitors: first entry is position 1');
    assert(analysis.top5Competitors[4].position === 5, 'top5Competitors: last entry is position 5');
  }

  console.log('  ✓ Rank Validation test suite passed\n');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
