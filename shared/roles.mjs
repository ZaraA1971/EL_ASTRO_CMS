/**
 * Rôles / statuts ElectronLibre — source unique (API, desk, Astro, e-mails).
 *
 * Niveaux : admin · rédacteurs (editor+author) · abonnés · autres.
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

/** Libellés courts UI (Pupitre, badges). */
export const ROLE_LABELS_UI = Object.freeze({
  [ROLES.ADMIN]: 'Admin',
  [ROLES.EDITOR]: 'Éditeur',
  [ROLES.AUTHOR]: 'Auteur',
  [ROLES.SUBSCRIBER]: 'Abonné',
  [ROLES.OTHER]: 'Autre',
});

/** Libellés e-mail (phrase / type de compte). */
export const ROLE_LABELS_EMAIL = Object.freeze({
  [ROLES.ADMIN]: 'administrateur',
  [ROLES.EDITOR]: 'éditeur',
  [ROLES.AUTHOR]: 'auteur',
  [ROLES.SUBSCRIBER]: 'abonné',
  [ROLES.OTHER]: 'compte',
});

export const STATUS_LABELS = Object.freeze({
  [STATUSES.ACTIVE]: 'Actif',
  [STATUSES.DISABLED]: 'Désactivé',
  [STATUSES.EXPIRED]: 'Expiré',
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

/** Clés staff — pour scripts inline (compte.astro) sans importer de fonctions. */
export const STAFF_ROLE_KEYS = Object.freeze([
  ROLES.ADMIN,
  ROLES.EDITOR,
  ROLES.AUTHOR,
]);

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
 */
export function canAccessPremium(user) {
  if (!user) return false;
  const status = String(user.status || STATUSES.ACTIVE).toLowerCase();
  if (status === STATUSES.DISABLED) return false;

  const role = normalizeRole(user.role);
  if (role === ROLES.OTHER) return false;

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

export function roleLabelUi(role) {
  const r = normalizeRole(role);
  return ROLE_LABELS_UI[r] || ROLE_LABELS_UI[ROLES.OTHER];
}

export function roleLabelEmail(role) {
  const r = normalizeRole(role);
  return ROLE_LABELS_EMAIL[r] || ROLE_LABELS_EMAIL[ROLES.OTHER];
}

export function statusLabel(status) {
  const s = String(status || '').toLowerCase();
  return STATUS_LABELS[s] || s || '—';
}
