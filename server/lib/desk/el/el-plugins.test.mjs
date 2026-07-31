import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElDeskRegistry, EL_DESK_PLUGINS } from './el-plugins.mjs';

describe('createElDeskRegistry', () => {
  it('registers default EL plugins', () => {
    const reg = createElDeskRegistry(undefined);
    assert.deepEqual(
      reg.ids().sort(),
      EL_DESK_PLUGINS.map((p) => p.id).sort()
    );
  });

  it('honours DESK_PLUGINS empty', () => {
    const reg = createElDeskRegistry('');
    assert.deepEqual(reg.ids(), []);
  });
});
