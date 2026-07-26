import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  issueIosJwt,
  verifyIosJwt,
  userIdFromPayload,
  iosJwtConfigured,
} from './jwt.mjs';
import { toIosArticleDto, sanitizeHtmlForIos } from './articles.mjs';

describe('ios jwt', () => {
  const cfg = {
    secret: 'test-secret-at-least-16b',
    ttlDays: 1,
    iss: 'https://electronlibre.info',
  };

  it('issues and verifies token with user id', () => {
    assert.equal(iosJwtConfigured(cfg), true);
    const token = issueIosJwt(42, cfg);
    const payload = verifyIosJwt(token, cfg);
    assert.equal(userIdFromPayload(payload), 42);
    assert.ok(payload.exp > payload.iat);
  });

  it('rejects bad signature', () => {
    const token = issueIosJwt(1, cfg);
    assert.throws(() =>
      verifyIosJwt(token, { ...cfg, secret: 'other-secret-16chars' })
    );
  });

  it('rejects mismatched iss (cross-env replay)', () => {
    const token = issueIosJwt(1, {
      ...cfg,
      iss: 'https://qualif.electronlibre.info',
    });
    assert.throws(
      () => verifyIosJwt(token, cfg),
      (err) => err.code === 'JWT_INVALID'
    );
  });
});

describe('ios article dto', () => {
  it('hides paywalled body when not entitled', () => {
    const dto = toIosArticleDto(
      {
        wp_id: 9,
        title: 'T',
        excerpt: 'E',
        body: '<p>secret</p>',
        access: 'subscribers',
        date: '2026-01-01 12:00:00',
        lang: 'fr',
      },
      { entitled: false, lang: 'FR' }
    );
    assert.equal(dto.content, '');
    assert.equal(dto.excerpt, 'E');
    assert.equal(dto.isPublic, false);
    assert.equal(dto.id, 9);
  });

  it('does not derive excerpt from paywalled body when not entitled', () => {
    const dto = toIosArticleDto(
      {
        wp_id: 10,
        title: 'T',
        excerpt: '',
        body: '<p>secret paywall body words that must not leak to anonymous clients at all ever</p>',
        access: 'subscribers',
        date: '2026-01-01 12:00:00',
      },
      { entitled: false }
    );
    assert.equal(dto.content, '');
    assert.equal(dto.excerpt, '');
  });

  it('may derive excerpt from body when public or entitled', () => {
    const dto = toIosArticleDto(
      {
        wp_id: 11,
        title: 'T',
        excerpt: '',
        body: '<p>Hello public world from body</p>',
        access: 'granted',
        date: '2026-01-01 12:00:00',
      },
      { entitled: false }
    );
    assert.match(dto.excerpt, /Hello public world/);
    assert.match(dto.content, /Hello public world/);
  });

  it('shows body when public or entitled', () => {
    const html = sanitizeHtmlForIos('<p>ok</p>');
    assert.match(html, /ok/);
    const pub = toIosArticleDto(
      {
        wp_id: 1,
        title: 'T',
        body: '<p>ok</p>',
        access: 'granted',
        date: new Date('2026-01-01T00:00:00Z'),
      },
      { entitled: false }
    );
    assert.match(pub.content, /ok/);
    assert.equal(pub.isPublic, true);
  });

  it('strips script and event handlers from iOS HTML', () => {
    const dirty =
      '<p onclick="alert(1)">x</p><script>alert(2)</script><a href="javascript:alert(3)">y</a>';
    const clean = sanitizeHtmlForIos(dirty);
    assert.doesNotMatch(clean, /<script/i);
    assert.doesNotMatch(clean, /onclick/i);
    assert.doesNotMatch(clean, /javascript:/i);
    assert.match(clean, />x</);
  });

  it('escapes plain-text HTML special chars', () => {
    const clean = sanitizeHtmlForIos('a < b & c');
    assert.match(clean, /&lt;/);
    assert.match(clean, /&amp;/);
    assert.doesNotMatch(clean, /a < b/);
  });
});
