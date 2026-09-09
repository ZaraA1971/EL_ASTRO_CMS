/**
 * Titre article — source unique (pupitre, API desk).
 * Un titre « placeholder » ou vide ne doit pas être publié.
 */

/** Titres par défaut / non renseignés (comparaison insensible à la casse). */
export const PLACEHOLDER_ARTICLE_TITLES = new Set([
  'nouvel article',
  'sans titre',
  'new article',
  'untitled',
]);

/**
 * @param {unknown} title
 * @returns {string}
 */
export function normalizeArticleTitle(title) {
  return String(title ?? '').trim();
}

/**
 * @param {unknown} title
 * @returns {boolean}
 */
export function isMissingArticleTitle(title) {
  const t = normalizeArticleTitle(title);
  if (!t) return true;
  return PLACEHOLDER_ARTICLE_TITLES.has(t.toLowerCase());
}

/**
 * @param {unknown} title
 * @returns {boolean}
 */
export function hasRealArticleTitle(title) {
  return !isMissingArticleTitle(title);
}

/**
 * Message d’erreur publication, ou null si le titre est utilisable.
 * @param {unknown} title
 * @returns {string|null}
 */
export function articleTitlePublishError(title) {
  if (hasRealArticleTitle(title)) return null;
  return 'Renseignez un titre avant de publier cet article.';
}
