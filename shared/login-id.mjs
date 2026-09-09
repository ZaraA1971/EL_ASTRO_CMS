/**
 * Identifiant compte — source unique (pupitre, API, auth).
 *
 * API principale : validateLoginId(raw, context)
 *   context = 'store'
 *
 * Pas de liste blanche a-z0-9 : un e-mail est un identifiant valide
 * (connexion = login OU e-mail, déjà le cas Stripe / auth / iOS).
 */

/** Longueur colonne `el_users.login` (VARCHAR(100), alignée e-mail). */
export const LOGIN_ID_MAX = 100;
export const LOGIN_ID_MIN = 3;

/**
 * Règles par contexte.
 * @type {Record<string, { min: number, max: number }>}
 */
export const LOGIN_ID_CONTEXTS = {
  /** Création / édition pupitre + API desk. */
  store: { min: LOGIN_ID_MIN, max: LOGIN_ID_MAX },
};

export function normalizeLoginId(raw) {
  return String(raw || '').trim().toLowerCase();
}

/**
 * @param {unknown} raw
 * @param {'store'} [context]
 * @returns {{ ok: true, login: string } | { ok: false, error: string }}
 */
export function validateLoginId(raw, context = 'store') {
  const rules = LOGIN_ID_CONTEXTS[context];
  if (!rules) {
    throw new Error(`login-id: contexte inconnu ${context}`);
  }
  const login = normalizeLoginId(raw);
  if (!login) {
    return { ok: false, error: 'Identifiant requis.' };
  }
  if (login.length < rules.min || login.length > rules.max) {
    return {
      ok: false,
      error: `Identifiant : ${rules.min}–${rules.max} caractères.`,
    };
  }
  if (/[\s\u0000-\u001f\u007f]/.test(login)) {
    return {
      ok: false,
      error: 'Identifiant : pas d’espace ni de caractère de contrôle.',
    };
  }
  return { ok: true, login };
}
