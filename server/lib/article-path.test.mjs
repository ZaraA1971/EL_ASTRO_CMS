import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  articlePath,
  articleIdSlug,
  absoluteArticleUrl,
} from './article-path.mjs';
import { toMysqlDate, nowMysql } from './mysql-date.mjs';

describe('article-path', () => {
  it('builds relative path from id+slug or article shape', () => {
    assert.equal(articlePath(106665, 'geo'), '/articles/106665-geo/');
    assert.equal(
      articlePath({ article_id: 1, slug: 'a' }),
      '/articles/1-a/'
    );
    assert.equal(
      articlePath({ data: { article_id: 2, slug: 'b' } }),
      '/articles/2-b/'
    );
    assert.equal(articlePath(null), '');
    assert.equal(articleIdSlug(9, 'x'), '9-x');
  });

  it('builds absolute url when siteUrl given', () => {
    assert.equal(
      absoluteArticleUrl('https://electronlibre.info/', 1, 'a'),
      'https://electronlibre.info/articles/1-a/'
    );
    assert.equal(absoluteArticleUrl('', 1, 'a'), '/articles/1-a/');
  });
});

describe('mysql-date', () => {
  it('formats UTC datetime for MySQL', () => {
    assert.equal(
      toMysqlDate(new Date('2026-06-15T18:56:25.000Z')),
      '2026-06-15 18:56:25'
    );
    assert.equal(toMysqlDate(null), null);
    assert.match(nowMysql(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});
