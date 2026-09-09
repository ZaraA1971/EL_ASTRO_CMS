import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasRealArticleTitle,
  isMissingArticleTitle,
  articleTitlePublishError,
} from './article-title.mjs';

describe('article-title', () => {
  it('treats empty and placeholder titles as missing', () => {
    assert.equal(isMissingArticleTitle(''), true);
    assert.equal(isMissingArticleTitle('   '), true);
    assert.equal(isMissingArticleTitle('Nouvel article'), true);
    assert.equal(isMissingArticleTitle('Sans titre'), true);
    assert.equal(isMissingArticleTitle('NEW ARTICLE'), true);
  });

  it('accepts a real editorial title', () => {
    assert.equal(hasRealArticleTitle('Le message laissé par Kadrey'), true);
    assert.equal(hasRealArticleTitle('  Diversité  '), true);
  });

  it('returns a publish error message for missing titles', () => {
    assert.match(
      articleTitlePublishError('Nouvel article'),
      /titre/i
    );
    assert.equal(articleTitlePublishError('Mon titre'), null);
  });
});
