import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hrefFrom, safeHref, hrefFromHtml } from './paste-link.mjs';

describe('paste-link / hrefFrom', () => {
  it('accepts https from clipboard plain', () => {
    assert.equal(
      hrefFrom('https://electronlibre.info/articles/1-foo/', 'clipboard'),
      'https://electronlibre.info/articles/1-foo/'
    );
  });

  it('accepts www. as https', () => {
    assert.equal(
      hrefFrom('www.example.com/x', 'clipboard'),
      'https://www.example.com/x'
    );
  });

  it('accepts relative article path', () => {
    assert.equal(
      hrefFrom('/articles/12-titre/', 'clipboard'),
      '/articles/12-titre/'
    );
  });

  it('accepts mailto', () => {
    assert.equal(hrefFrom('mailto:info@electronlibre.info', 'clipboard'), 'mailto:info@electronlibre.info');
  });

  it('accepts hash fragment', () => {
    assert.equal(hrefFrom('#sources', 'clipboard'), '#sources');
  });

  it('unwraps <url> and quotes', () => {
    assert.equal(
      hrefFrom('<https://example.com/a>', 'clipboard'),
      'https://example.com/a'
    );
    assert.equal(
      hrefFrom('"https://example.com/a"', 'clipboard'),
      'https://example.com/a'
    );
  });

  it('rejects dangerous schemes', () => {
    assert.equal(hrefFrom('javascript:alert(1)', 'clipboard'), '');
    assert.equal(hrefFrom('data:text/html,x', 'clipboard'), '');
    assert.equal(hrefFrom('vbscript:msg', 'prompt'), '');
    assert.equal(hrefFrom('file:///etc/passwd', 'clipboard'), '');
    assert.equal(safeHref('//evil.example/phish'), '');
  });

  it('rejects credentials in http(s) urls', () => {
    assert.equal(hrefFrom('https://user:pass@example.com/', 'clipboard'), '');
  });

  it('rejects sentences and multiline', () => {
    assert.equal(hrefFrom('voir https://example.com plus tard', 'clipboard'), '');
    assert.equal(hrefFrom('https://a.com\nhttps://b.com', 'clipboard'), '');
    assert.equal(hrefFrom('notes.md', 'clipboard'), '');
  });

  it('does not infer bare host on clipboard', () => {
    assert.equal(hrefFrom('electronlibre.info', 'clipboard'), '');
  });

  it('infers https for bare host on prompt', () => {
    assert.equal(
      hrefFrom('electronlibre.info/desk/', 'prompt'),
      'https://electronlibre.info/desk/'
    );
  });

  it('extracts href from a single copied link', () => {
    const html = `<!--StartFragment--><a href="https://www.lemonde.fr/foo/">Titre</a><!--EndFragment-->`;
    assert.equal(
      hrefFrom({ plain: 'Titre', html }, 'clipboard'),
      'https://www.lemonde.fr/foo/'
    );
  });

  it('extracts href from Word-wrapped single link', () => {
    const html = `<html><body><!--StartFragment--><p class="MsoNormal"><a href="https://example.com/x">x</a></p><!--EndFragment--></body></html>`;
    assert.equal(hrefFromHtml(html), 'https://example.com/x');
  });

  it('rejects html with surrounding text or several links', () => {
    assert.equal(
      hrefFromHtml('<p>Voir <a href="https://example.com/a">a</a></p>'),
      ''
    );
    assert.equal(
      hrefFromHtml(
        '<a href="https://example.com/a">a</a> <a href="https://example.com/b">b</a>'
      ),
      ''
    );
  });

  it('prefers plain url over html label', () => {
    assert.equal(
      hrefFrom(
        {
          plain: 'https://example.com/plain',
          html: '<a href="https://example.com/html">https://example.com/plain</a>',
        },
        'clipboard'
      ),
      'https://example.com/plain'
    );
  });

  it('rejects unknown context', () => {
    assert.throws(() => hrefFrom('https://x.com', 'hero'), /contexte inconnu/);
  });

  it('accepts suno-style url and address-bar html without <a>', () => {
    assert.equal(
      hrefFrom('https://suno.com/home', 'clipboard'),
      'https://suno.com/home'
    );
    assert.equal(
      hrefFrom(
        {
          plain: '',
          html: '<html><body><!--StartFragment-->https://suno.com/home<!--EndFragment--></body></html>',
        },
        'clipboard'
      ),
      'https://suno.com/home'
    );
  });

  it('reads text/uri-list and strips BOM / trailing newline', () => {
    assert.equal(
      hrefFrom({ plain: '', uriList: '#\nhttps://suno.com/home\n' }, 'clipboard'),
      'https://suno.com/home'
    );
    assert.equal(
      hrefFrom('\uFEFFhttps://suno.com/home\n', 'clipboard'),
      'https://suno.com/home'
    );
  });
});
