import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateXVariants } from './x-generate.mjs';

describe('x-generate', () => {
  it('falls back to 3 variants without assist', async () => {
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
    assert.equal(out.variants.length, 3);
    assert.match(
      out.variants[0],
      /https:\/\/electronlibre\.info\/articles\/42-test-article\//
    );
    assert.equal(out.source, 'fallback');
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
  });
});
