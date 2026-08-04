/**
 * Mise à jour éditoriale — source unique (desk, API, site, iOS).
 *
 * Délai avant qu’une modification compte comme « Mis à jour »
 * (évite qu’une coquille juste après publication soit traitée comme une MAJ).
 */

export const EDITORIAL_UPDATE_GRACE_MS = 45 * 60 * 1000;

function asDate(v) {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * true si `modified` (ou « maintenant ») est assez éloigné de la publication.
 * @param {Date|string|number|null|undefined} published
 * @param {Date|string|number|null|undefined} [modifiedOrNow]
 */
export function isEditorialUpdate(published, modifiedOrNow = new Date()) {
  const pub = asDate(published);
  const mod = asDate(modifiedOrNow);
  if (!pub || !mod) return false;
  return mod.getTime() - pub.getTime() >= EDITORIAL_UPDATE_GRACE_MS;
}

/** Alias lisible côté UI : la publication est hors délai de grâce. */
export function isPastEditorialUpdateGrace(published, now = Date.now()) {
  return isEditorialUpdate(published, now);
}

/**
 * Faut-il remonter `modified` (affichage « Mis à jour ») ?
 * Un seul changement Accès abonné ↔ gratuit (et effets mots-clés liés)
 * ne doit pas compter comme mise à jour éditoriale.
 *
 * @param {{
 *   accessChanged?: boolean,
 *   iaKeywordsChanged?: boolean,
 *   otherFieldsChanged?: boolean,
 * }} flags
 */
export function shouldBumpEditorialModified(flags = {}) {
  if (flags.otherFieldsChanged) return true;
  if (!flags.accessChanged && flags.iaKeywordsChanged) return true;
  return false;
}
