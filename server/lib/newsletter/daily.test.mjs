import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDynamicSubtitle,
  normalizeKeyword,
  previousBusinessDay,
  sortNewsletterArticles,
  trimWords,
  articleExcerptFromBody,
  dayBoundsParis,
  injectUnsubscribe,
} from './daily.mjs';
import { normalizeGroups, DEFAULT_GROUPS } from './recipients.mjs';

describe('newsletter daily helpers', () => {
  it('previousBusinessDay skips weekend from Monday', () => {
    // 2026-07-20 is a Monday
    assert.equal(previousBusinessDay('2026-07-20'), '2026-07-17');
    assert.equal(previousBusinessDay('2026-07-21'), '2026-07-20');
  });

  it('dayBoundsParis', () => {
    const b = dayBoundsParis('2026-07-15');
    assert.equal(b.start, '2026-07-15 00:00:00');
    assert.equal(b.end, '2026-07-15 23:59:59');
    assert.equal(b.display, '15/07/2026');
  });

  it('sorts editorial (tags) before briefs', () => {
    const sorted = sortNewsletterArticles([
      { tags: [], date: '2026-07-15T10:00:00Z', title: 'Brief' },
      { tags: ['oracle'], date: '2026-07-15T09:00:00Z', title: 'Long' },
      { tags: ['meta'], date: '2026-07-15T11:00:00Z', title: 'Long2' },
    ]);
    assert.equal(sorted[0].title, 'Long');
    assert.equal(sorted[1].title, 'Long2');
    assert.equal(sorted[2].title, 'Brief');
  });

  it('builds subtitle from tags ignoring stop words', () => {
    const sub = buildDynamicSubtitle([
      { tags: ['ia', 'Oracle', 'Mark Hura'] },
      { tags: ['robotic'] },
    ]);
    assert.match(sub, /Oracle/);
    assert.match(sub, /Mark Hura/);
    assert.doesNotMatch(sub, /\bIa\b/);
  });

  it('trimWords / excerpt', () => {
    assert.equal(trimWords('a b c d', 2), 'a b…');
    assert.equal(
      articleExcerptFromBody('<p>Hello <strong>world</strong> again</p>', 2),
      'Hello world…'
    );
  });

  it('normalizeKeyword', () => {
    assert.equal(normalizeKeyword('Économie!'), 'economie');
  });

  it('injectUnsubscribe', () => {
    const html = injectUnsubscribe(
      '<a href="__UNSUBSCRIBE_URL__">x</a>',
      'https://example.com/u?token=abc'
    );
    assert.match(html, /https:\/\/example\.com\/u\?token=abc/);
  });
});

describe('newsletter groups', () => {
  it('defaults and normalizes', () => {
    assert.deepEqual(normalizeGroups([]), DEFAULT_GROUPS);
    assert.deepEqual(normalizeGroups([], { fallback: [] }), []);
    assert.deepEqual(normalizeGroups('admin,abonnes,hack'), [
      'admin',
      'abonnes',
    ]);
  });
});
