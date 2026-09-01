import { getPool } from './db';
import { absoluteArticleUrl } from '@el/article-path';
import {
  NEWS_SITEMAP_DAYS,
  NEWS_SITEMAP_FALLBACK,
  newsSitemapXml,
  xmlEscape,
  isoDate,
} from '@el/sitemap-news';

export const SITE = 'https://electronlibre.info';
/** Chunks ~2000 URLs (limite pratique Google / WP). */
export const SITEMAP_PAGE_SIZE = 2000;
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
export const STATIC_URLS: {
  loc: string;
  changefreq?: string;
  priority?: string;
}[] = [
  { loc: `${SITE}/`, changefreq: 'hourly', priority: '1.0' },
  { loc: `${SITE}/en/`, changefreq: 'hourly', priority: '0.9' },
  { loc: `${SITE}/abonnement/`, changefreq: 'monthly', priority: '0.6' },
  { loc: `${SITE}/a-propos/`, changefreq: 'yearly', priority: '0.3' },
  { loc: `${SITE}/mentions-legales/`, changefreq: 'yearly', priority: '0.2' },
  { loc: `${SITE}/search/`, changefreq: 'monthly', priority: '0.4' },
];

export async function countPublishedArticles(): Promise<number> {
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT COUNT(*) AS n FROM el_articles WHERE draft = 0'
  );
  return Number((rows as { n: number }[])[0]?.n || 0);
}

export async function listPublishedArticlesPage(
  page: number
): Promise<{ article_id: number; slug: string; date: Date; modified: Date | null }[]> {
  const pool = getPool();
  const p = Math.max(1, Math.floor(page));
  const offset = (p - 1) * SITEMAP_PAGE_SIZE;
  const [rows] = await pool.query(
    `SELECT article_id, slug, date, modified
     FROM el_articles
     WHERE draft = 0
     ORDER BY date DESC, article_id DESC
     LIMIT ? OFFSET ?`,
    [SITEMAP_PAGE_SIZE, offset]
  );
  return rows as {
    article_id: number;
    slug: string;
    date: Date;
    modified: Date | null;
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

export function buildSitemapIndex(locs: string[]): string {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml +=
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  for (const loc of locs) {
    xml += '  <sitemap>\n';
    xml += `    <loc>${xmlEscape(loc)}</loc>\n`;
    xml += '  </sitemap>\n';
  }
  xml += '</sitemapindex>\n';
  return xml;
}

export function buildUrlset(
  urls: {
    loc: string;
    lastmod?: string;
    changefreq?: string;
    priority?: string;
  }[]
): string {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  for (const u of urls) {
    if (!u.loc) continue;
    xml += '  <url>\n';
    xml += `    <loc>${xmlEscape(u.loc)}</loc>\n`;
    if (u.lastmod) xml += `    <lastmod>${xmlEscape(u.lastmod)}</lastmod>\n`;
    if (u.changefreq)
      xml += `    <changefreq>${xmlEscape(u.changefreq)}</changefreq>\n`;
    if (u.priority) xml += `    <priority>${xmlEscape(u.priority)}</priority>\n`;
    xml += '  </url>\n';
  }
  xml += '</urlset>\n';
  return xml;
}

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
    .map((r) => {
      const loc = articleLoc(Number(r.article_id), String(r.slug));
      if (!loc) return null;
      return {
        loc,
        lastmod: isoDate(r.modified || r.date),
      };
    })
    .filter((u): u is { loc: string; lastmod: string } => Boolean(u));
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
