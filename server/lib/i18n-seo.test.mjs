import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveLang,
  chrome,
  pagePath,
  absoluteUrl,
  hreflang,
  pairHreflang,
} from '../../shared/i18n-seo.mjs';

describe('i18n-seo', () => {
  it('resolves lang', () => {
    assert.equal(resolveLang('en-GB'), 'en');
    assert.equal(resolveLang('fr'), 'fr');
    assert.equal(resolveLang(''), 'fr');
  });

  it('chrome by context', () => {
    assert.equal(chrome('login', 'en'), 'Log in');
    assert.equal(chrome('login', 'fr'), 'Connexion');
    assert.equal(chrome('articleLang', 'en'), 'Article language');
    assert.equal(chrome('subscribeCta', 'fr'), 'Je m’abonne');
  });

  it('pagePath by context', () => {
    assert.equal(pagePath('home', 'en'), '/en/');
    assert.equal(pagePath('home', 'fr', { page: 3 }), '/page/3/');
    assert.equal(pagePath('search', 'en'), '/en/search/');
    assert.equal(
      pagePath('category', 'en', { slug: 'musique', page: 2 }),
      '/en/articles/category/musique/page/2/'
    );
    assert.equal(
      pagePath('category', 'fr', { slug: 'musique' }),
      '/articles/category/musique/'
    );
    assert.equal(
      pagePath('tag', 'en', { slug: 'AI copyright' }),
      '/en/articles/tag/AI%20copyright/'
    );
  });

  it('hreflang home includes both + x-default FR', () => {
    const links = hreflang({ lang: 'en', path: '/en/' }, 'home');
    const by = Object.fromEntries(links.map((l) => [l.hreflang, l.href]));
    assert.equal(by.en, 'https://electronlibre.info/en/');
    assert.equal(by.fr, 'https://electronlibre.info/');
    assert.equal(by['x-default'], 'https://electronlibre.info/');
  });

  it('hreflang article only emits known langs', () => {
    const solo = hreflang({ lang: 'fr', path: '/articles/1-a/' }, 'article');
    assert.deepEqual(
      solo.map((l) => l.hreflang),
      ['fr', 'x-default']
    );
    const pair = hreflang(
      {
        lang: 'en',
        path: '/articles/2-b/',
        alternates: { fr: '/articles/1-a/', en: '/articles/2-b/' },
      },
      'article'
    );
    assert.equal(pair.length, 3);
    assert.ok(pair.some((l) => l.hreflang === 'en'));
    assert.ok(pair.some((l) => l.hreflang === 'fr'));
  });

  it('pairHreflang skips incomplete pairs', () => {
    assert.deepEqual(
      pairHreflang({ lang: 'en', selfPath: '/articles/2-b/' }),
      []
    );
    const links = pairHreflang({
      lang: 'en',
      selfPath: '/articles/2-b/',
      frPath: '/articles/1-a/',
      enPath: '/articles/2-b/',
    });
    assert.equal(links.length, 3);
    assert.equal(
      absoluteUrl('/articles/1-a/'),
      'https://electronlibre.info/articles/1-a/'
    );
  });
});
