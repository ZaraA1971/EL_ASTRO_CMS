import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tryHandleCoreCrud } from './crud.mjs';

describe('tryHandleCoreCrud', () => {
  it('returns false for non-crud routes', async () => {
    const handled = await tryHandleCoreCrud(
      {},
      {},
      ['api', 'desk', 'me'],
      {}
    );
    assert.equal(handled, false);
  });
});
