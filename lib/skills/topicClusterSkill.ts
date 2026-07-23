import { callGemini } from '../gemini';
import type { PipelineKeyword } from '../pipeline/wordgodPipeline';
import { segmentWords } from '../text/thai';

export interface ClusterKeyword {
  keyword: string;
  title: string;
  volume: number;
  opportunity_score: number;
  priority: string;
  role: 'pillar' | 'supporting';
  slug: string;
  aeo_question: string;
}

export interface TopicCluster {
  cluster_id: number;
  cluster_name: string;
  pillar: ClusterKeyword;
  supporting: ClusterKeyword[];
  total_volume: number;
}

export interface ClusterResult {
  clusters: TopicCluster[];
  ungrouped: ClusterKeyword[];
}

const SLUG_STOPWORDS = new Set([
  'a','an','the','and','or','of','in','on','at','to','for','with','is','are','was','were','be','been',
  'how','what','why','when','where','which','who',
]);

function sanitizeSlug(slug: string): string {
  return segmentWords(slug.toLowerCase().trim(), /[\u0E00-\u0E7F]/.test(slug) ? 'th' : 'en')
    .filter(w => w && !SLUG_STOPWORDS.has(w))
    .slice(0, 5)
    .join('-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .substring(0, 50);
}

function buildClusterPrompt(keywords: PipelineKeyword[], niche: string, targetGroups: number): string {
  const rows = keywords.map((k, i) => `${i}|${k.keyword}|${k.volume}|${k.intent}`).join('\n');
  // Extract sub-topic hints from high-volume keywords to guide clustering
  const topKws = [...keywords].sort((a, b) => b.volume - a.volume).slice(0, 10).map(k => k.keyword);
  return `Group ${keywords.length} "${niche}" keywords into ${targetGroups}–${Math.round(targetGroups * 1.4)} specific topic clusters.

Sub-topic hints (use these to define cluster boundaries): ${topKws.join(' | ')}

Rules:
- Split into SPECIFIC sub-topics, not broad intent buckets
- Each cluster = one pillar (broadest/highest-volume) + tightly related supporting keywords
- Aim for ${targetGroups}–${Math.round(targetGroups * 1.4)} clusters — prefer more smaller clusters over few large ones
- pillar_slug and supporting slugs: English, lowercase, hyphens, max 4 words

Format: index|keyword|volume|intent
${rows}

Return JSON only:
{"clusters":[{"name":"...","pillar":0,"slug":"english-slug","supporting":[{"i":1,"slug":"slug"}]}],"ungrouped":[{"i":5,"slug":"slug"}]}`;
}

function buildClusterKeyword(kw: PipelineKeyword, slug: string, role: 'pillar' | 'supporting'): ClusterKeyword {
  return {
    keyword: kw.keyword,
    title: kw.title,
    volume: kw.volume,
    opportunity_score: kw.opportunity_score,
    priority: kw.priority,
    role,
    slug: sanitizeSlug(slug || kw.keyword),
    aeo_question: kw.aeo_question,
  };
}

export async function clusterKeywords(
  keywords: PipelineKeyword[],
  niche: string,
  onProgress?: (msg: string) => void
): Promise<ClusterResult> {
  onProgress?.('[5/5] Clustering keywords into topic groups...');

  // Dynamic chunk size: small runs stay in one pass, large runs use bigger chunks
  // to keep context coherent and reduce number of Gemini calls
  const CHUNK = keywords.length <= 200 ? 200 : keywords.length <= 1000 ? 300 : 500;
  let allClusters: TopicCluster[] = [];
  let allUngrouped: ClusterKeyword[] = [];
  let clusterIdCounter = 1;

  for (let start = 0; start < keywords.length; start += CHUNK) {
    const chunk = keywords.slice(start, start + CHUNK);
    const end = Math.min(start + CHUNK, keywords.length);
    onProgress?.(`[5/5] Clustering keywords ${start + 1}–${end}...`);

    // Target ~1 cluster per 5 keywords, minimum 5, maximum 40 per chunk
    const targetGroups = Math.min(40, Math.max(5, Math.round(chunk.length / 5)));

    try {
      const raw = await callGemini(buildClusterPrompt(chunk, niche, targetGroups), {
        functionLabel: 'topic_clustering',
      });

      const clusters: TopicCluster[] = (raw.clusters || []).map((c: any) => {
        const pillarKw = chunk[c.pillar];
        if (!pillarKw) return null;
        const pillar = buildClusterKeyword(pillarKw, c.slug, 'pillar');
        const supporting: ClusterKeyword[] = (c.supporting || [])
          .map(({ i, slug }: { i: number; slug: string }) => {
            const kw = chunk[i];
            return kw ? buildClusterKeyword(kw, slug, 'supporting') : null;
          })
          .filter(Boolean);
        return {
          cluster_id: clusterIdCounter++,
          cluster_name: c.name || `Cluster ${clusterIdCounter}`,
          pillar,
          supporting,
          total_volume: pillar.volume + supporting.reduce((s: number, k: ClusterKeyword) => s + k.volume, 0),
        };
      }).filter(Boolean);

      const ungrouped: ClusterKeyword[] = (raw.ungrouped || [])
        .map(({ i, slug }: { i: number; slug: string }) => {
          const kw = chunk[i];
          return kw ? buildClusterKeyword(kw, slug, 'supporting') : null;
        })
        .filter(Boolean);

      allClusters = allClusters.concat(clusters);
      allUngrouped = allUngrouped.concat(ungrouped);
    } catch (err: any) {
      onProgress?.(`[5/5] Cluster chunk error: ${err.message}`);
    }
  }

  allClusters.sort((a, b) => b.total_volume - a.total_volume);
  onProgress?.(`[5/5] Clustered into ${allClusters.length} topic groups`);
  return { clusters: allClusters, ungrouped: allUngrouped };
}
