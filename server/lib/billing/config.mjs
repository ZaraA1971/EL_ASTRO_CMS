/**
 * Config Stripe (abonnement mensuel en ligne).
 * Clés dans /etc/electronlibre/el-astro-api.env — absentes = checkout désactivé.
 */

export const PLAN_MONTHLY = 'monthly';
export const PLAN_ANNUAL_MANUAL = 'annual_manual';

export const PRICE_MONTHLY_EUR = 100;
export const PRICE_ANNUAL_EUR = 900;
/** Essai gratuit à l’inscription (abonnement mensuel Stripe). */
export const TRIAL_PERIOD_DAYS = 10;

function flagEnabled(raw, defaultOn = true) {
  if (raw == null || String(raw).trim() === '') return defaultOn;
  return !['0', 'false', 'off', 'no'].includes(String(raw).trim().toLowerCase());
}

function parseTrialDays(raw) {
  if (raw == null || String(raw).trim() === '') return TRIAL_PERIOD_DAYS;
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 0) return TRIAL_PERIOD_DAYS;
  return n;
}

/** fileEnv wins when the key is present (incl. empty) — isolable en tests. */
function pickEnv(fileEnv, key) {
  if (Object.prototype.hasOwnProperty.call(fileEnv, key)) {
    const v = fileEnv[key];
    return v == null ? '' : String(v);
  }
  return process.env[key] || '';
}

export function loadBillingConfig(fileEnv = {}) {
  const secretKey = pickEnv(fileEnv, 'STRIPE_SECRET_KEY');
  const webhookSecret = pickEnv(fileEnv, 'STRIPE_WEBHOOK_SECRET');
  const priceMonthly = pickEnv(fileEnv, 'STRIPE_PRICE_MONTHLY');
  // STRIPE_CHECKOUT_ENABLED=false → coupe le CTA public sans retirer les clés
  const checkoutRaw = Object.prototype.hasOwnProperty.call(
    fileEnv,
    'STRIPE_CHECKOUT_ENABLED'
  )
    ? fileEnv.STRIPE_CHECKOUT_ENABLED
    : process.env.STRIPE_CHECKOUT_ENABLED;
  const checkoutEnabled = flagEnabled(checkoutRaw, true);
  const trialRaw = Object.prototype.hasOwnProperty.call(
    fileEnv,
    'STRIPE_TRIAL_DAYS'
  )
    ? fileEnv.STRIPE_TRIAL_DAYS
    : process.env.STRIPE_TRIAL_DAYS;
  const trialPeriodDays = parseTrialDays(trialRaw);
  // Webhook obligatoire : sinon paiement Stripe sans provision compte.
  const enabled = Boolean(
    secretKey && priceMonthly && webhookSecret && checkoutEnabled
  );
  return {
    secretKey,
    webhookSecret,
    priceMonthly,
    enabled,
    trialPeriodDays,
    priceMonthlyEur: PRICE_MONTHLY_EUR,
    priceAnnualEur: PRICE_ANNUAL_EUR,
  };
}

export function billingPublicConfig(cfg) {
  const trial =
    cfg?.trialPeriodDays != null && Number.isFinite(Number(cfg.trialPeriodDays))
      ? Number(cfg.trialPeriodDays)
      : TRIAL_PERIOD_DAYS;
  return {
    enabled: Boolean(cfg?.enabled),
    priceMonthlyEur: PRICE_MONTHLY_EUR,
    priceAnnualEur: PRICE_ANNUAL_EUR,
    trialPeriodDays: trial,
    currency: 'eur',
  };
}
