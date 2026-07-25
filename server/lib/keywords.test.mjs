import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildKeywordSource,
  normalizeKeywords,
  stripHtmlToText,
} from './keywords.mjs';

describe('stripHtmlToText', () => {
  it('strips tags and keeps text', () => {
    assert.equal(
      stripHtmlToText('<p>Hello <strong>world</strong></p>'),
      'Hello world'
    );
  });
});

describe('normalizeKeywords', () => {
  it('dedupes, cleans, drops themes and long phrases', () => {
    assert.deepEqual(
      normalizeKeywords([
        '• Meta',
        'meta',
        'Union européenne.',
        'trop générique pour être un mot clé vraiment',
        'a',
        'TikTok',
        'innovation',
        'réseaux sociaux',
        'Mark Zuckerberg',
      ]),
      ['Meta', 'Union européenne', 'TikTok', 'Mark Zuckerberg']
    );
  });
});

describe('buildKeywordSource', () => {
  it('includes title excerpt body and clamps lang', () => {
    const { content, language } = buildKeywordSource({
      title: 'Titre test',
      excerpt: 'Chapô',
      body: '<p>Corps</p>',
      lang: 'en-GB',
    });
    assert.equal(language, 'en');
    assert.match(content, /Titre test/);
    assert.match(content, /Chapô/);
    assert.match(content, /Corps/);
  });
});
