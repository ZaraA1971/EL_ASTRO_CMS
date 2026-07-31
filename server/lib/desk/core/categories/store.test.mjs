import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCategoriesStore } from './store.mjs';

describe('createCategoriesStore', () => {
  it('rejects unsafe table names', () => {
    assert.throws(
      () => createCategoriesStore({ tableName: 'el;drop' }),
      /invalide/
    );
  });

  it('exposes bound tableName', () => {
    const store = createCategoriesStore({ tableName: 'cms_categories' });
    assert.equal(store.tableName, 'cms_categories');
  });
});
