import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLoginId,
  requestPasswordReset,
} from './password-reset.mjs';

function fakePool(user) {
  return {
    query: mock.fn(async (sql, params) => {
      const q = String(sql);
      if (q.includes('ADD COLUMN') || q.includes('CREATE INDEX')) {
        return [{}];
      }
      if (q.includes('SHOW COLUMNS')) {
        return [[{ Field: 'password_reset_token' }]];
      }
      if (q.includes('SELECT') && q.includes('FROM el_users')) {
        return [user ? [user] : []];
      }
      if (q.includes('UPDATE el_users')) {
        assert.ok(params?.[0], 'token stored');
        return [{ affectedRows: 1 }];
      }
      return [[]];
    }),
  };
}

describe('password-reset', () => {
  it('re-exports normalizeLoginId as a local binding', () => {
    assert.equal(normalizeLoginId('  Marie@EL.info  '), 'marie@el.info');
  });

  it('requestPasswordReset normalizes id without throwing', async () => {
    const pool = fakePool({
      id: 7,
      login: 'marie',
      email: 'marie@el.info',
      display_name: 'Marie',
      status: 'active',
    });
    const out = await requestPasswordReset(
      pool,
      '  Marie@EL.info  ',
      { dryRun: true },
      'https://electronlibre.info'
    );
    assert.equal(out.ok, true);
    assert.equal(out.sent, true);
    assert.equal(out.dryRun, true);
  });

  it('returns generic ok when account unknown', async () => {
    const pool = fakePool(null);
    const out = await requestPasswordReset(
      pool,
      'inconnu@example.com',
      { dryRun: true },
      'https://electronlibre.info'
    );
    assert.deepEqual(out, { ok: true, sent: false });
  });
});
