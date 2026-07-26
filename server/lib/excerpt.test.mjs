import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  chapo,
  stripLeadingChapoHtml,
  EXCERPT_CONTEXTS,
} from './excerpt.mjs';

describe('excerpt / chapo', () => {
  it('strips leading bold chapô', () => {
    const html =
      '<p><strong>Chapô éditorial ici.</strong></p><p>Suite du texte longue.</p>';
    assert.equal(
      stripLeadingChapoHtml(html).includes('Chapô éditorial'),
      false
    );
    assert.match(stripLeadingChapoHtml(html), /Suite du texte/);
  });

  it('store derives from body, not leading chapô', () => {
    const body =
      '<p><strong>Accroche courte.</strong></p>' +
      `<p>${'mot '.repeat(200)}</p>`;
    const ex = chapo(body, 'store');
    assert.ok(ex.length > 50);
    assert.doesNotMatch(ex, /Accroche courte/);
    assert.match(ex, /^mot /);
  });

  it('contexts expose expected word counts', () => {
    assert.equal(EXCERPT_CONTEXTS.hero.words, 130);
    assert.equal(EXCERPT_CONTEXTS.card.words, 28);
    assert.equal(EXCERPT_CONTEXTS.related.words, 32);
  });

  it('hero extends short excerpt from body to 130 words', () => {
    const words = Array.from({ length: 200 }, (_, i) => `w${i}`).join(' ');
    const out = chapo(
      { excerpt: 'w0 w1 w2', body: `<p>${words}</p>` },
      'hero'
    );
    assert.equal(out.replace(/…$/, '').split(/\s+/).filter(Boolean).length, 130);
  });

  it('reads hydrated body when top-level body is empty string', () => {
    const words = Array.from({ length: 200 }, (_, i) => `w${i}`).join(' ');
    const out = chapo(
      {
        body: '',
        data: { excerpt: 'w0 w1 w2', body: `<p>${words}</p>` },
      },
      'hero'
    );
    assert.equal(out.replace(/…$/, '').split(/\s+/).filter(Boolean).length, 130);
  });

  it('ios does not leak paywalled body', () => {
    const paid = { excerpt: '', body: '<p>secret paywalled content here</p>' };
    assert.equal(chapo(paid, 'ios', { entitled: false }), '');
    assert.match(chapo(paid, 'ios', { entitled: true }), /secret paywalled/);
  });

  it('card / related / store / unknown', () => {
    const words = Array.from({ length: 200 }, (_, i) => `w${i}`).join(' ');
    const article = { excerpt: words, body: `<p>${words}</p>` };
    assert.equal(
      chapo(article, 'card').replace(/…$/, '').split(/\s+/).length,
      28
    );
    assert.equal(
      chapo(article, 'related').replace(/…$/, '').split(/\s+/).length,
      32
    );
    const stored = chapo(`<p>${'x '.repeat(400)}</p>`, 'store');
    assert.ok(stored.length >= 120);
    assert.ok(stored.length <= 421);
    assert.throws(() => chapo(article, 'unknown'), /contexte inconnu/);
  });
});
