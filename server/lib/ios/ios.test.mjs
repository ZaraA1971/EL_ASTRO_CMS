import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  issueIosJwt,
  verifyIosJwt,
  userIdFromPayload,
  iosJwtConfigured,
  isSubscriberFromPayload,
} from './jwt.mjs';
import { canAccessPremium } from '../roles.mjs';
import { toIosArticleDto, sanitizeHtmlForIos } from './articles.mjs';

function decodeJwtPayload(token) {
  const mid = String(token).split('.')[1];
  const pad = mid.length % 4 === 0 ? '' : '='.repeat(4 - (mid.length % 4));
  return JSON.parse(
    Buffer.from(mid.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString(
      'utf8'
    )
  );
}

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
    assert.equal(payload.isSubscriber, false);
  });

  it('always embeds isSubscriber as a boolean (never omitted)', () => {
    for (const opts of [undefined, {}, { isSubscriber: false }, { isSubscriber: true }]) {
      const token = opts === undefined ? issueIosJwt(1, cfg) : issueIosJwt(1, cfg, opts);
      const raw = decodeJwtPayload(token);
      assert.ok(Object.hasOwn(raw, 'isSubscriber'));
      assert.equal(typeof raw.isSubscriber, 'boolean');
      assert.equal(raw.isSubscriber, opts?.isSubscriber === true);
    }
  });

  it('embeds isSubscriber claim from current eligibility', () => {
    const yes = verifyIosJwt(
      issueIosJwt(42, cfg, { isSubscriber: true }),
      cfg
    );
    assert.equal(yes.isSubscriber, true);
    assert.equal(isSubscriberFromPayload(yes), true);
    const no = verifyIosJwt(
      issueIosJwt(42, cfg, { isSubscriber: false }),
      cfg
    );
    assert.equal(no.isSubscriber, false);
    assert.equal(isSubscriberFromPayload(no), false);
  });

  it('maps Pupitre subscriber → true and other → false (same as entitled)', () => {
    const subscriber = { role: 'subscriber', status: 'active' };
    const other = { role: 'other', status: 'active' };
    assert.equal(canAccessPremium(subscriber), true);
    assert.equal(canAccessPremium(other), false);
    const tokSub = verifyIosJwt(
      issueIosJwt(7, cfg, { isSubscriber: canAccessPremium(subscriber) === true }),
      cfg
    );
    const tokOther = verifyIosJwt(
      issueIosJwt(8, cfg, { isSubscriber: canAccessPremium(other) === true }),
      cfg
    );
    assert.equal(tokSub.isSubscriber, true);
    assert.equal(tokOther.isSubscriber, false);
    // entitled === isSubscriber
    assert.equal(canAccessPremium(subscriber), tokSub.isSubscriber);
    assert.equal(canAccessPremium(other), tokOther.isSubscriber);
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
        article_id: 9,
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
        article_id: 10,
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
        article_id: 11,
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
        article_id: 1,
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

  it('treats unknown access as paywalled (isPublic false)', () => {
    const dto = toIosArticleDto(
      {
        article_id: 3,
        title: 'T',
        body: '<p>secret</p>',
        access: 'weird',
        date: '2026-01-01T12:00:00.000Z',
      },
      { entitled: false }
    );
    assert.equal(dto.isPublic, false);
    assert.equal(dto.content, '');
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

  it('strips inline color styles for dark mode', () => {
    const dirty =
      '<p style="color: rgb(0, 0, 0); font-family: arial; text-align: center">x</p>';
    const clean = sanitizeHtmlForIos(dirty);
    assert.doesNotMatch(clean, /color:/i);
    assert.doesNotMatch(clean, /font-family/i);
    assert.match(clean, /text-align:\s*center/i);
    assert.match(clean, />x</);
  });

  it('escapes plain-text HTML special chars', () => {
    const clean = sanitizeHtmlForIos('a < b & c');
    assert.match(clean, /&lt;/);
    assert.match(clean, /&amp;/);
    assert.doesNotMatch(clean, /a < b/);
  });

  it('adds updated when modified is meaningfully after date', () => {
    const dto = toIosArticleDto(
      {
        article_id: 106665,
        title: 'Notre service GEO est disponible',
        body: '<p>x</p>',
        access: 'granted',
        date: '2026-06-15T18:56:25.000Z',
        modified: '2026-06-26T12:59:00.000Z',
        lang: 'fr',
      },
      { entitled: false, lang: 'FR' }
    );
    assert.equal(dto.date, '2026-06-15T18:56:25.000Z');
    assert.equal(dto.updated, '2026-06-26T12:59:00.000Z');
    assert.ok(new Date(dto.updated).getTime() > new Date(dto.date).getTime());
  });

  it('omits updated when never edited or within 45 min grace', () => {
    const never = toIosArticleDto(
      {
        article_id: 1,
        title: 'T',
        body: '<p>x</p>',
        access: 'granted',
        date: '2026-01-01T12:00:00.000Z',
      },
      { entitled: false }
    );
    assert.equal(never.date, '2026-01-01T12:00:00.000Z');
    assert.equal(Object.hasOwn(never, 'updated'), false);

    const grace = toIosArticleDto(
      {
        article_id: 2,
        title: 'T',
        body: '<p>x</p>',
        access: 'granted',
        date: '2026-01-01T12:00:00.000Z',
        modified: '2026-01-01T12:30:00.000Z',
      },
      { entitled: false }
    );
    assert.equal(Object.hasOwn(grace, 'updated'), false);
  });
});
