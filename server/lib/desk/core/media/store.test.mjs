import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMediaStore } from './store.mjs';

describe('createMediaStore', () => {
  it('rejects unsafe table names', () => {
    assert.throws(() => createMediaStore({ tableName: 'x;y' }), /invalide/);
  });

  it('binds tableName', () => {
    const store = createMediaStore({ tableName: 'cms_media' });
    assert.equal(store.tableName, 'cms_media');
  });
});
