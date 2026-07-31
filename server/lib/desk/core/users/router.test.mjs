/**
 * Tests sécurité handleCoreUsers — mocks, sans MySQL ni hash WP réel.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleCoreUsers } from './router.mjs';

function mockRes() {
  return {
    status: null,
    body: null,
    sendJson(_res, status, body) {
      this.status = status;
      this.body = body;
    },
  };
}

function basePolicy(overrides = {}) {
  return {
    ROLES: {
      ADMIN: 'admin',
      EDITOR: 'editor',
      AUTHOR: 'author',
      SUBSCRIBER: 'subscriber',
      OTHER: 'other',
    },
    STATUSES: { ACTIVE: 'active', DISABLED: 'disabled', EXPIRED: 'expired' },
    canManageUsers: (r) => r === 'admin' || r === 'editor',
    canMutateUser: (actor, target) => {
      if (actor !== 'admin' && actor !== 'editor') return false;
      if (target === 'admin' && actor !== 'admin') return false;
      return true;
    },
    allowedRolesForActor: (r) =>
      r === 'admin'
        ? ['admin', 'editor', 'author', 'subscriber', 'other']
        : ['author', 'subscriber', 'other'],
    isAdmin: (r) => r === 'admin',
    normalizeRole: (r) => String(r || 'other').toLowerCase(),
    isStaffRole: (r) => ['admin', 'editor', 'author'].includes(r),
    hashPassword: (p) => {
      if (!p || String(p).length < 8) throw new Error('weak');
      return `hash:${p}`;
    },
    generateTempPassword: () => 'TempPass99xxxx',
    rowToDeskUser: (row) =>
      row
        ? {
            id: row.id,
            login: row.login,
            role: row.role,
            status: row.status,
          }
        : null,
    effectiveStatus: (row) => row.status,
    adminRoles: ['admin'],
    ...overrides,
  };
}

function mockStore(existing = null) {
  return {
    list: async () => [],
    count: async () => 0,
    findById: async () => existing,
    findDupLoginOrEmail: async () => null,
    nextId: async () => 900001,
    insert: async () => existing,
    update: async () => existing,
    updatePassword: async (_p, id, hash) => ({ ...existing, password_hash: hash }),
    remove: async () => {},
    countActiveAdmins: async () => 1,
  };
}

describe('handleCoreUsers security', () => {
  it('returns false for non-users routes', async () => {
    const ok = await handleCoreUsers({}, {}, ['api', 'desk', 'me'], {});
    assert.equal(ok, false);
  });

  it('500 if userPolicy incomplete', async () => {
    const res = mockRes();
    const handled = await handleCoreUsers(
      { method: 'GET' },
      res,
      ['api', 'desk', 'users'],
      {
        sendJson: (r, s, b) => res.sendJson(r, s, b),
        session: { role: 'admin', uid: 1 },
        usersStore: mockStore(),
        userPolicy: { canManageUsers: () => true },
      }
    );
    assert.equal(handled, true);
    assert.equal(res.status, 500);
    assert.match(res.body.error, /userPolicy/);
  });

  it('403 when session cannot manage users', async () => {
    const res = mockRes();
    await handleCoreUsers(
      { method: 'GET', url: '/api/desk/users', headers: { host: 'x' } },
      res,
      ['api', 'desk', 'users'],
      {
        sendJson: (r, s, b) => res.sendJson(r, s, b),
        session: { role: 'author', uid: 2 },
        usersStore: mockStore(),
        userPolicy: basePolicy(),
        pool: {},
      }
    );
    assert.equal(res.status, 403);
  });

  it('403 when editor cannot mutate admin', async () => {
    const res = mockRes();
    await handleCoreUsers(
      { method: 'GET' },
      res,
      ['api', 'desk', 'users', '9'],
      {
        sendJson: (r, s, b) => res.sendJson(r, s, b),
        session: { role: 'editor', uid: 2 },
        usersStore: mockStore({
          id: 9,
          login: 'boss',
          role: 'admin',
          status: 'active',
        }),
        userPolicy: basePolicy(),
        pool: {},
      }
    );
    assert.equal(res.status, 403);
    assert.match(res.body.error, /Pas le droit/);
  });

  it('400 cannot delete own account', async () => {
    const res = mockRes();
    await handleCoreUsers(
      { method: 'DELETE' },
      res,
      ['api', 'desk', 'users', '2'],
      {
        sendJson: (r, s, b) => res.sendJson(r, s, b),
        session: { role: 'admin', uid: 2, login: 'me' },
        usersStore: mockStore({
          id: 2,
          login: 'me',
          role: 'admin',
          status: 'active',
        }),
        userPolicy: basePolicy(),
        pool: {},
      }
    );
    assert.equal(res.status, 400);
    assert.match(res.body.error, /propre compte/);
  });

  it('400 cannot delete last active admin', async () => {
    const res = mockRes();
    await handleCoreUsers(
      { method: 'DELETE' },
      res,
      ['api', 'desk', 'users', '9'],
      {
        sendJson: (r, s, b) => res.sendJson(r, s, b),
        session: { role: 'admin', uid: 1, login: 'a' },
        usersStore: {
          ...mockStore({
            id: 9,
            login: 'other',
            role: 'admin',
            status: 'active',
          }),
          countActiveAdmins: async () => 1,
        },
        userPolicy: basePolicy(),
        pool: {},
      }
    );
    assert.equal(res.status, 400);
    assert.match(res.body.error, /dernier administrateur/);
  });

  it('password reset returns one-shot plaintext once', async () => {
    const res = mockRes();
    const existing = {
      id: 5,
      login: 'u',
      role: 'subscriber',
      status: 'active',
      password_hash: 'old',
    };
    await handleCoreUsers(
      { method: 'POST' },
      res,
      ['api', 'desk', 'users', '5', 'password'],
      {
        sendJson: (r, s, b) => res.sendJson(r, s, b),
        session: { role: 'admin', uid: 1, login: 'a' },
        usersStore: mockStore(existing),
        userPolicy: basePolicy(),
        pool: {},
      }
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.password, 'TempPass99xxxx');
    assert.equal(res.body.user.login, 'u');
    assert.ok(!String(JSON.stringify(res.body)).includes('hash:Temp'));
  });
});
