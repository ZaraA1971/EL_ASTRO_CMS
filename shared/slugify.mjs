/**
 * Slugify — source unique (articles `-`, rubriques `_`).
 */

export function stripDiacritics(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * @param {string} input
 * @param {{ sep?: string, max?: number, fallback?: string }} [opts]
 */
export function slugify(input, opts = {}) {
  const sep = opts.sep ?? '-';
  const max = opts.max ?? 80;
  const fallback = opts.fallback ?? 'article';
  const re = new RegExp(`[^a-z0-9]+`, 'g');
  const trimRe = new RegExp(
    `^${sep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}+|${sep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}+$`,
    'g'
  );
  const base = stripDiacritics(input)
    .toLowerCase()
    .replace(re, sep)
    .replace(trimRe, '')
    .slice(0, max);
  return base || fallback;
}

/** Slug article / auteur : a-z 0-9 - */
export function slugifyArticle(title) {
  return slugify(title, { sep: '-', max: 80, fallback: 'article' });
}

/** Slug rubrique WP-style : a-z 0-9 _ */
export function slugifyCategoryName(name) {
  return slugify(name, { sep: '_', max: 64, fallback: 'rubrique' });
}
