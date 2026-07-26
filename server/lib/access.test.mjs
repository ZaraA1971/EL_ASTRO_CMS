import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AccessError,
  assertAuthenticated,
  assertEntitled,
  resolveAccess,
  toEntitledSession,
} from './access.mjs';
import { issueIosJwt } from './ios/jwt.mjs';

const jwtCfg = {
  secret: 'test-secret-at-least-16b',
  ttlDays: 1,
  iss: 'https://electronlibre.info',
};

function mockPool(userById) {
  return {
    async query(sql, params) {
      if (/WHERE id = \?/.test(sql)) {
        const u = userById(Number(params[0]));
        return [[u].filter(Boolean)];
      }
      return [[]];
    },
  };
}

function reqWith(headers = {}) {
  return { headers };
}

describe('resolveAccess', () => {
  const entitledUser = {
    id: 7,
    login: 'abo',
    email: 'a@b.c',
    display_name: 'Abo',
    role: 'subscriber',
    status: 'active',
    access_until: '2099-01-01',
  };

  it('resolves Bearer JWT to entitled user', async () => {
    const token = issueIosJwt(7, jwtCfg);
    const access = await resolveAccess(
      reqWith({ authorization: `Bearer ${token}` }),
      {
        pool: mockPool((id) => (id === 7 ? entitledUser : null)),
        jwtCfg,
      }
    );
    assert.equal(access.auth, 'bearer');
    assert.equal(access.entitled, true);
    assert.equal(access.user.id, 7);
  });

  it('falls back to cookie when Bearer is invalid', async () => {
    const access = await resolveAccess(
      reqWith({ authorization: 'Bearer not.a.jwt' }),
      {
        pool: mockPool((id) => (id === 3 ? { ...entitledUser, id: 3 } : null)),
        readSession: () => ({ uid: 3, login: 'cookie' }),
        jwtCfg,
      }
    );
    assert.equal(access.auth, 'cookie');
    assert.equal(access.user.id, 3);
    assert.equal(access.bearerInvalid, false);
  });

  it('marks bearerInvalid when token bad and no cookie', async () => {
    const access = await resolveAccess(
      reqWith({ authorization: 'Bearer not.a.jwt' }),
      { pool: mockPool(() => null), jwtCfg }
    );
    assert.equal(access.auth, null);
    assert.equal(access.bearerInvalid, true);
  });
});

describe('assertEntitled / toEntitledSession', () => {
  it('throws 403 when authenticated but not entitled', () => {
    assert.throws(
      () =>
        assertEntitled({
          user: { id: 1 },
          entitled: false,
          bearerInvalid: false,
        }),
      (e) => e instanceof AccessError && e.status === 403
    );
  });

  it('assertAuthenticated rejects bearerInvalid', () => {
    assert.throws(
      () => assertAuthenticated({ user: null, bearerInvalid: true }),
      (e) => e instanceof AccessError && e.code === 'JWT_INVALID'
    );
  });

  it('toEntitledSession maps access for web compat', () => {
    const mapped = toEntitledSession({
      user: { id: 2, login: 'x', display_name: 'X', role: 'admin' },
      entitled: true,
      session: null,
    });
    assert.equal(mapped.entitled, true);
    assert.equal(mapped.session.uid, 2);
  });
});
