import { NextRequest, NextResponse } from 'next/server';
import type { ClusterResult } from '@/lib/skills/topicClusterSkill';

export async function POST(req: NextRequest) {
  const { clusters, ungrouped, mode, domain } = await req.json() as {
    clusters: ClusterResult['clusters'];
    ungrouped: ClusterResult['ungrouped'];
    mode: 'csv' | 'xml';
    domain?: string;
  };

  const baseDomain = (domain || 'https://example.com').replace(/\/$/, '');
  const now = new Date().toISOString().split('T')[0];

  if (mode === 'xml') {
    const urls: string[] = [];

    for (const cluster of clusters) {
      const pillarUrl = `${baseDomain}/${cluster.pillar.slug}/`;
      urls.push(`  <url>
    <loc>${pillarUrl}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.9</priority>
  </url>`);

      for (const kw of cluster.supporting) {
        const url = `${baseDomain}/${cluster.pillar.slug}/${kw.slug}/`;
        urls.push(`  <url>
    <loc>${url}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`);
      }
    }

    for (const kw of ungrouped) {
      urls.push(`  <url>
    <loc>${baseDomain}/${kw.slug}/</loc>
    <lastmod>${now}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>`);
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

    return new NextResponse(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': 'attachment; filename="sitemap.xml"',
      },
    });
  }

  // CSV mode
  const rows: string[] = [
    ['Cluster', 'Cluster Name', 'Role', 'No.', 'Keyword', 'Title (H1)', 'Volume/mo', 'Priority', 'Slug', 'URL', 'AEO Question'].join(','),
  ];

  let articleNo = 1;
  for (const cluster of clusters) {
    const pillarUrl = `${baseDomain}/${cluster.pillar.slug}/`;
    rows.push([
      cluster.cluster_id,
      `"${cluster.cluster_name}"`,
      'PILLAR',
      articleNo++,
      `"${cluster.pillar.keyword}"`,
      `"${cluster.pillar.title}"`,
      cluster.pillar.volume,
      cluster.pillar.priority.toUpperCase(),
      cluster.pillar.slug,
      pillarUrl,
      `"${cluster.pillar.aeo_question || ''}"`,
    ].join(','));

    for (const kw of cluster.supporting) {
      const url = `${baseDomain}/${cluster.pillar.slug}/${kw.slug}/`;
      rows.push([
        cluster.cluster_id,
        `"${cluster.cluster_name}"`,
        'supporting',
        articleNo++,
        `"${kw.keyword}"`,
        `"${kw.title}"`,
        kw.volume,
        kw.priority,
        kw.slug,
        url,
        `"${kw.aeo_question || ''}"`,
      ].join(','));
    }
  }

  for (const kw of ungrouped) {
    rows.push([
      '',
      '"Ungrouped"',
      'standalone',
      articleNo++,
      `"${kw.keyword}"`,
      `"${kw.title}"`,
      kw.volume,
      kw.priority,
      kw.slug,
      `${baseDomain}/${kw.slug}/`,
      `"${kw.aeo_question || ''}"`,
    ].join(','));
  }

  const csv = '﻿' + rows.join('\n');
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="wordgod-sitemap.csv"',
    },
  });
}
