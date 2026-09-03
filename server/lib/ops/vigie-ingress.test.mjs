import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accountPayload,
  audiencePayload,
  newsletterPayload,
  shouldPushAccount,
  shouldPushNewsletter,
} from './vigie-ingress.mjs';

test('pousse les actions compte', () => {
  assert.equal(shouldPushAccount('user.create'), true);
  assert.equal(shouldPushAccount('article.publish'), false);
});

test('payload riche sans secret', () => {
  const p = accountPayload(
    {
      action: 'user.delete',
      actor: { login: 'admin' },
      targetId: 42,
      meta: { login: 'marie', role: 'author', email: 'm@example.com', password: 'x' },
    },
    99
  );
  assert.equal(p.source, 'pupitre');
  assert.equal(p.kind, 'alert');
  assert.match(p.title, /suppression/);
  assert.match(p.body, /marie/);
  assert.match(p.body, /admin/);
  assert.equal(p.facts.login, 'marie');
  assert.equal(p.facts.password, undefined);
  assert.equal(p.fingerprint, 'pupitre:user.delete:99');
});

test('audience payload', () => {
  const p = audiencePayload({
    ok: true,
    fetchedAt: '2026-08-27T12:00:00Z',
    kpis: { views7: 10, views30: 40, concentrationPct: 50 },
    top: [{ title: 'Page A' }],
  });
  assert.equal(p.source, 'audience');
  assert.equal(p.kind, 'watch');
  assert.match(p.title, /10/);
  assert.match(p.body, /Page A/);
});

test('pousse l’envoi newsletter', () => {
  assert.equal(shouldPushNewsletter('newsletter.send'), true);
  assert.equal(shouldPushNewsletter('user.create'), false);
});

test('payload newsletter = chiffres seulement', () => {
  const p = newsletterPayload(
    {
      action: 'newsletter.send',
      actor: { login: 'admin' },
      targetId: 7,
      meta: {
        subject: 'Le matin du 31 août',
        date: '2026-08-31',
        total: 12,
        sent: 11,
        skipped: 0,
        errors: 1,
        dryRun: false,
      },
    },
    44
  );
  assert.equal(p.source, 'pupitre');
  assert.equal(p.kind, 'watch');
  assert.match(p.title, /11\/12/);
  assert.match(p.body, /Destinataires : 12/);
  assert.match(p.body, /Envoyés : 11/);
  assert.match(p.body, /Sautés : 0/);
  assert.match(p.body, /Erreurs : 1/);
  assert.equal(p.facts.status, 'sent');
  assert.equal(p.facts.sent, 11);
  assert.equal(p.facts.total, 12);
  assert.equal(p.fingerprint, 'pupitre:newsletter.send:44');
});

test('newsletter échouée = alerte', () => {
  const p = newsletterPayload(
    {
      action: 'newsletter.send',
      actor: { login: 'admin' },
      targetId: 8,
      meta: { subject: 'X', total: 3, sent: 0, skipped: 0, errors: 3 },
    },
    45
  );
  assert.equal(p.kind, 'alert');
  assert.equal(p.facts.status, 'failed');
});

test('newsletter essai à sec', () => {
  const p = newsletterPayload(
    {
      action: 'newsletter.send',
      actor: { login: 'admin' },
      targetId: 9,
      meta: { subject: 'X', total: 3, sent: 0, skipped: 3, errors: 0, dryRun: true },
    },
    46
  );
  assert.equal(p.kind, 'watch');
  assert.equal(p.facts.status, 'dry-run');
  assert.match(p.title, /essai/);
});

test('envoie le code secret si présent', async () => {
  const prev = process.env.INCIDENT_HUB_TOKEN;
  process.env.INCIDENT_HUB_TOKEN = 'probe-token';
  const seen = { token: '' };
  const orig = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    const h = opts?.headers || {};
    seen.token =
      typeof h.get === 'function'
        ? h.get('X-Incident-Token') || ''
        : h['X-Incident-Token'] || '';
    return { ok: true, status: 200 };
  };
  const mod = await import(`./vigie-ingress.mjs?probe=${Date.now()}`);
  try {
    const out = await mod.pushVigieEvent({
      source: 'pupitre',
      kind: 'watch',
      title: 'probe',
      body: 'x',
      drain: false,
    });
    assert.equal(out.ok, true);
    assert.equal(seen.token, 'probe-token');
  } finally {
    globalThis.fetch = orig;
    if (prev === undefined) delete process.env.INCIDENT_HUB_TOKEN;
    else process.env.INCIDENT_HUB_TOKEN = prev;
  }
});
