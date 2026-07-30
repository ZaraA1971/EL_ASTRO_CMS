/**
 * API publique /api/billing/*
 * - GET  /config
 * - POST /checkout   → session Stripe Checkout
 * - GET  /me         → statut abo (session)
 * - POST /portal     → Customer Portal Stripe
 * - PATCH /me        → newsletter_opt_in
 * - POST /webhook    → événements Stripe
 */
import Stripe from 'stripe';
import { rateLimit, clientIp } from '../rate-limit.mjs';
import { auditLog } from '../audit.mjs';
import { hashUserPassword } from '../users.mjs';
import { canAccessPremium, publicUser, STATUSES } from '../roles.mjs';
import { ensureBillingSchema } from './schema.mjs';
import { billingPublicConfig, PLAN_MONTHLY } from './config.mjs';
import {
  normalizeEmail,
  isValidEmail,
  findUserByEmail,
  provisionSubscriberFromStripe,
  syncSubscriptionAccess,
} from './provision.mjs';
import { periodEndFromSubscription } from './period.mjs';

function getStripe(cfg) {
  if (!cfg?.secretKey) return null;
  return new Stripe(cfg.secretKey);
}

async function loadBillingUser(pool, userId) {
  const [rows] = await pool.query(
    `SELECT id, login, email, display_name, role, status, access_until,
            stripe_customer_id, stripe_subscription_id, plan, billing_email,
            newsletter_opt_in, source
     FROM el_users WHERE id = ? LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

function accountPayload(user) {
  const pub = publicUser(user);
  return {
    ...pub,
    plan: user.plan || null,
    billing_email: user.billing_email || user.email || null,
    newsletter_opt_in: Number(user.newsletter_opt_in) !== 0,
    stripe: Boolean(user.stripe_customer_id),
    canManageBilling: Boolean(user.stripe_customer_id),
  };
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string[]} parts
 */
export async function handleBilling(req, res, parts, ctx) {
  const {
    pool,
    sendJson,
    readBody,
    readSession,
    billingCfg,
    brevo,
    siteUrl,
  } = ctx;

  await ensureBillingSchema(pool);
  const action = parts[2] || 'config';

  // GET /api/billing/config
  if (action === 'config' && req.method === 'GET') {
    return sendJson(res, 200, billingPublicConfig(billingCfg));
  }

  // POST /api/billing/webhook — raw body + signature
  if (action === 'webhook' && req.method === 'POST') {
    return handleWebhook(req, res, ctx);
  }

  // POST /api/billing/checkout
  if (action === 'checkout' && req.method === 'POST') {
    return handleCheckout(req, res, ctx);
  }

  // Routes authentifiées
  const session = readSession(req);
  if (!session?.uid) {
    return sendJson(res, 401, { error: 'Connexion requise' });
  }
  const user = await loadBillingUser(pool, session.uid);
  if (!user) {
    return sendJson(res, 401, { error: 'Session invalide' });
  }
  if (String(user.status || '').toLowerCase() === STATUSES.DISABLED) {
    return sendJson(res, 403, { error: 'Compte désactivé' });
  }

  // GET /api/billing/me
  if (action === 'me' && req.method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      account: accountPayload(user),
      entitled: canAccessPremium(user),
      billingEnabled: Boolean(billingCfg?.enabled),
    });
  }

  // PATCH /api/billing/me — newsletter
  if (action === 'me' && req.method === 'PATCH') {
    let payload;
    try {
      payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    } catch {
      return sendJson(res, 400, { error: 'JSON invalide' });
    }
    if (payload.newsletter_opt_in != null) {
      const opt = payload.newsletter_opt_in ? 1 : 0;
      await pool.query(
        'UPDATE el_users SET newsletter_opt_in = ? WHERE id = ?',
        [opt, user.id]
      );
    }
    const updated = await loadBillingUser(pool, user.id);
    return sendJson(res, 200, { ok: true, account: accountPayload(updated) });
  }

  // POST /api/billing/password — changer MDP (connecté)
  if (action === 'password' && req.method === 'POST') {
    const ip = clientIp(req);
    const lim = rateLimit(`billing-pwd:${ip}`, {
      windowMs: 15 * 60_000,
      max: 10,
    });
    if (!lim.ok) {
      return sendJson(res, 429, {
        error: 'Trop de tentatives. Réessayez plus tard.',
        retryAfterSec: lim.retryAfterSec,
      });
    }
    let payload;
    try {
      payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    } catch {
      return sendJson(res, 400, { error: 'JSON invalide' });
    }
    try {
      const hash = hashUserPassword(payload.password);
      await pool.query(
        `UPDATE el_users SET password_hash = ?,
          password_reset_token = NULL, password_reset_expires = NULL
         WHERE id = ?`,
        [hash, user.id]
      );
      await auditLog(pool, {
        actor: { uid: user.id, login: user.login },
        action: 'user.password_change',
        targetType: 'user',
        targetId: user.id,
        ip,
      }).catch(() => {});
      return sendJson(res, 200, { ok: true, message: 'Mot de passe mis à jour.' });
    } catch (err) {
      const status = err.code === 'PASSWORD_WEAK' ? 400 : 500;
      return sendJson(res, status, {
        error: err.message || 'Échec',
      });
    }
  }

  // POST /api/billing/portal
  if (action === 'portal' && req.method === 'POST') {
    if (!billingCfg?.enabled) {
      return sendJson(res, 503, {
        error: 'Paiement en ligne non configuré pour le moment.',
        code: 'BILLING_DISABLED',
      });
    }
    if (!user.stripe_customer_id) {
      return sendJson(res, 400, {
        error:
          'Aucun abonnement Stripe lié à ce compte. Contactez-nous pour l’abonnement annuel.',
        code: 'NO_STRIPE_CUSTOMER',
      });
    }
    const stripe = getStripe(billingCfg);
    const base = String(siteUrl || '').replace(/\/+$/, '');
    try {
      const portal = await stripe.billingPortal.sessions.create({
        customer: user.stripe_customer_id,
        return_url: `${base}/compte/`,
      });
      return sendJson(res, 200, { ok: true, url: portal.url });
    } catch (err) {
      console.error('[billing] portal', err.message);
      return sendJson(res, 502, {
        error: 'Portail de facturation indisponible.',
      });
    }
  }

  return sendJson(res, 404, { error: 'Unknown billing route' });
}

async function handleCheckout(req, res, ctx) {
  const { pool, sendJson, readBody, billingCfg, siteUrl } = ctx;
  const ip = clientIp(req);
  const lim = rateLimit(`billing-checkout:${ip}`, {
    windowMs: 15 * 60_000,
    max: 8,
  });
  if (!lim.ok) {
    return sendJson(res, 429, {
      error: 'Trop de tentatives. Réessayez plus tard.',
      retryAfterSec: lim.retryAfterSec,
    });
  }

  let payload;
  try {
    payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
  } catch {
    return sendJson(res, 400, { error: 'JSON invalide' });
  }

  // Honeypot anti-spam
  if (String(payload.website || payload.company_url || '').trim()) {
    return sendJson(res, 200, {
      ok: true,
      url: `${String(siteUrl || '').replace(/\/+$/, '')}/abonnement/?ok=1`,
    });
  }

  if (!billingCfg?.enabled) {
    return sendJson(res, 503, {
      error:
        'Le paiement en ligne n’est pas encore activé. Utilisez l’abonnement annuel par e-mail, ou réessayez bientôt.',
      code: 'BILLING_DISABLED',
    });
  }

  const email = normalizeEmail(payload.email);
  const firstName = String(
    payload.first_name || payload.given_name || payload['given-name'] || ''
  )
    .trim()
    .slice(0, 60);
  const lastName = String(
    payload.last_name || payload.family_name || payload['family-name'] || ''
  )
    .trim()
    .slice(0, 60);
  const name = [firstName, lastName].filter(Boolean).join(' ').slice(0, 120)
    || String(payload.name || '').trim().slice(0, 120);
  if (!isValidEmail(email)) {
    return sendJson(res, 400, { error: 'E-mail invalide' });
  }
  if (!firstName || firstName.length < 2) {
    return sendJson(res, 400, { error: 'Indiquez votre prénom' });
  }
  if (!lastName || lastName.length < 2) {
    return sendJson(res, 400, { error: 'Indiquez votre nom' });
  }

  const emailLim = rateLimit(`billing-checkout-email:${email}`, {
    windowMs: 60 * 60_000,
    max: 5,
  });
  if (!emailLim.ok) {
    return sendJson(res, 429, {
      error: 'Trop de demandes pour cet e-mail. Réessayez plus tard.',
      retryAfterSec: emailLim.retryAfterSec,
    });
  }

  const existing = await findUserByEmail(pool, email);
  if (existing && canAccessPremium(existing) && existing.stripe_subscription_id) {
    return sendJson(res, 409, {
      error:
        'Un abonnement actif est déjà lié à cet e-mail. Connectez-vous ou utilisez « Mot de passe oublié ».',
      code: 'ALREADY_SUBSCRIBED',
    });
  }

  const stripe = getStripe(billingCfg);
  const base = String(siteUrl || '').replace(/\/+$/, '');
  const newsletterOptIn = payload.newsletter_opt_in !== false;

  try {
    const sessionParams = {
      mode: 'subscription',
      customer_email: existing?.stripe_customer_id ? undefined : email,
      customer: existing?.stripe_customer_id || undefined,
      client_reference_id: existing ? String(existing.id) : undefined,
      line_items: [{ price: billingCfg.priceMonthly, quantity: 1 }],
      success_url: `${base}/compte/?checkout=success`,
      cancel_url: `${base}/abonnement/?checkout=cancel`,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      // Compte Stripe : Managed Payments est ON par défaut ; EL reste marchand
      // (pas Stripe MoR) — désactiver pour ce Checkout classique.
      managed_payments: { enabled: false },
      metadata: {
        el_name: name,
        el_first_name: firstName,
        el_last_name: lastName,
        el_newsletter: newsletterOptIn ? '1' : '0',
        el_plan: PLAN_MONTHLY,
      },
      subscription_data: {
        metadata: {
          el_name: name,
          el_first_name: firstName,
          el_last_name: lastName,
          el_newsletter: newsletterOptIn ? '1' : '0',
          el_plan: PLAN_MONTHLY,
        },
        ...(Number(billingCfg.trialPeriodDays) > 0
          ? { trial_period_days: Number(billingCfg.trialPeriodDays) }
          : {}),
      },
    };
    // Stripe refuse customer + customer_email ensemble
    if (sessionParams.customer) {
      delete sessionParams.customer_email;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    await auditLog(pool, {
      actor: { uid: existing?.id || null, login: email },
      action: 'billing.checkout_create',
      targetType: 'billing',
      targetId: null,
      ip,
      meta: { sessionId: session.id, email },
    }).catch(() => {});

    return sendJson(res, 200, { ok: true, url: session.url, id: session.id });
  } catch (err) {
    console.error('[billing] checkout', err.message);
    return sendJson(res, 502, {
      error: 'Impossible de démarrer le paiement. Réessayez plus tard.',
    });
  }
}

async function handleWebhook(req, res, ctx) {
  const { pool, sendJson, readBody, billingCfg, brevo, siteUrl } = ctx;

  if (!billingCfg?.secretKey || !billingCfg?.webhookSecret) {
    return sendJson(res, 503, { error: 'Webhook non configuré' });
  }

  const stripe = getStripe(billingCfg);
  let raw;
  try {
    raw = await readBody(req, 1024 * 1024);
  } catch {
    return sendJson(res, 400, { error: 'Body invalide' });
  }

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      raw,
      sig,
      billingCfg.webhookSecret
    );
  } catch (err) {
    console.error('[billing] webhook signature', err.message);
    return sendJson(res, 400, { error: 'Signature invalide' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode !== 'subscription') break;
        const email =
          session.customer_details?.email ||
          session.customer_email ||
          '';
        const metaFirst = String(session.metadata?.el_first_name || '').trim();
        const metaLast = String(session.metadata?.el_last_name || '').trim();
        const name =
          [metaFirst, metaLast].filter(Boolean).join(' ') ||
          session.metadata?.el_name ||
          session.customer_details?.name ||
          '';
        const newsletterOptIn = session.metadata?.el_newsletter !== '0';
        let accessUntil = null;
        let subscriptionId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id;
        const customerId =
          typeof session.customer === 'string'
            ? session.customer
            : session.customer?.id;

        if (subscriptionId) {
          try {
            const sub = await stripe.subscriptions.retrieve(subscriptionId);
            accessUntil = periodEndFromSubscription(sub);
            subscriptionId = sub.id;
          } catch (err) {
            console.error('[billing] retrieve sub', err.message);
          }
        }

        const result = await provisionSubscriberFromStripe(
          pool,
          {
            email,
            name,
            customerId,
            subscriptionId,
            accessUntil,
            newsletterOptIn,
          },
          brevo,
          siteUrl
        );
        await auditLog(pool, {
          actor: {
            uid: result.user?.id || null,
            login: result.user?.login || email,
          },
          action: result.created
            ? 'billing.provision_create'
            : 'billing.provision_update',
          targetType: 'user',
          targetId: result.user?.id || null,
          meta: {
            subscriptionId,
            customerId,
            welcomeSent: result.welcomeSent,
          },
        }).catch(() => {});
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await syncSubscriptionAccess(pool, {
          subscriptionId: sub.id,
          customerId:
            typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
          accessUntil: periodEndFromSubscription(sub),
          status:
            event.type === 'customer.subscription.deleted'
              ? 'canceled'
              : sub.status,
        });
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object;
        const subId =
          typeof invoice.subscription === 'string'
            ? invoice.subscription
            : invoice.subscription?.id;
        if (!subId) break;
        try {
          const sub = await stripe.subscriptions.retrieve(subId);
          await syncSubscriptionAccess(pool, {
            subscriptionId: sub.id,
            customerId:
              typeof sub.customer === 'string'
                ? sub.customer
                : sub.customer?.id,
            accessUntil: periodEndFromSubscription(sub),
            status: sub.status,
          });
        } catch (err) {
          console.error('[billing] invoice.paid', err.message);
        }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error('[billing] webhook handler', event.type, err.message);
    return sendJson(res, 500, { error: 'Traitement webhook échoué' });
  }

  return sendJson(res, 200, { received: true });
}
