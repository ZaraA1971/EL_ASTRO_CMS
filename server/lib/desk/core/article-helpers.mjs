/**
 * Helpers articles portables (slug, ids, dates, droits édition basiques).
 * Pas de RAG / jumeaux bilingues — voir `../el/article-el.mjs`.
 */
import { canAccessDesk, canEditAll } from '../../roles.mjs';
import { normalizeKeywords } from '../../keywords.mjs';

export { normalizeKeywords };

export function canEditArticle(session, row) {
  if (!session || !canAccessDesk(session.role)) return false;
  if (canEditAll(session.role)) return true;
  return Number(row.author_user_id) === Number(session.uid);
}

export function slugify(title) {
  return (
    String(title || 'article')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'article'
  );
}

export function toMysqlDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export function nowMysql() {
  return toMysqlDate(new Date());
}

let dateNullableEnsured = false;

/**
 * Brouillons : date de publication NULL jusqu’au premier publish.
 * Convention host actuelle : table `el_articles`.
 */
export async function ensureArticleDateNullable(pool) {
  if (dateNullableEnsured) return;
  const [cols] = await pool.query(`SHOW COLUMNS FROM el_articles LIKE 'date'`);
  const col = cols[0];
  if (col && String(col.Null).toUpperCase() === 'NO') {
    await pool.query(
      'ALTER TABLE el_articles MODIFY COLUMN date DATETIME NULL DEFAULT NULL'
    );
  }
  dateNullableEnsured = true;
}

export function asJson(v) {
  if (!v) return JSON.stringify([]);
  if (Array.isArray(v)) return JSON.stringify(v.map(String));
  return JSON.stringify([String(v)]);
}

/** Prochain id article (plancher 100000 si table vide / max bas). */
export async function nextArticleId(pool) {
  const [[maxRow]] = await pool.query(
    'SELECT COALESCE(MAX(article_id), 100000) + 1 AS next_id FROM el_articles'
  );
  return Number(maxRow.next_id);
}

export async function uniqueSlug(pool, base, excludeArticleId = null) {
  const slug = slugify(base);
  let n = 0;
  for (;;) {
    const candidate = n === 0 ? slug : `${slug}-${n}`;
    const [rows] = await pool.query(
      excludeArticleId
        ? 'SELECT article_id FROM el_articles WHERE slug = ? AND article_id != ? LIMIT 1'
        : 'SELECT article_id FROM el_articles WHERE slug = ? LIMIT 1',
      excludeArticleId ? [candidate, excludeArticleId] : [candidate]
    );
    if (!rows.length) return candidate;
    n += 1;
    if (n > 50) return `${slug}-${Date.now()}`;
  }
}

export const PLACEHOLDER_SLUGS = new Set([
  'nouvel-article',
  'new-article',
  'untitled',
  'article',
]);

/**
 * Slug URL : suit le titre tant que brouillon / placeholder / slug = ancien titre.
 * Sinon conserve le slug publié (URLs stables), sauf override explicite.
 */
export async function resolveArticleSlug(pool, existing, title, payloadSlug) {
  if (payloadSlug != null && String(payloadSlug).trim()) {
    return uniqueSlug(pool, String(payloadSlug).trim(), existing.article_id);
  }
  const current = String(existing.slug || '').trim();
  const fromOldTitle = slugify(existing.title);
  const isDraft = Number(existing.draft) === 1;
  const isPlaceholder = !current || PLACEHOLDER_SLUGS.has(current);
  const tracksOldTitle = current && current === fromOldTitle;
  if (isDraft || isPlaceholder || tracksOldTitle) {
    return uniqueSlug(pool, title || current || 'article', existing.article_id);
  }
  return current;
}
