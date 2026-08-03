import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonArray, parseRowDate, rowToArticle } from './article-row.mjs';

describe('article-row', () => {
  it('parseJsonArray handles arrays strings and junk', () => {
    assert.deepEqual(parseJsonArray(['a', 1]), ['a', '1']);
    assert.deepEqual(parseJsonArray('["x","y"]'), ['x', 'y']);
    assert.deepEqual(parseJsonArray('nope'), []);
    assert.deepEqual(parseJsonArray(null), []);
  });

  it('rowToArticle maps MySQL row', () => {
    const a = rowToArticle(
      {
        article_id: 9,
        title: 'T',
        slug: 't',
        date: '2026-01-01T12:00:00.000Z',
        modified: '2026-01-02T12:00:00.000Z',
        author: 'EL',
        categories: '["gaming"]',
        category_names: '["Gaming"]',
        tags: '[]',
        ia_keywords: '["Meta"]',
        access: 'granted',
        lang: 'FR',
        excerpt: 'E',
        draft: 0,
        body: '<p>x</p>',
      },
      { includeBody: true }
    );
    assert.equal(a.id, 'db-9');
    assert.equal(a.data.article_id, 9);
    assert.equal(a.data.access, 'granted');
    assert.deepEqual(a.data.categories, ['gaming']);
    assert.deepEqual(a.data.ia_keywords, ['Meta']);
    assert.equal(a.body, '<p>x</p>');
    assert.ok(a.data.date instanceof Date);
    assert.ok(a.data.modified instanceof Date);
    assert.equal(rowToArticle(null), null);
    assert.equal(parseRowDate(''), null);
  });
});
