import {
  buildKeywordSource,
  extractKeywordsViaRag,
  normalizeKeywords,
} from '../../keywords.mjs';
import { canAccessDesk, canEditAll } from '../../roles.mjs';

export { normalizeKeywords };

export function canEditArticle(session, row) {
  if (!session || !canAccessDesk(session.role)) return false;
  if (canEditAll(session.role)) return true;
  return Number(row.author_user_id) === Number(session.uid);
}

/**
 * Valide un lien de traduction : la cible doit exister et être éditable
 * par la session (évite IDOR via translation_en / translation_fr).
 * @returns {Promise<object|null>} row twin ou null si twinId falsy
 */
export async function loadEditableTwin(pool, session, twinId) {
  const id = Number(twinId) || 0;
  if (!id) return null;
  const [rows] = await pool.query(
    'SELECT * FROM el_articles WHERE article_id = ? LIMIT 1',
    [id]
  );
  const twin = rows[0] || null;
  if (!twin) {
    const err = new Error('Article de traduction lié introuvable');
    err.status = 400;
    throw err;
  }
  if (!canEditArticle(session, twin)) {
    const err = new Error('Lien de traduction non autorisé sur cet article');
    err.status = 403;
    throw err;
  }
  return twin;
}

/** Propage les mots-clés IA vers la version FR/EN liée (entités souvent bilingues). */
export async function syncKeywordsToTwin(pool, session, row, keywords) {
  const twinId =
    Number(row.translation_en) || Number(row.translation_fr) || 0;
  if (!twinId || !Array.isArray(keywords)) return null;
  let twin;
  try {
    twin = await loadEditableTwin(pool, session, twinId);
  } catch {
    // Lien cassé / non autorisé : ne pas bloquer la sauvegarde source
    return null;
  }
  // Mots-clés IA = articles abonnés uniquement
  if (!twin || twin.access === 'granted') return null;
  await pool.query('UPDATE el_articles SET ia_keywords = ? WHERE article_id = ?', [
    asJson(keywords),
    twinId,
  ]);
  return twinId;
}

/**
 * Génère des mots-clés IA pour un article abonnés s’il n’en a pas encore.
 * Ne lève pas : en cas d’échec RAG, renvoie la liste courante (souvent []).
 */
export async function ensureSubscriberKeywords(ctx, {
  access,
  title,
  excerpt,
  body,
  lang,
  existingKeywords = [],
}) {
  if (access === 'granted') return [];
  const current = normalizeKeywords(existingKeywords);
  if (current.length) return current;
  const { content, language } = buildKeywordSource({
    title,
    excerpt,
    body,
    lang,
  });
  if (content.length < 40) return [];
  try {
    return await extractKeywordsViaRag({
      upstream: ctx.ragUpstream,
      apiKey: ctx.ragApiKey,
      content,
      language,
    });
  } catch (err) {
    console.error('[desk] auto-keywords', err.message);
    return [];
  }
}

export function slugify(title) {
  return String(title || 'article')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'article';
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

/** Brouillons : date de publication NULL jusqu’au premier publish. */
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
  const fromTitle = slugify(title);
  const fromOldTitle = slugify(existing.title);
  const isDraft = Number(existing.draft) === 1;
  const isPlaceholder = !current || PLACEHOLDER_SLUGS.has(current);
  const tracksOldTitle = current && current === fromOldTitle;
  if (isDraft || isPlaceholder || tracksOldTitle) {
    return uniqueSlug(pool, title || current || 'article', existing.article_id);
  }
  return current;
}
