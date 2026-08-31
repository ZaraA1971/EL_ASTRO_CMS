import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountPayload, audiencePayload, shouldPushAccount } from './vigie-ingress.mjs';

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
