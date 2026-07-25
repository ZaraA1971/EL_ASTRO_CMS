import { getPool, parseJsonArray } from './db';

export type ArticleData = {
  wp_id: number;
  title: string;
  slug: string;
  date: Date;
  modified?: Date;
  author: string;
  author_slug?: string;
  categories: string[];
  category_names: string[];
  tags: string[];
  ia_keywords: string[];
  translation_fr?: number;
  translation_en?: number;
  access: 'granted' | 'subscribers';
  lang: string;
  source_url?: string;
  excerpt: string;
  draft: boolean;
};

export type Article = {
  id: string;
  data: ArticleData;
  body: string;
};

/** Colonnes liste / cartes — jamais le LONGTEXT body */
export const ARTICLE_LIST_COLUMNS = `
  wp_id, slug, title, excerpt, date, modified, author, author_slug,
  categories, category_names, tags, ia_keywords,
  translation_fr, translation_en, access, lang, source_url, draft
`.replace(/\s+/g, ' ').trim();

function rowToArticle(
  row: Record<string, unknown>,
  { includeBody = true }: { includeBody?: boolean } = {}
): Article {
  const date = row.date instanceof Date ? row.date : new Date(String(row.date));
  const modified = row.modified
    ? row.modified instanceof Date
      ? row.modified
      : new Date(String(row.modified))
    : undefined;
  return {
    id: `db-${row.wp_id}`,
    data: {
      wp_id: Number(row.wp_id),
      title: String(row.title),
      slug: String(row.slug),
      date,
      modified,
      author: String(row.author || 'ElectronLibre'),
      author_slug: row.author_slug ? String(row.author_slug) : undefined,
      categories: parseJsonArray(row.categories),
      category_names: parseJsonArray(row.category_names),
      tags: parseJsonArray(row.tags),
      ia_keywords: parseJsonArray(row.ia_keywords),
      translation_fr:
        row.translation_fr != null ? Number(row.translation_fr) : undefined,
      translation_en:
        row.translation_en != null ? Number(row.translation_en) : undefined,
      access: row.access === 'granted' ? 'granted' : 'subscribers',
      lang: String(row.lang || 'fr').toLowerCase(),
      source_url: row.source_url ? String(row.source_url) : undefined,
      excerpt: String(row.excerpt || ''),
      draft: Boolean(row.draft),
    },
    body: includeBody ? String(row.body || '') : '',
  };
}

/** id URL segment: `{wp_id}-{slug}` */
export function articlePath(article: Article): string {
  const { wp_id, slug } = article.data;
  return `/articles/${wp_id}-${slug}/`;
}

export function articleIdSlug(article: Article): string {
  return `${article.data.wp_id}-${article.data.slug}`;
}

export type LangCode = 'fr' | 'en';

export type ListOpts = {
  /** Inclure body (défaut false — listes / archives). */
  includeBody?: boolean;
  limit?: number;
  offset?: number;
};

/** Articles publiés, tri date desc. Sans body par défaut. */
export async function getPublishedArticles(
  lang: LangCode | 'all' = 'fr',
  opts: ListOpts = {}
): Promise<Article[]> {
  const pool = getPool();
  const includeBody = Boolean(opts.includeBody);
  const cols = includeBody ? '*' : ARTICLE_LIST_COLUMNS;
  const params: unknown[] = [];
  let sql = `SELECT ${cols} FROM el_articles WHERE draft = 0`;
  if (lang !== 'all') {
    sql += ` AND lang = ?`;
    params.push(lang);
  }
  sql += ` ORDER BY date DESC`;
  if (opts.limit != null) {
    sql += ` LIMIT ?`;
    params.push(Math.max(1, Number(opts.limit)));
    if (opts.offset != null) {
      sql += ` OFFSET ?`;
      params.push(Math.max(0, Number(opts.offset)));
    }
  }
  const [rows] = await pool.query(sql, params);
  return (rows as Record<string, unknown>[]).map((r) =>
    rowToArticle(r, { includeBody })
  );
}

export async function countPublishedArticles(
  lang: LangCode | 'all' = 'fr'
): Promise<number> {
  const pool = getPool();
  const params: unknown[] = [];
  let sql = `SELECT COUNT(*) AS n FROM el_articles WHERE draft = 0`;
  if (lang !== 'all') {
    sql += ` AND lang = ?`;
    params.push(lang);
  }
  const [rows] = await pool.query(sql, params);
  return Number((rows as { n: number }[])[0]?.n || 0);
}

export async function getArticleByIdSlug(idSlug: string): Promise<Article | null> {
  const m = /^(\d+)-(.+)$/.exec(String(idSlug || ''));
  if (!m) return null;
  const wpId = Number(m[1]);
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT * FROM el_articles WHERE wp_id = ? AND draft = 0 LIMIT 1`,
    [wpId]
  );
  const row = (rows as Record<string, unknown>[])[0];
  if (!row) return null;
  return rowToArticle(row, { includeBody: true });
}

export async function getArticlesByIds(ids: number[]): Promise<Article[]> {
  const uniq = [...new Set(ids.map(Number).filter((n) => n > 0))];
  if (!uniq.length) return [];
  const pool = getPool();
  const placeholders = uniq.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT ${ARTICLE_LIST_COLUMNS} FROM el_articles
     WHERE draft = 0 AND wp_id IN (${placeholders})`,
    uniq
  );
  return (rows as Record<string, unknown>[]).map((r) =>
    rowToArticle(r, { includeBody: false })
  );
}

export function isFreeArticle(article: Article): boolean {
  return article.data.access === 'granted';
}

export function formatArchiveDate(date: Date): string {
  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function humanizeTag(slug: string): string {
  return String(slug || '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function tagPath(slug: string): string {
  return `/articles/tag/${encodeURIComponent(String(slug || '').trim())}/`;
}

export function trimExcerpt(text: string, words = 28): string {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';
  const parts = clean.split(' ');
  if (parts.length <= words) return clean;
  return parts.slice(0, words).join(' ') + '…';
}

/** URLs FR/EN via requêtes ciblées (pas de full scan). */
export async function getTranslationUrls(
  article: Article
): Promise<Partial<Record<'FR' | 'EN', string>>> {
  const ids = [
    article.data.translation_fr,
    article.data.translation_en,
  ].filter((n): n is number => n != null && n > 0);
  if (!ids.length) return {};
  const found = await getArticlesByIds(ids);
  const byId = new Map(found.map((a) => [a.data.wp_id, a]));
  const urls: Partial<Record<'FR' | 'EN', string>> = {};
  const frId = article.data.translation_fr;
  const enId = article.data.translation_en;
  if (frId && byId.has(frId)) urls.FR = articlePath(byId.get(frId)!);
  if (enId && byId.has(enId)) urls.EN = articlePath(byId.get(enId)!);
  return urls;
}

/**
 * Related : même langue + overlap de rubriques, sans charger tout le corpus.
 */
export async function getRelatedArticles(
  article: Article,
  limit = 3
): Promise<Article[]> {
  const pool = getPool();
  const lang = (article.data.lang || 'fr').toLowerCase();
  const cats = article.data.categories || [];
  const wpId = article.data.wp_id;

  if (!cats.length) {
    const [rows] = await pool.query(
      `SELECT ${ARTICLE_LIST_COLUMNS} FROM el_articles
       WHERE draft = 0 AND lang = ? AND wp_id != ?
       ORDER BY date DESC LIMIT ?`,
      [lang, wpId, limit]
    );
    return (rows as Record<string, unknown>[]).map((r) =>
      rowToArticle(r, { includeBody: false })
    );
  }

  // JSON_QUOTE(?) — pas CAST(? AS JSON) (mysql2 échappe mal les guillemets)
  const overlap = cats
    .map(() => 'JSON_CONTAINS(categories, JSON_QUOTE(?))')
    .join(' OR ');
  const params: unknown[] = [lang, wpId, ...cats, limit];
  const [rows] = await pool.query(
    `SELECT ${ARTICLE_LIST_COLUMNS} FROM el_articles
     WHERE draft = 0 AND lang = ? AND wp_id != ?
       AND (${overlap})
     ORDER BY date DESC
     LIMIT ?`,
    params
  );
  return (rows as Record<string, unknown>[]).map((r) =>
    rowToArticle(r, { includeBody: false })
  );
}

/** Articles d’une rubrique (JSON categories). */
export async function getArticlesByCategory(
  categorySlug: string,
  lang: LangCode | 'all' = 'fr',
  opts: ListOpts = {}
): Promise<Article[]> {
  const pool = getPool();
  const includeBody = Boolean(opts.includeBody);
  const cols = includeBody ? '*' : ARTICLE_LIST_COLUMNS;
  const params: unknown[] = [categorySlug];
  let sql = `SELECT ${cols} FROM el_articles
    WHERE draft = 0 AND JSON_CONTAINS(categories, JSON_QUOTE(?))`;
  if (lang !== 'all') {
    sql += ` AND lang = ?`;
    params.push(lang);
  }
  sql += ` ORDER BY date DESC`;
  if (opts.limit != null) {
    sql += ` LIMIT ?`;
    params.push(Math.max(1, Number(opts.limit)));
    if (opts.offset != null) {
      sql += ` OFFSET ?`;
      params.push(Math.max(0, Number(opts.offset)));
    }
  }
  const [rows] = await pool.query(sql, params);
  return (rows as Record<string, unknown>[]).map((r) =>
    rowToArticle(r, { includeBody })
  );
}

export async function countArticlesByCategory(
  categorySlug: string,
  lang: LangCode | 'all' = 'fr'
): Promise<number> {
  const pool = getPool();
  const params: unknown[] = [categorySlug];
  let sql = `SELECT COUNT(*) AS n FROM el_articles
    WHERE draft = 0 AND JSON_CONTAINS(categories, JSON_QUOTE(?))`;
  if (lang !== 'all') {
    sql += ` AND lang = ?`;
    params.push(lang);
  }
  const [rows] = await pool.query(sql, params);
  return Number((rows as { n: number }[])[0]?.n || 0);
}

/** Articles portant un tag. */
export async function getArticlesByTag(
  tag: string,
  lang: LangCode | 'all' = 'all'
): Promise<Article[]> {
  const pool = getPool();
  const params: unknown[] = [tag];
  let sql = `SELECT ${ARTICLE_LIST_COLUMNS} FROM el_articles
    WHERE draft = 0 AND JSON_CONTAINS(tags, JSON_QUOTE(?))`;
  if (lang !== 'all') {
    sql += ` AND lang = ?`;
    params.push(lang);
  }
  sql += ` ORDER BY date DESC`;
  const [rows] = await pool.query(sql, params);
  return (rows as Record<string, unknown>[]).map((r) =>
    rowToArticle(r, { includeBody: false })
  );
}

export type SearchDoc = {
  title: string;
  excerpt: string;
  href: string;
  categories: string[];
  date: string;
  access: string;
};

export function toSearchDoc(article: Article): SearchDoc {
  return {
    title: article.data.title,
    excerpt: article.data.excerpt,
    href: articlePath(article),
    categories: article.data.category_names,
    date: article.data.date.toISOString(),
    access: article.data.access,
  };
}
