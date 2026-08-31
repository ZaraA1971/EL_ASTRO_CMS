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

  it('routes GET onesignal segments on the push plugin', () => {
    const push = EL_DESK_PLUGINS.find((p) => p.id === 'push');
    assert.ok(push.match(['api', 'desk', 'onesignal', 'segments'], { method: 'GET' }));
    assert.equal(
      push.match(['api', 'desk', 'onesignal', 'segments'], { method: 'POST' }),
      false
    );
    assert.ok(
      push.matchArticle(['api', 'desk', 'articles', '1', 'push'], { method: 'POST' })
    );
  });
});
