import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  loginFromEmail,
  normalizeEmail,
  isValidEmail,
} from './provision.mjs';
import {
  billingPublicConfig,
  loadBillingConfig,
  PRICE_MONTHLY_EUR,
  PRICE_ANNUAL_EUR,
  TRIAL_PERIOD_DAYS,
} from './config.mjs';
import { periodEndFromSubscription } from './period.mjs';

describe('billing config', () => {
  it('exposes public prices and disabled without keys', () => {
    // Clés vides explicites : isole le test de l’env machine (prod).
    const cfg = loadBillingConfig({
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SECRET: '',
      STRIPE_PRICE_MONTHLY: '',
      STRIPE_TRIAL_DAYS: '',
    });
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.trialPeriodDays, TRIAL_PERIOD_DAYS);
    const pub = billingPublicConfig(cfg);
    assert.equal(pub.enabled, false);
    assert.equal(pub.priceMonthlyEur, PRICE_MONTHLY_EUR);
    assert.equal(pub.priceAnnualEur, PRICE_ANNUAL_EUR);
    assert.equal(pub.trialPeriodDays, TRIAL_PERIOD_DAYS);
  });

  it('enables when secret + price + webhook present', () => {
    const cfg = loadBillingConfig({
      STRIPE_SECRET_KEY: 'sk_test_x',
      STRIPE_PRICE_MONTHLY: 'price_abc',
      STRIPE_WEBHOOK_SECRET: 'whsec_x',
    });
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.trialPeriodDays, 10);
  });

  it('stays disabled without webhook secret', () => {
    const cfg = loadBillingConfig({
      STRIPE_SECRET_KEY: 'sk_test_x',
      STRIPE_PRICE_MONTHLY: 'price_abc',
      STRIPE_WEBHOOK_SECRET: '',
    });
    assert.equal(cfg.enabled, false);
  });

  it('disables checkout when STRIPE_CHECKOUT_ENABLED=false', () => {
    const cfg = loadBillingConfig({
      STRIPE_SECRET_KEY: 'sk_test_x',
      STRIPE_PRICE_MONTHLY: 'price_abc',
      STRIPE_WEBHOOK_SECRET: 'whsec_x',
      STRIPE_CHECKOUT_ENABLED: 'false',
    });
    assert.equal(cfg.enabled, false);
  });

  it('honours STRIPE_TRIAL_DAYS override', () => {
    const cfg = loadBillingConfig({
      STRIPE_SECRET_KEY: 'sk_test_x',
      STRIPE_PRICE_MONTHLY: 'price_abc',
      STRIPE_WEBHOOK_SECRET: 'whsec_x',
      STRIPE_TRIAL_DAYS: '14',
    });
    assert.equal(cfg.trialPeriodDays, 14);
    assert.equal(billingPublicConfig(cfg).trialPeriodDays, 14);
  });

  it('allows STRIPE_TRIAL_DAYS=0 to disable trial', () => {
    const cfg = loadBillingConfig({
      STRIPE_SECRET_KEY: 'sk_test_x',
      STRIPE_PRICE_MONTHLY: 'price_abc',
      STRIPE_WEBHOOK_SECRET: 'whsec_x',
      STRIPE_TRIAL_DAYS: '0',
    });
    assert.equal(cfg.trialPeriodDays, 0);
    assert.equal(billingPublicConfig(cfg).trialPeriodDays, 0);
  });
});

describe('billing provision helpers', () => {
  it('normalizes and validates email', () => {
    assert.equal(normalizeEmail('  A@B.Fr '), 'a@b.fr');
    assert.equal(isValidEmail('a@b.fr'), true);
    assert.equal(isValidEmail('nope'), false);
  });

  it('uses email as login identifier', () => {
    assert.equal(
      loginFromEmail('Marie.Dupont@example.com'),
      'marie.dupont@example.com'
    );
    assert.equal(
      loginFromEmail('info@electronlibre.info'),
      'info@electronlibre.info'
    );
  });
});

describe('periodEndFromSubscription', () => {
  it('reads root current_period_end (legacy)', () => {
    const d = periodEndFromSubscription({ current_period_end: 1788021678 });
    assert.equal(d?.toISOString(), '2026-08-29T16:41:18.000Z');
  });

  it('reads item current_period_end when root missing', () => {
    const d = periodEndFromSubscription({
      items: {
        data: [{ current_period_end: 1788021678 }],
      },
    });
    assert.equal(d?.toISOString(), '2026-08-29T16:41:18.000Z');
  });

  it('returns null without period fields', () => {
    assert.equal(periodEndFromSubscription({ status: 'active' }), null);
  });

  it('falls back to trial_end', () => {
    const d = periodEndFromSubscription({ trial_end: 1788021678 });
    assert.equal(d?.toISOString(), '2026-08-29T16:41:18.000Z');
  });
});
