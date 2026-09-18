import { getPool } from './db';
import { absoluteArticleUrl } from '@el/article-path';
import {
  NEWS_SITEMAP_DAYS,
  NEWS_SITEMAP_FALLBACK,
  newsSitemapXml,
  buildUrlset,
  buildSitemapIndex,
  xmlEscape,
  isoDate,
} from '@el/sitemap-news';
import {
  SITEMAP_PAGE_SIZE,
  POSTS_SITEMAP_SQL,
  staticSitemapUrls,
  articleSitemapUrl,
} from '@el/sitemap-urls';

export const SITE = 'https://electronlibre.info';
export { SITEMAP_PAGE_SIZE };
export { NEWS_SITEMAP_DAYS, xmlEscape, isoDate };

export function articleLoc(articleId: number, slug: string): string {
  return absoluteArticleUrl(SITE, articleId, slug);
}

export function xmlResponse(body: string, { maxAge = 300 } = {}): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': `public, max-age=${maxAge}`,
    },
  });
}

/** Pages statiques / hub (hors articles). */
export const STATIC_URLS = staticSitemapUrls(SITE);

export async function countPublishedArticles(): Promise<number> {
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT COUNT(*) AS n FROM el_articles WHERE draft = 0'
  );
  return Number((rows as { n: number }[])[0]?.n || 0);
}

export async function listPublishedArticlesPage(
  page: number
): Promise<
  {
    article_id: number;
    slug: string;
    date: Date;
    modified: Date | null;
    lang: string;
    translation_fr: number | null;
    translation_en: number | null;
    translation_fr_slug: string | null;
    translation_en_slug: string | null;
    translation_fr_draft: number | null;
    translation_en_draft: number | null;
  }[]
> {
  const pool = getPool();
  const p = Math.max(1, Math.floor(page));
  const offset = (p - 1) * SITEMAP_PAGE_SIZE;
  const [rows] = await pool.query(
    `${POSTS_SITEMAP_SQL} LIMIT ? OFFSET ?`,
    [SITEMAP_PAGE_SIZE, offset]
  );
  return rows as {
    article_id: number;
    slug: string;
    date: Date;
    modified: Date | null;
    lang: string;
    translation_fr: number | null;
    translation_en: number | null;
    translation_fr_slug: string | null;
    translation_en_slug: string | null;
    translation_fr_draft: number | null;
    translation_en_draft: number | null;
  }[];
}

export async function listNewsArticles(): Promise<
  { article_id: number; slug: string; title: string; date: Date; lang: string }[]
> {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT article_id, slug, title, date, lang
     FROM el_articles
     WHERE draft = 0
       AND date >= (UTC_TIMESTAMP() - INTERVAL ? DAY)
     ORDER BY date DESC
     LIMIT 1000`,
    [NEWS_SITEMAP_DAYS]
  );
  const recent = rows as {
    article_id: number;
    slug: string;
    title: string;
    date: Date;
    lang: string;
  }[];
  if (recent.length) return recent;
  const [fallback] = await pool.query(
    `SELECT article_id, slug, title, date, lang
     FROM el_articles
     WHERE draft = 0
     ORDER BY date DESC
     LIMIT ?`,
    [NEWS_SITEMAP_FALLBACK]
  );
  return fallback as typeof recent;
}

export { buildUrlset, buildSitemapIndex };

/** Index général — seul fichier à soumettre à Google (hors News). */
export async function buildGeneralSitemapIndexXml(): Promise<string> {
  const total = await countPublishedArticles();
  const pages = Math.max(1, Math.ceil(total / SITEMAP_PAGE_SIZE));
  const locs = [`${SITE}/sitemap-pages.xml`];
  for (let i = 1; i <= pages; i += 1) {
    locs.push(`${SITE}/sitemap-posts-${i}.xml`);
  }
  return buildSitemapIndex(locs);
}

export function buildPagesSitemapXml(): string {
  return buildUrlset(STATIC_URLS);
}

export async function buildPostsSitemapXml(page: number): Promise<string | null> {
  if (!Number.isFinite(page) || page < 1) return null;
  const rows = await listPublishedArticlesPage(page);
  if (!rows.length && page > 1) return null;
  const urls = rows
    .map((r) => articleSitemapUrl(r, SITE))
    .filter((u): u is NonNullable<ReturnType<typeof articleSitemapUrl>> =>
      Boolean(u)
    );
  return buildUrlset(urls);
}

/** Sitemap Google News. */
export async function buildNewsSitemapXml(): Promise<string> {
  const rows = await listNewsArticles();
  return newsSitemapXml(rows, {
    locOf: (row) =>
      articleLoc(Number(row.article_id), String(row.slug || '')),
  });
}
