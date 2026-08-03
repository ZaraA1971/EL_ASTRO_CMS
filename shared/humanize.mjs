/**
 * Slug → libellé affichable — source unique.
 */

/** `reseaux-sociaux` / `le_flouze` → `Reseaux Sociaux` / `Le Flouze`. */
export function humanizeTag(slug) {
  return String(slug || '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Mot-clé déjà lisible inchangé ; slug WP → humanizeTag.
 * @param {string} value
 */
export function displayKeyword(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(raw) && !/\s/.test(raw)) {
    return humanizeTag(raw);
  }
  return raw;
}
