import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createArticleHelpers,
  slugify,
  asJson,
  PLACEHOLDER_SLUGS,
} from './article-helpers.mjs';

describe('article-helpers portable', () => {
  it('slugify strips accents and punct', () => {
    assert.equal(slugify('Été 2026 !'), 'ete-2026');
  });

  it('asJson normalizes arrays', () => {
    assert.equal(asJson(['a', 'b']), '["a","b"]');
    assert.equal(asJson(null), '[]');
  });

  it('requires access predicates', () => {
    assert.throws(() => createArticleHelpers({ tableName: 'articles' }), /requis/);
  });

  it('rejects unsafe table names', () => {
    assert.throws(
      () =>
        createArticleHelpers({
          tableName: 'cms_articles; drop',
          canAccessDesk: () => true,
          canEditAll: () => true,
        }),
      /invalide/
    );
  });

  it('canEditArticle uses injected predicates', () => {
    const { canEditArticle } = createArticleHelpers({
      tableName: 'cms_articles',
      canAccessDesk: (r) => r === 'editor' || r === 'admin',
      canEditAll: (r) => r === 'admin',
    });
    assert.equal(
      canEditArticle({ role: 'admin', uid: 1 }, { author_user_id: 9 }),
      true
    );
    assert.equal(
      canEditArticle({ role: 'editor', uid: 2 }, { author_user_id: 2 }),
      true
    );
    assert.equal(
      canEditArticle({ role: 'editor', uid: 2 }, { author_user_id: 9 }),
      false
    );
    assert.equal(
      canEditArticle({ role: 'subscriber', uid: 2 }, { author_user_id: 2 }),
      false
    );
  });

  it('exposes placeholder slugs', () => {
    assert.equal(PLACEHOLDER_SLUGS.has('nouvel-article'), true);
  });
});
