import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  roleLabelFr,
  sendAccountCreatedEmail,
  notifyAdminsAccountCreated,
  notifyAdminsAccountDeleted,
  listActiveAdminEmails,
  buildAccountCreatedEmail,
  buildAdminAccountEventEmail,
  renderElEmail,
  IOS_APP_STORE_URL,
} from './account-email.mjs';
import { renderAppInstallPill } from './email/brand.mjs';

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

describe('EL email template', () => {
  it('renders brand shell; app pill stays optional (newsletter)', () => {
    const html = renderElEmail({
      siteUrl: 'https://electronlibre.info',
      kicker: 'Bienvenue',
      title: 'Votre compte est prêt',
      lead: 'Lead',
      bodyHtml: '<p>Corps</p>',
      cta: { href: 'https://electronlibre.info/login/', label: 'Se connecter' },
    });
    assert.match(html, /Electron<span[^>]*>Libre<\/span>/);
    assert.match(html, /Bienvenue/);
    assert.doesNotMatch(html, /Installer l’app/);
    assert.match(renderAppInstallPill(), /Installer l’app/);
    assert.match(
      renderAppInstallPill(),
      new RegExp(IOS_APP_STORE_URL.replace(/\//g, '\\/'))
    );
  });

  it('builds stripe holder email with set-password CTA', () => {
    const { subject, html } = buildAccountCreatedEmail({
      user: {
        login: 'abo@example.com',
        email: 'abo@example.com',
        display_name: 'Abo Test',
        role: 'subscriber',
      },
      siteUrl: 'https://electronlibre.info',
      resetToken: 'tok_abc',
      source: 'stripe',
    });
    assert.equal(subject, 'ElectronLibre — Bienvenue, votre compte est prêt');
    assert.match(html, /Abo Test/);
    assert.match(html, /accès premium est déjà ouvert/);
    assert.match(html, /E-mail de connexion/);
    assert.match(html, /Utilisez cet e-mail pour vous connecter/);
    assert.doesNotMatch(html, /Identifiant&nbsp;:/);
    assert.match(html, /Choisir mon mot de passe/);
    assert.match(html, /token=tok_abc/);
    assert.match(html, /abonné/);
    assert.doesNotMatch(html, /Installer l’app/);
    assert.doesNotMatch(html, /[Aa]ctivez/);
  });

  it('builds desk holder email with set-password CTA', () => {
    const { subject, html } = buildAccountCreatedEmail({
      user: {
        login: 'steve',
        email: 'steve@example.com',
        display_name: 'Steve Jobs',
        role: 'author',
      },
      siteUrl: 'https://electronlibre.info',
      resetToken: 'tok_desk',
      source: 'desk',
    });
    assert.equal(
      subject,
      'ElectronLibre — Confirmation de création de compte'
    );
    assert.match(html, /Steve Jobs/);
    assert.match(html, /déjà disponible/);
    assert.match(html, /Identifiant/);
    assert.match(html, /Connexion possible avec l’identifiant ou l’e-mail/);
    assert.match(html, /Choisir mon mot de passe/);
    assert.match(html, /token=tok_desk/);
    assert.doesNotMatch(html, /qui vous a été communiqué/);
    assert.doesNotMatch(html, /[Aa]ctivez/);
    assert.match(html, /auteur/);
    assert.match(html, /\/desk\//);
  });

  it('builds admin created and deleted notifications', () => {
    const created = buildAdminAccountEventEmail({
      action: 'created',
      user: {
        login: 'abo',
        email: 'abo@example.com',
        display_name: 'Abo',
        role: 'subscriber',
      },
      siteUrl: 'https://electronlibre.info',
      source: 'stripe',
    });
    assert.match(created.subject, /Nouveau compte/);
    assert.match(created.html, /créé/);

    const deleted = buildAdminAccountEventEmail({
      action: 'deleted',
      user: {
        login: 'abo',
        email: 'abo@example.com',
        display_name: 'Abo',
        role: 'subscriber',
      },
      siteUrl: 'https://electronlibre.info',
      source: 'desk',
      actorLogin: 'admin',
    });
    assert.match(deleted.subject, /Compte supprimé/);
    assert.match(deleted.html, /supprimé/);
    assert.match(deleted.html, /admin/);
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

describe('admin notifications', () => {
  it('lists admins and excludes the new user email', async () => {
    const pool = {
      async query() {
        return [
          [
            {
              email: 'admin@electronlibre.info',
              display_name: 'Admin',
              login: 'admin',
            },
            {
              email: 'new@example.com',
              display_name: 'New',
              login: 'new',
            },
          ],
        ];
      },
    };
    const list = await listActiveAdminEmails(pool, {
      excludeEmail: 'new@example.com',
    });
    assert.deepEqual(
      list.map((r) => r.email),
      ['admin@electronlibre.info']
    );
  });

  it('notifies on create and delete (dry-run fallback)', async () => {
    const pool = {
      async query() {
        return [[]];
      },
    };
    const user = {
      login: 'abo',
      email: 'abo@example.com',
      display_name: 'Abo',
      role: 'subscriber',
    };
    const created = await notifyAdminsAccountCreated({
      pool,
      user,
      brevo: { dryRun: true },
      siteUrl: 'https://electronlibre.info',
      source: 'stripe',
    });
    assert.equal(created.ok, true);
    assert.equal(created.sent, 1);

    const deleted = await notifyAdminsAccountDeleted({
      pool,
      user,
      brevo: { dryRun: true },
      siteUrl: 'https://electronlibre.info',
      source: 'desk',
      actorLogin: 'admin',
    });
    assert.equal(deleted.ok, true);
    assert.equal(deleted.sent, 1);
  });
});
