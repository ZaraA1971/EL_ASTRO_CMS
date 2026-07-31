/**
 * Comptes desk ElectronLibre — policy + hooks (hash WP, newsletter, mails).
 * Router HTTP portable : desk/core/users/router.mjs
 */
import crypto from 'node:crypto';
import wordpressHash from 'wordpress-hash-node';
import {
  ROLES,
  STATUSES,
  canEditAll,
  isStaffRole,
  normalizeRole,
  publicUser,
  effectiveStatus,
} from './roles.mjs';
import { auditLog } from './audit.mjs';
import {
  sendAccountCreatedEmail,
  notifyAdminsAccountCreated,
  notifyAdminsAccountDeleted,
} from './account-email.mjs';
import { ensurePasswordResetSchema } from './password-reset.mjs';
import { ensureNewsletterSchema } from './newsletter/schema.mjs';
import { ensureNewsletterEnrollment } from './newsletter/recipients.mjs';
import { createUsersStore } from './desk/core/users/store.mjs';
import { handleCoreUsers } from './desk/core/users/router.mjs';

const hashPassword =
  wordpressHash.HashPassword || wordpressHash.hashPassword;

const STAFF_ROLES = new Set([ROLES.ADMIN, ROLES.EDITOR]);

const USER_SELECT = `id, login, email, display_name, role, status, access_until,
            wp_role, source, notes, newsletter_opt_in, registered, updated_at`;

/** Mot de passe lisible one-shot (jamais stocké en clair). */
export function generateTempPassword(length = 14) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function canManageUsers(role) {
  return canEditAll(role);
}

export function isAdmin(role) {
  return normalizeRole(role) === ROLES.ADMIN;
}

/** Qui peut modifier la cible selon le rôle de l’opérateur. */
export function canMutateUser(actorRole, targetRole) {
  if (!canManageUsers(actorRole)) return false;
  const target = normalizeRole(targetRole);
  if (STAFF_ROLES.has(target) && !isAdmin(actorRole)) return false;
  return true;
}

export function allowedRolesForActor(actorRole) {
  if (isAdmin(actorRole)) {
    return [
      ROLES.ADMIN,
      ROLES.EDITOR,
      ROLES.AUTHOR,
      ROLES.SUBSCRIBER,
      ROLES.OTHER,
    ];
  }
  return [ROLES.AUTHOR, ROLES.SUBSCRIBER, ROLES.OTHER];
}

export function rowToDeskUser(row) {
  if (!row) return null;
  const pub = publicUser(row);
  return {
    ...pub,
    notes: row.notes || '',
    wp_role: row.wp_role || null,
    source: row.source || 'wp',
    newsletter_opt_in: Number(row.newsletter_opt_in) !== 0,
    registered: row.registered || null,
    updated_at: row.updated_at || null,
  };
}

export function hashUserPassword(plain) {
  if (!plain || String(plain).length < 8) {
    const err = new Error('Mot de passe : 8 caractères minimum');
    err.code = 'PASSWORD_WEAK';
    throw err;
  }
  if (typeof hashPassword !== 'function') {
    const err = new Error('Hash password indisponible');
    err.code = 'PASSWORD_HASH';
    throw err;
  }
  return hashPassword(String(plain));
}

export const elUsersStore = createUsersStore({
  tableName: 'el_users',
  idFloor: 900000,
  selectColumns: USER_SELECT,
});

/** Policy injectée dans handleCoreUsers — ne jamais contourner le hash WP. */
export const elUserPolicy = {
  ROLES,
  STATUSES,
  canManageUsers,
  canMutateUser,
  allowedRolesForActor,
  isAdmin,
  normalizeRole,
  isStaffRole,
  hashPassword: hashUserPassword,
  generateTempPassword,
  rowToDeskUser,
  effectiveStatus,
  adminRoles: ['admin', 'administrator'],
};

/**
 * Side-effects EL après création : newsletter, token reset, mails.
 * Le mot de passe n’est jamais renvoyé ici.
 */
export async function elAfterUserCreate(
  { id, created, newsletterOptIn },
  ctx
) {
  const { pool, brevo, siteUrl, session, actor } = ctx;

  try {
    await ensureNewsletterSchema(pool);
    await ensureNewsletterEnrollment(pool, id, {
      optIn: newsletterOptIn === 1,
    });
  } catch (err) {
    console.error('[users] newsletter enrollment', err.message);
  }

  let resetToken = null;
  try {
    await ensurePasswordResetSchema(pool);
    resetToken = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.query(
      `UPDATE el_users
       SET password_reset_token = ?, password_reset_expires = ?
       WHERE id = ?`,
      [resetToken, expires.toISOString().slice(0, 19).replace('T', ' '), id]
    );
  } catch (err) {
    console.error('[users] password setup token', err.message);
    resetToken = null;
  }

  let emailSent = false;
  let adminEmailSent = false;
  try {
    const out = await sendAccountCreatedEmail({
      user: { ...created, newsletter_opt_in: newsletterOptIn },
      brevo,
      siteUrl,
      resetToken,
      source: 'desk',
      newsletterOptIn: newsletterOptIn === 1,
    });
    emailSent = Boolean(out?.ok);
  } catch (err) {
    console.error('[users] account-created email', err.message);
  }
  try {
    const adminOut = await notifyAdminsAccountCreated({
      pool,
      user: created,
      brevo,
      siteUrl,
      source: 'desk',
      actorLogin: session?.login || actor?.login || null,
    });
    adminEmailSent = Boolean(adminOut?.ok);
  } catch (err) {
    console.error('[users] admin account-created email', err.message);
  }
  return { emailSent, adminEmailSent };
}

export async function elAfterUserDelete({ existing }, ctx) {
  const { pool, brevo, siteUrl, session, actor } = ctx;
  let adminEmailSent = false;
  try {
    const adminOut = await notifyAdminsAccountDeleted({
      pool,
      user: existing,
      brevo,
      siteUrl,
      source: existing.source === 'stripe' ? 'stripe' : 'desk',
      actorLogin: session?.login || actor?.login || null,
    });
    adminEmailSent = Boolean(adminOut?.ok);
  } catch (err) {
    console.error('[users] admin account-deleted email', err.message);
  }
  return { adminEmailSent };
}

/**
 * Routes /api/desk/users[/:id] — délègue au core avec policy/hooks EL.
 */
export async function handleDeskUsers(req, res, parts, ctx) {
  return handleCoreUsers(req, res, parts, {
    ...ctx,
    usersStore: ctx.usersStore || elUsersStore,
    userPolicy: ctx.userPolicy || elUserPolicy,
    auditLog: ctx.auditLog || auditLog,
    afterUserCreate: ctx.afterUserCreate || elAfterUserCreate,
    afterUserDelete: ctx.afterUserDelete || elAfterUserDelete,
  });
}
