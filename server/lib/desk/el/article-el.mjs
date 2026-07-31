/**
 * Helpers articles spécifiques EL (RAG, jumeaux bilingues).
 * Hors pupitre-core.
 */
import {
  buildKeywordSource,
  extractKeywordsViaRag,
  normalizeKeywords,
} from '../../keywords.mjs';
import { canEditArticle, asJson } from '../core/article-helpers.mjs';

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

/** Propage les mots-clés IA vers la version FR/EN liée. */
export async function syncKeywordsToTwin(pool, session, row, keywords) {
  const twinId =
    Number(row.translation_en) || Number(row.translation_fr) || 0;
  if (!twinId || !Array.isArray(keywords)) return null;
  let twin;
  try {
    twin = await loadEditableTwin(pool, session, twinId);
  } catch {
    return null;
  }
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
export async function ensureSubscriberKeywords(
  ctx,
  { access, title, excerpt, body, lang, existingKeywords = [] }
) {
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
