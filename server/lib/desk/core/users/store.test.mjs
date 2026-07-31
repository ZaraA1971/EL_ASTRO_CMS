import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createUsersStore } from './store.mjs';

describe('createUsersStore', () => {
  it('rejects unsafe table names', () => {
    assert.throws(() => createUsersStore({ tableName: 'u;drop' }), /invalide/);
  });

  it('binds table and id floor', () => {
    const store = createUsersStore({ tableName: 'cms_users', idFloor: 100 });
    assert.equal(store.tableName, 'cms_users');
  });
});
