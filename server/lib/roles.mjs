/**
 * Re-export shared + helpers API (publicUser).
 */
export {
  ROLES,
  STATUSES,
  ROLE_LABELS_UI,
  ROLE_LABELS_EMAIL,
  STATUS_LABELS,
  STAFF_ROLE_KEYS,
  mapWpRoleToEl,
  normalizeRole,
  isStaffRole,
  isRedacteurRole,
  canAccessDesk,
  canEditAll,
  canPublish,
  canAccessPremium,
  effectiveStatus,
  roleLabelUi,
  roleLabelEmail,
  statusLabel,
} from '../../shared/roles.mjs';

import {
  ROLES,
  normalizeRole,
  isStaffRole,
  canAccessDesk,
  canAccessPremium,
  effectiveStatus,
} from '../../shared/roles.mjs';

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
