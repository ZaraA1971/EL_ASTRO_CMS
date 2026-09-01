import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { newsSitemapXml, newsLang } from '../../shared/sitemap-news.mjs';

describe('news sitemap', () => {
  it('always emits at least one url when rows exist', () => {
    const xml = newsSitemapXml(
      [{ article_id: 1, slug: 'a', title: 'Titre', date: '2026-09-01T10:00:00Z', lang: 'fr' }],
      { locOf: () => 'https://electronlibre.info/articles/1-a/' }
    );
    assert.match(xml, /<urlset /);
    assert.match(xml, /<url>/);
    assert.match(xml, /<loc>https:\/\/electronlibre\.info\/articles\/1-a\/<\/loc>/);
    assert.match(xml, /<news:title>Titre<\/news:title>/);
  });

  it('skips rows without loc but keeps the others', () => {
    const xml = newsSitemapXml(
      [
        { title: 'x', lang: 'fr' },
        { title: 'Y', date: '2026-09-01T10:00:00Z', lang: 'en' },
      ],
      { locOf: (row) => (row.title === 'Y' ? 'https://example.com/y/' : '') }
    );
    assert.equal((xml.match(/<url>/g) || []).length, 1);
    assert.match(xml, /<news:language>en<\/news:language>/);
  });

  it('maps language', () => {
    assert.equal(newsLang('en-GB'), 'en');
    assert.equal(newsLang('fr'), 'fr');
  });
});
