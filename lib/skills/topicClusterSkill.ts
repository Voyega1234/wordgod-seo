import { callGemini } from '../gemini';
import type { PipelineKeyword } from '../pipeline/wordgodPipeline';

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
  return slug
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .split(/[\s-]+/)
    .filter(w => w && !SLUG_STOPWORDS.has(w))
    .slice(0, 5)
    .join('-')
    .substring(0, 50);
}

function buildClusterPrompt(keywords: PipelineKeyword[], niche: string): string {
  const rows = keywords.map((k, i) => `${i}|${k.keyword}|${k.volume}|${k.intent}|${k.keyword_type}`).join('\n');
  return `You are a content strategist. Group these ${keywords.length} keywords from the "${niche}" niche into topic clusters for a content sitemap.

Rules:
- Each cluster must have exactly ONE pillar keyword (highest traffic, broadest topic in that group)
- Supporting keywords are related sub-topics or long-tail variations of the pillar
- Aim for 3–12 keywords per cluster
- cluster_name: short English phrase (2–5 words) describing the topic
- pillar_slug: English URL slug for the pillar (translate from Thai to English, lowercase, hyphens, max 4 words, no stopwords). Example: "วีซ่านักเรียน" → "student-visa", "วิธีสมัครวีซ่าท่องเที่ยว" → "tourist-visa-apply"
- Each supporting keyword also needs a slug: English URL slug, max 4 words, no articles/prepositions
- Keyword index numbers are listed as the first column
- Put truly unrelated outliers (index numbers) in "ungrouped" array with their slugs

Input format: index|keyword|volume|intent|keyword_type
${rows}

Return ONLY valid JSON, no markdown:
{
  "clusters": [
    {
      "cluster_name": "...",
      "pillar_index": 0,
      "pillar_slug": "english-slug-here",
      "supporting": [
        { "index": 1, "slug": "english-slug" },
        { "index": 2, "slug": "english-slug" }
      ]
    }
  ],
  "ungrouped": [
    { "index": 5, "slug": "english-slug" }
  ]
}`;
}

export async function clusterKeywords(
  keywords: PipelineKeyword[],
  niche: string,
  onProgress?: (msg: string) => void
): Promise<ClusterResult> {
  onProgress?.('[5/5] Clustering keywords into topic groups...');

  const CHUNK = 200;
  let allClusters: TopicCluster[] = [];
  let allUngrouped: ClusterKeyword[] = [];
  let clusterIdCounter = 1;

  for (let start = 0; start < keywords.length; start += CHUNK) {
    const chunk = keywords.slice(start, start + CHUNK);
    const end = Math.min(start + CHUNK, keywords.length);
    onProgress?.(`[5/5] Clustering keywords ${start + 1}–${end}...`);

    try {
      const prompt = buildClusterPrompt(chunk, niche);
      const raw = await callGemini(prompt);

      const clusters: TopicCluster[] = (raw.clusters || []).map((c: any) => {
        const pillarKw = chunk[c.pillar_index];
        if (!pillarKw) return null;

        const pillar: ClusterKeyword = {
          keyword: pillarKw.keyword,
          title: pillarKw.title,
          volume: pillarKw.volume,
          opportunity_score: pillarKw.opportunity_score,
          priority: pillarKw.priority,
          role: 'pillar',
          slug: sanitizeSlug(c.pillar_slug || pillarKw.keyword),
          aeo_question: pillarKw.aeo_question,
        };

        const supportingMap = new Map<number, string>();
        for (const s of (c.supporting || [])) {
          supportingMap.set(s.index, s.slug || '');
        }

        const supporting: ClusterKeyword[] = Array.from(supportingMap.entries())
          .map(([idx, slug]) => ({ kw: chunk[idx], slug }))
          .filter(({ kw }) => Boolean(kw))
          .map(({ kw, slug }) => ({
            keyword: kw.keyword,
            title: kw.title,
            volume: kw.volume,
            opportunity_score: kw.opportunity_score,
            priority: kw.priority,
            role: 'supporting' as const,
            slug: sanitizeSlug(slug || kw.keyword),
            aeo_question: kw.aeo_question,
          }));

        const total_volume = pillar.volume + supporting.reduce((s, k) => s + k.volume, 0);

        return {
          cluster_id: clusterIdCounter++,
          cluster_name: c.cluster_name || `Cluster ${clusterIdCounter}`,
          pillar,
          supporting,
          total_volume,
        };
      }).filter(Boolean);

      const ungrouped: ClusterKeyword[] = (raw.ungrouped || [])
        .map(({ index, slug }: { index: number; slug: string }) => {
          const k = chunk[index];
          if (!k) return null;
          return {
            keyword: k.keyword,
            title: k.title,
            volume: k.volume,
            opportunity_score: k.opportunity_score,
            priority: k.priority,
            role: 'supporting' as const,
            slug: sanitizeSlug(slug || k.keyword),
            aeo_question: k.aeo_question,
          };
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
