import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPluginRegistry,
  resolveEnabledPluginIds,
} from './plugin-registry.mjs';
import { createElDeskRegistry, EL_DESK_PLUGINS } from './el-plugins.mjs';

describe('plugin-registry', () => {
  it('merges plugin caps onto core caps', () => {
    const reg = createPluginRegistry([
      {
        id: 'demo',
        caps() {
          return { newsletter: true, demoFlag: 1 };
        },
      },
    ]);
    const caps = reg.mergeCaps({ media: true, publish: true }, {}, { role: 'editor' });
    assert.equal(caps.media, true);
    assert.equal(caps.newsletter, true);
    assert.equal(caps.demoFlag, 1);
  });

  it('dispatches matching top-level routes', async () => {
    let hit = false;
    const reg = createPluginRegistry([
      {
        id: 'newsletter',
        match(parts) {
          return parts[2] === 'newsletter';
        },
        handle() {
          hit = true;
        },
      },
    ]);
    const handled = await reg.tryHandle(
      {},
      {},
      ['api', 'desk', 'newsletter'],
      {}
    );
    assert.equal(handled, true);
    assert.equal(hit, true);
    assert.equal(
      await reg.tryHandle({}, {}, ['api', 'desk', 'media'], {}),
      false
    );
  });

  it('dispatches article subroutes', async () => {
    let articleId = null;
    const reg = createPluginRegistry([
      {
        id: 'x',
        matchArticle(parts) {
          return parts[4] === 'x';
        },
        handleArticle(_req, _res, _parts, _ctx, article) {
          articleId = article.article_id;
        },
      },
    ]);
    const ok = await reg.tryHandleArticle(
      {},
      {},
      ['api', 'desk', 'articles', '42', 'x'],
      {},
      { article_id: 42 }
    );
    assert.equal(ok, true);
    assert.equal(articleId, 42);
  });
});

describe('resolveEnabledPluginIds', () => {
  const all = ['newsletter', 'audience', 'x', 'push'];

  it('defaults to all when env unset', () => {
    assert.deepEqual(resolveEnabledPluginIds(undefined, all), all);
  });

  it('disables all when env empty', () => {
    assert.deepEqual(resolveEnabledPluginIds('', all), []);
    assert.deepEqual(resolveEnabledPluginIds('  ', all), []);
  });

  it('filters csv', () => {
    assert.deepEqual(resolveEnabledPluginIds('newsletter,x', all), [
      'newsletter',
      'x',
    ]);
  });
});

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
