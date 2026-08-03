/**
 * Délai avant qu’une modification compte comme « mise à jour » éditoriale
 * (site « Mis à jour le… », iOS `updated`, bouton Pupitre).
 * Évite qu’une coquille juste après publication soit traitée comme une MAJ.
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
