/**
 * Destinataires newsletter par groupes de privilèges (el_users).
 */
import { canAccessPremium, normalizeRole, ROLES } from '../roles.mjs';
import crypto from 'node:crypto';

export const NL_GROUPS = Object.freeze({
  ADMIN: 'admin',
  REDACTEURS: 'redacteurs',
  ABONNES: 'abonnes',
});

export const DEFAULT_GROUPS = [
  NL_GROUPS.ADMIN,
  NL_GROUPS.REDACTEURS,
  NL_GROUPS.ABONNES,
];

/**
 * @param {string|string[]|null|undefined} input
 * @param {{ fallback?: string[]|null }} [opts]
 *   - fallback DEFAULT_GROUPS : comportement historique (listes / meta)
 *   - fallback null|[] : aucun groupe si vide (draft/send/preview — jamais « tout le monde » par défaut)
 */
export function normalizeGroups(input, opts = {}) {
  const fallback =
    opts.fallback === undefined ? [...DEFAULT_GROUPS] : opts.fallback;
  const raw = Array.isArray(input)
    ? input
    : String(input || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
  const allowed = new Set(Object.values(NL_GROUPS));
  const out = [
    ...new Set(
      raw.map((g) => String(g).toLowerCase()).filter((g) => allowed.has(g))
    ),
  ];
  if (out.length) return out;
  return Array.isArray(fallback) ? [...fallback] : [];
}

/** Groupes explicites obligatoires — refuse le fallback « tous ». */
export function requireGroups(input) {
  const groups = normalizeGroups(input, { fallback: [] });
  if (!groups.length) {
    throw new Error('Sélectionnez au moins un groupe destinataire');
  }
  return groups;
}

function validEmail(email) {
  const e = String(email || '').trim();
  return e.includes('@') && e.length >= 5 && e.length <= 190;
}

/**
 * @returns {Promise<{ counts: Record<string, number>, total: number, users: Array }>}
 */
export async function resolveNewsletterRecipients(pool, groups, { includeUsers = true } = {}) {
  // Pas de fallback « tous » ici : l’appelant (requireGroups) doit déjà valider.
  const selected = normalizeGroups(groups, { fallback: [] });
  const [rows] = await pool.query(
    `SELECT id, login, email, display_name, role, status, access_until,
            newsletter_opt_in, newsletter_unsub_token
     FROM el_users
     WHERE status = 'active'
       AND newsletter_opt_in = 1
       AND email IS NOT NULL
       AND email != ''`
  );

  const byGroup = {
    [NL_GROUPS.ADMIN]: [],
    [NL_GROUPS.REDACTEURS]: [],
    [NL_GROUPS.ABONNES]: [],
  };

  for (const row of rows) {
    if (!validEmail(row.email)) continue;
    const role = normalizeRole(row.role);
    if (role === ROLES.ADMIN) byGroup[NL_GROUPS.ADMIN].push(row);
    else if (role === ROLES.EDITOR || role === ROLES.AUTHOR) {
      byGroup[NL_GROUPS.REDACTEURS].push(row);
    } else if (role === ROLES.SUBSCRIBER && canAccessPremium(row)) {
      byGroup[NL_GROUPS.ABONNES].push(row);
    }
  }

  const seen = new Set();
  const users = [];
  for (const g of selected) {
    for (const u of byGroup[g] || []) {
      const key = String(u.email).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      users.push(u);
    }
  }

  const counts = {
    [NL_GROUPS.ADMIN]: byGroup[NL_GROUPS.ADMIN].length,
    [NL_GROUPS.REDACTEURS]: byGroup[NL_GROUPS.REDACTEURS].length,
    [NL_GROUPS.ABONNES]: byGroup[NL_GROUPS.ABONNES].length,
  };

  return {
    counts,
    total: users.length,
    users: includeUsers ? users : [],
  };
}

export async function ensureUnsubToken(pool, userRow) {
  if (userRow.newsletter_unsub_token) {
    return String(userRow.newsletter_unsub_token);
  }
  const token = crypto.randomBytes(16).toString('hex');
  await pool.query(
    `UPDATE el_users SET newsletter_unsub_token = ? WHERE id = ? AND (newsletter_unsub_token IS NULL OR newsletter_unsub_token = '')`,
    [token, userRow.id]
  );
  userRow.newsletter_unsub_token = token;
  return token;
}
