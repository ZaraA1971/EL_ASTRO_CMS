/**
 * Modèle d’accès ElectronLibre — 4 niveaux :
 * 1. admin
 * 2. rédacteurs (editor + author)
 * 3. abonnés (subscriber)
 * 4. autres (other / anonyme / disabled / expired)
 */

export const ROLES = Object.freeze({
  ADMIN: 'admin',
  EDITOR: 'editor',
  AUTHOR: 'author',
  SUBSCRIBER: 'subscriber',
  OTHER: 'other',
});

export const STATUSES = Object.freeze({
  ACTIVE: 'active',
  DISABLED: 'disabled',
  EXPIRED: 'expired',
});

const WP_TO_EL = Object.freeze({
  administrator: ROLES.ADMIN,
  editor: ROLES.EDITOR,
  author: ROLES.AUTHOR,
  contributor: ROLES.OTHER,
  subscriber: ROLES.SUBSCRIBER,
});

/** Anciens slugs encore possibles en session / DB avant migration. */
const LEGACY_TO_EL = Object.freeze({
  administrator: ROLES.ADMIN,
  admin: ROLES.ADMIN,
  editor: ROLES.EDITOR,
  author: ROLES.AUTHOR,
  contributor: ROLES.OTHER,
  subscriber: ROLES.SUBSCRIBER,
  other: ROLES.OTHER,
});

export function mapWpRoleToEl(wpRole) {
  const key = String(wpRole || '').toLowerCase();
  return WP_TO_EL[key] || ROLES.OTHER;
}

export function normalizeRole(role) {
  const key = String(role || '').toLowerCase();
  return LEGACY_TO_EL[key] || ROLES.OTHER;
}

export function isStaffRole(role) {
  const r = normalizeRole(role);
  return r === ROLES.ADMIN || r === ROLES.EDITOR || r === ROLES.AUTHOR;
}

export function isRedacteurRole(role) {
  const r = normalizeRole(role);
  return r === ROLES.EDITOR || r === ROLES.AUTHOR;
}

export function canAccessDesk(role) {
  return isStaffRole(role);
}

export function canEditAll(role) {
  const r = normalizeRole(role);
  return r === ROLES.ADMIN || r === ROLES.EDITOR;
}

/** Publier + push OneSignal : admin / editor seulement (pas author). */
export function canPublish(role) {
  return canEditAll(role);
}

/**
 * Accès contenu premium + Compagnon.
 * Staff actif : oui. Abonné actif non expiré : oui. Sinon : non.
 * access_until = fin de période payée (pas « fin d’abo » : le renouvellement
 * tacite Stripe la prolonge via les webhooks).
 */
export function canAccessPremium(user) {
  if (!user) return false;
  const status = String(user.status || STATUSES.ACTIVE).toLowerCase();
  if (status === STATUSES.DISABLED) return false;

  const role = normalizeRole(user.role);
  if (role === ROLES.OTHER) return false;

  // Staff : accès permanent (pas de date de fin / pas d’« expired » Stripe).
  if (isStaffRole(role)) {
    return status === STATUSES.ACTIVE || status === STATUSES.EXPIRED;
  }

  const until = user.access_until ? new Date(user.access_until) : null;
  if (until && !Number.isNaN(until.getTime()) && until.getTime() < Date.now()) {
    return false;
  }

  if (status === STATUSES.EXPIRED) return false;

  return role === ROLES.SUBSCRIBER;
}

export function effectiveStatus(user) {
  if (!user) return STATUSES.DISABLED;
  const status = String(user.status || STATUSES.ACTIVE).toLowerCase();
  if (status === STATUSES.DISABLED) return STATUSES.DISABLED;
  if (isStaffRole(user.role)) {
    return status === STATUSES.EXPIRED ? STATUSES.ACTIVE : status;
  }
  const until = user.access_until ? new Date(user.access_until) : null;
  if (until && !Number.isNaN(until.getTime()) && until.getTime() < Date.now()) {
    return STATUSES.EXPIRED;
  }
  if (status === STATUSES.EXPIRED) return STATUSES.EXPIRED;
  return STATUSES.ACTIVE;
}

export function publicUser(user) {
  if (!user) return null;
  const role = normalizeRole(user.role);
  const status = effectiveStatus(user);
  const entitled = canAccessPremium(user);
  return {
    id: Number(user.id),
    login: user.login,
    name: user.display_name || user.name || user.login,
    email: user.email || undefined,
    role,
    status,
    // Staff : jamais exposer de fin de période
    access_until: isStaffRole(role) ? null : user.access_until || null,
    entitled,
    desk: canAccessDesk(role),
    tier: tierLabel(role, entitled),
  };
}

function tierLabel(role, entitled) {
  const r = normalizeRole(role);
  if (r === ROLES.ADMIN) return 'admin';
  if (r === ROLES.EDITOR || r === ROLES.AUTHOR) return 'redacteur';
  if (r === ROLES.SUBSCRIBER && entitled) return 'abonne';
  return 'autre';
}
