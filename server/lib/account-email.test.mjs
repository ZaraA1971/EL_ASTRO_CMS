import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { roleLabelFr, sendAccountCreatedEmail } from './account-email.mjs';

describe('roleLabelFr', () => {
  it('maps known roles', () => {
    assert.equal(roleLabelFr('admin'), 'administrateur');
    assert.equal(roleLabelFr('editor'), 'éditeur');
    assert.equal(roleLabelFr('author'), 'auteur');
    assert.equal(roleLabelFr('subscriber'), 'abonné');
    assert.equal(roleLabelFr('other'), 'compte');
  });

  it('falls back for unknown', () => {
    assert.equal(roleLabelFr('contributor'), 'compte');
  });
});

describe('sendAccountCreatedEmail', () => {
  it('refuses without email', async () => {
    const out = await sendAccountCreatedEmail({
      user: { login: 'x', role: 'admin' },
      brevo: { dryRun: true },
      siteUrl: 'https://electronlibre.info',
    });
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'no_email');
  });

  it('dry-runs for desk and stripe', async () => {
    const desk = await sendAccountCreatedEmail({
      user: {
        login: 'steve',
        email: 'steve@example.com',
        display_name: 'Steve Jobs',
        role: 'author',
      },
      brevo: { dryRun: true },
      siteUrl: 'https://electronlibre.info',
      source: 'desk',
    });
    assert.equal(desk.ok, true);
    assert.equal(desk.dryRun, true);

    const stripe = await sendAccountCreatedEmail({
      user: {
        login: 'abo@example.com',
        email: 'abo@example.com',
        display_name: 'Abo',
        role: 'subscriber',
      },
      resetToken: 'tok_test',
      brevo: { dryRun: true },
      siteUrl: 'https://electronlibre.info',
      source: 'stripe',
    });
    assert.equal(stripe.ok, true);
    assert.equal(stripe.dryRun, true);
  });
});
