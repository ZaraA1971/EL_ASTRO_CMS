import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { newsSitemapXml, newsLang, buildUrlset, buildSitemapIndex } from '../../shared/sitemap-news.mjs';
import { articleSitemapUrl, staticSitemapUrls } from '../../shared/sitemap-urls.mjs';

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

  it('builds a sitemap index', () => {
    const xml = buildSitemapIndex(['https://electronlibre.info/sitemap-pages.xml']);
    assert.match(xml, /<sitemapindex /);
    assert.match(xml, /sitemap-pages\.xml/);
  });

  it('emits xhtml alternates when links are present', () => {
    const xml = buildUrlset([
      {
        loc: 'https://electronlibre.info/articles/1-a/',
        lastmod: '2026-09-01T10:00:00Z',
        links: [
          { hreflang: 'fr', href: 'https://electronlibre.info/articles/1-a/' },
          { hreflang: 'en', href: 'https://electronlibre.info/articles/2-b/' },
          { hreflang: 'x-default', href: 'https://electronlibre.info/articles/1-a/' },
        ],
      },
    ]);
    assert.match(xml, /xmlns:xhtml=/);
    assert.match(xml, /hreflang="en"/);
    assert.match(xml, /hreflang="x-default"/);
  });

  it('builds static page urls with home + search pairs', () => {
    const urls = staticSitemapUrls();
    assert.ok(urls.some((u) => u.loc.endsWith('/en/')));
    assert.ok(urls.some((u) => u.loc.endsWith('/en/search/')));
    const home = urls.find((u) => u.loc === 'https://electronlibre.info/');
    assert.ok(home?.links?.some((l) => l.hreflang === 'en'));
  });

  it('pairs FR/EN in article sitemap entries', () => {
    const url = articleSitemapUrl({
      article_id: 2,
      slug: 'b',
      lang: 'en',
      date: '2026-09-01T10:00:00Z',
      translation_fr: 1,
      translation_fr_slug: 'a',
      translation_fr_draft: 0,
      translation_en: 2,
      translation_en_slug: 'b',
      translation_en_draft: 0,
    });
    assert.ok(url);
    assert.match(url.loc, /\/articles\/2-b\//);
    assert.equal(url.links.length, 3);
  });
});
