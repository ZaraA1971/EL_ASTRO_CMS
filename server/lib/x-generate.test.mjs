import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateXVariants,
  articleXLanguage,
  buildXPrompt,
} from './x-generate.mjs';

describe('x-generate', () => {
  it('falls back to 3 French variants without assist', async () => {
    const row = {
      article_id: 42,
      slug: 'test-article',
      title: 'Bruxelles serre la vis sur les plateformes',
      excerpt: 'La Commission prépare un nouveau train de mesures.',
      body: '<p>Corps</p>',
    };
    const out = await generateXVariants(row, {
      account: 'el',
      siteUrl: 'https://electronlibre.info',
      agentEditorial: {},
    });
    assert.equal(out.account, 'el');
    assert.equal(out.language, 'fr');
    assert.equal(out.variants.length, 3);
    assert.match(
      out.variants[0],
      /https:\/\/electronlibre\.info\/articles\/42-test-article\//
    );
    assert.match(out.variants[2], /de près/);
    assert.equal(out.source, 'fallback');
  });

  it('writes English hooks when the article is in English', async () => {
    const out = await generateXVariants(
      {
        article_id: 7,
        slug: 'platforms',
        title: 'Brussels tightens the rules',
        excerpt: 'The Commission is preparing a new set of measures.',
        lang: 'en',
        body: '',
      },
      { account: 'el', siteUrl: 'https://electronlibre.info' }
    );
    assert.equal(out.language, 'en');
    assert.match(out.variants[2], /A closer look/);
    assert.doesNotMatch(out.variants.join('\n'), /près|retenir|À lire/);
  });

  it('treats EN and en-GB as English', () => {
    assert.equal(articleXLanguage({ lang: 'EN' }), 'en');
    assert.equal(articleXLanguage({ lang: 'en-GB' }), 'en');
    assert.equal(articleXLanguage({}), 'fr');
  });

  it('asks the model to stay in the article language', () => {
    const fr = buildXPrompt('el', 'fr', '@3l3ctr0nLibr3');
    const en = buildXPrompt('bulletin', 'en', '@Bulletin_UE');
    assert.match(fr, /UNIQUEMENT en français/);
    assert.match(en, /ONLY in English/);
    assert.match(en, /European markets/);
  });

  it('uses bulletin account handle context', async () => {
    const out = await generateXVariants(
      {
        article_id: 1,
        slug: 'ue',
        title: 'DMA',
        excerpt: 'Sanctions',
        body: '',
      },
      { account: 'bulletin', siteUrl: 'https://electronlibre.info' }
    );
    assert.equal(out.account, 'bulletin');
    assert.equal(out.handle, '@Bulletin_UE');
    assert.equal(out.language, 'fr');
  });
});
