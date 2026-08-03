/**
 * Formats de date FR (et variantes locales) — source unique.
 */

export const TZ_PARIS = 'Europe/Paris';

function asDate(d) {
  if (d == null || d === '') return null;
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** dd/mm/yyyy (newsletter, calendrier local du runtime). */
export function formatDateFrNumeric(d) {
  const dt = asDate(d);
  if (!dt) return '';
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/** Jour · mois court · année (desk, recherche). */
export function formatDateFrShort(d, locale = 'fr-FR') {
  const dt = asDate(d);
  if (!dt) return '';
  try {
    return dt.toLocaleDateString(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

/** Jour · mois long · année (archives, cartes). */
export function formatDateFrLong(d, locale = 'fr-FR') {
  const dt = asDate(d);
  if (!dt) return '';
  try {
    return dt.toLocaleDateString(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

/** Date + heure courte (desk). */
export function formatDateTimeFrShort(d, locale = 'fr-FR') {
  const dt = asDate(d);
  if (!dt) return '';
  try {
    return dt.toLocaleString(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/**
 * Mise à jour éditoriale : date longue + heure (fuseau Europe/Paris).
 * @param {Date|string|number} d
 * @param {{ lang?: 'fr'|'en', timeZone?: string }} [opts]
 */
export function formatDateTimeFrLong(d, opts = {}) {
  const dt = asDate(d);
  if (!dt) return '';
  const lang = opts.lang === 'en' ? 'en' : 'fr';
  const timeZone = opts.timeZone || TZ_PARIS;
  const locale = lang === 'en' ? 'en-GB' : 'fr-FR';
  try {
    const day = dt.toLocaleDateString(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone,
    });
    const time = dt.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone,
    });
    return lang === 'en' ? `${day}, ${time}` : `${day} à ${time}`;
  } catch {
    return '';
  }
}
