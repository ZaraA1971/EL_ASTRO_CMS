/**
 * Provisionnement compte après paiement Stripe.
 */
import crypto from 'node:crypto';
import {
  ensurePasswordResetSchema,
} from '../password-reset.mjs';
import { hashUserPassword, generateTempPassword } from '../users.mjs';
import { ROLES, STATUSES, isStaffRole } from '../roles.mjs';
import { PLAN_MONTHLY } from './config.mjs';
import { ensureBillingSchema } from './schema.mjs';
import { sendWelcomeEmail } from './welcome.mjs';

function toMysqlDate(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 19).replace('T', ' ');
}

function nowMysql() {
  return toMysqlDate(new Date());
}

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Identifiant compte = e-mail normalisé (clé métier EL).
 * Conservé sous `login` pour compat session / desk.
 */
export function loginFromEmail(email) {
  const e = normalizeEmail(email);
  if (!isValidEmail(e)) return 'abonne';
  return e.slice(0, 100);
}

async function nextUserId(pool) {
  const [[row]] = await pool.query(
    'SELECT COALESCE(MAX(id), 900000) + 1 AS next_id FROM el_users'
  );
  return Math.max(900001, Number(row.next_id));
}

async function uniqueLogin(pool, base) {
  const candidate = String(base || '').slice(0, 100);
  const [rows] = await pool.query(
    'SELECT id FROM el_users WHERE login = ? LIMIT 1',
    [candidate]
  );
  if (!rows.length) return candidate;
  // Collision rare (login≠email historique) — suffixe court hors format e-mail
  for (let i = 2; i < 50; i += 1) {
    const tryLogin = `${candidate.slice(0, 96)}~${i}`;
    const [hit] = await pool.query(
      'SELECT id FROM el_users WHERE login = ? LIMIT 1',
      [tryLogin]
    );
    if (!hit.length) return tryLogin;
  }
  return `${candidate.slice(0, 80)}~${Date.now().toString(36)}`;
}

export async function findUserByStripeCustomer(pool, customerId) {
  if (!customerId) return null;
  const [rows] = await pool.query(
    `SELECT id, login, email, display_name, role, status, access_until,
            stripe_customer_id, stripe_subscription_id, plan, newsletter_opt_in
     FROM el_users WHERE stripe_customer_id = ? LIMIT 1`,
    [String(customerId)]
  );
  return rows[0] || null;
}

export async function findUserByStripeSubscription(pool, subId) {
  if (!subId) return null;
  const [rows] = await pool.query(
    `SELECT id, login, email, display_name, role, status, access_until,
            stripe_customer_id, stripe_subscription_id, plan, newsletter_opt_in
     FROM el_users WHERE stripe_subscription_id = ? LIMIT 1`,
    [String(subId)]
  );
  return rows[0] || null;
}

export async function findUserByEmail(pool, email) {
  const e = normalizeEmail(email);
  if (!e) return null;
  const [rows] = await pool.query(
    `SELECT id, login, email, display_name, role, status, access_until,
            stripe_customer_id, stripe_subscription_id, plan, newsletter_opt_in
     FROM el_users WHERE LOWER(email) = ? LIMIT 1`,
    [e]
  );
  return rows[0] || null;
}

/**
 * Active / crée un abonné après paiement.
 * @returns {{ user, created: boolean, welcomeSent?: boolean }}
 */
export async function provisionSubscriberFromStripe(pool, opts, brevo, siteUrl) {
  await ensureBillingSchema(pool);
  await ensurePasswordResetSchema(pool);

  const email = normalizeEmail(opts.email);
  if (!isValidEmail(email)) {
    const err = new Error('E-mail de facturation invalide');
    err.code = 'INVALID_EMAIL';
    throw err;
  }

  const customerId = String(opts.customerId || '').trim() || null;
  const subscriptionId = String(opts.subscriptionId || '').trim() || null;
  const displayName = String(opts.name || '').trim().slice(0, 250) || email;
  const accessUntil = opts.accessUntil
    ? toMysqlDate(opts.accessUntil)
    : null;
  const newsletterOptIn = opts.newsletterOptIn !== false ? 1 : 0;

  let user =
    (await findUserByStripeSubscription(pool, subscriptionId)) ||
    (await findUserByStripeCustomer(pool, customerId)) ||
    (await findUserByEmail(pool, email));

  if (user && isStaffRole(user.role)) {
    // Ne pas rétrograder le staff : rattache Stripe, pas de date de fin.
    await pool.query(
      `UPDATE el_users SET
        stripe_customer_id = COALESCE(?, stripe_customer_id),
        stripe_subscription_id = COALESCE(?, stripe_subscription_id),
        plan = ?,
        billing_email = ?,
        access_until = NULL,
        status = ?
       WHERE id = ?`,
      [
        customerId,
        subscriptionId,
        PLAN_MONTHLY,
        email,
        STATUSES.ACTIVE,
        user.id,
      ]
    );
    const [rows] = await pool.query(
      `SELECT id, login, email, display_name, role, status, access_until,
              stripe_customer_id, stripe_subscription_id, plan
       FROM el_users WHERE id = ?`,
      [user.id]
    );
    return { user: rows[0], created: false, welcomeSent: false };
  }

  if (user) {
    await pool.query(
      `UPDATE el_users SET
        role = ?,
        status = ?,
        access_until = ?,
        stripe_customer_id = COALESCE(?, stripe_customer_id),
        stripe_subscription_id = COALESCE(?, stripe_subscription_id),
        plan = ?,
        billing_email = ?,
        display_name = CASE WHEN display_name = '' OR display_name IS NULL THEN ? ELSE display_name END
       WHERE id = ?`,
      [
        ROLES.SUBSCRIBER,
        STATUSES.ACTIVE,
        accessUntil,
        customerId,
        subscriptionId,
        PLAN_MONTHLY,
        email,
        displayName,
        user.id,
      ]
    );
    const [rows] = await pool.query(
      `SELECT id, login, email, display_name, role, status, access_until,
              stripe_customer_id, stripe_subscription_id, plan
       FROM el_users WHERE id = ?`,
      [user.id]
    );
    return { user: rows[0], created: false, welcomeSent: false };
  }

  // Nouveau compte
  const login = await uniqueLogin(pool, loginFromEmail(email));
  const id = await nextUserId(pool);
  const tempPassword = generateTempPassword(16);
  const passwordHash = hashUserPassword(tempPassword);
  const registered = nowMysql();

  await pool.query(
    `INSERT INTO el_users (
      id, login, email, display_name, password_hash,
      role, status, access_until, wp_role, source, notes,
      newsletter_opt_in, registered,
      stripe_customer_id, stripe_subscription_id, plan, billing_email
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      login,
      email,
      displayName,
      passwordHash,
      ROLES.SUBSCRIBER,
      STATUSES.ACTIVE,
      accessUntil,
      null,
      'stripe',
      'Abonnement mensuel Stripe',
      newsletterOptIn,
      registered,
      customerId,
      subscriptionId,
      PLAN_MONTHLY,
      email,
    ]
  );

  // Jeton pour choisir le mot de passe (ne pas envoyer le MDP temporaire).
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await pool.query(
    `UPDATE el_users
     SET password_reset_token = ?, password_reset_expires = ?
     WHERE id = ?`,
    [token, toMysqlDate(expires), id]
  );

  const [rows] = await pool.query(
    `SELECT id, login, email, display_name, role, status, access_until,
            stripe_customer_id, stripe_subscription_id, plan
     FROM el_users WHERE id = ?`,
    [id]
  );
  const created = rows[0];

  let welcomeSent = false;
  try {
    const out = await sendWelcomeEmail({
      user: created,
      resetToken: token,
      brevo,
      siteUrl,
    });
    welcomeSent = Boolean(out?.ok);
  } catch (err) {
    console.error('[billing] welcome email', err.message);
  }

  return { user: created, created: true, welcomeSent };
}

/** Met à jour access_until / status depuis un abonnement Stripe. */
export async function syncSubscriptionAccess(pool, opts) {
  await ensureBillingSchema(pool);
  const subscriptionId = String(opts.subscriptionId || '').trim();
  const customerId = String(opts.customerId || '').trim();
  if (!subscriptionId && !customerId) return null;

  let user =
    (await findUserByStripeSubscription(pool, subscriptionId)) ||
    (await findUserByStripeCustomer(pool, customerId));
  if (!user) return null;

  // Staff : sync Stripe ids seulement — jamais de date de fin ni statut expired.
  if (isStaffRole(user.role)) {
    await pool.query(
      `UPDATE el_users SET
        stripe_subscription_id = COALESCE(?, stripe_subscription_id),
        stripe_customer_id = COALESCE(?, stripe_customer_id),
        plan = COALESCE(plan, ?),
        access_until = NULL,
        status = ?
       WHERE id = ?`,
      [
        subscriptionId || null,
        customerId || null,
        PLAN_MONTHLY,
        STATUSES.ACTIVE,
        user.id,
      ]
    );
    const [staffRows] = await pool.query(
      `SELECT id, login, email, display_name, role, status, access_until,
              stripe_customer_id, stripe_subscription_id, plan
       FROM el_users WHERE id = ?`,
      [user.id]
    );
    return staffRows[0] || null;
  }

  const status = String(opts.status || '').toLowerCase();
  const accessUntil = opts.accessUntil
    ? toMysqlDate(opts.accessUntil)
    : user.access_until;
  const active =
    status === 'active' || status === 'trialing' || status === 'past_due';

  await pool.query(
    `UPDATE el_users SET
      stripe_subscription_id = COALESCE(?, stripe_subscription_id),
      stripe_customer_id = COALESCE(?, stripe_customer_id),
      plan = COALESCE(plan, ?),
      access_until = ?,
      status = ?
     WHERE id = ?`,
    [
      subscriptionId || null,
      customerId || null,
      PLAN_MONTHLY,
      accessUntil,
      active ? STATUSES.ACTIVE : STATUSES.EXPIRED,
      user.id,
    ]
  );

  const [rows] = await pool.query(
    `SELECT id, login, email, display_name, role, status, access_until,
            stripe_customer_id, stripe_subscription_id, plan
     FROM el_users WHERE id = ?`,
    [user.id]
  );
  return rows[0] || null;
}

export { normalizeEmail, isValidEmail };
