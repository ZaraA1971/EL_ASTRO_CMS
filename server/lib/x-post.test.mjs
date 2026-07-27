import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  percentEncode,
  buildOAuth1Header,
  xWeightedLength,
  assertXText,
  X_MAX_LENGTH,
} from './x-post.mjs';
import {
  normalizeXAccount,
  DEFAULT_X_ACCOUNT,
  getXAccountCredentials,
  listXAccountsPublic,
} from './x-accounts.mjs';

describe('x-accounts', () => {
  it('normalizes accounts', () => {
    assert.equal(normalizeXAccount('el'), 'el');
    assert.equal(normalizeXAccount('BULLETIN'), 'bulletin');
    assert.equal(normalizeXAccount('nope'), null);
    assert.equal(DEFAULT_X_ACCOUNT, 'el');
  });

  it('detects credentials', () => {
    const env = {
      X_EL_API_KEY: 'k',
      X_EL_API_SECRET: 's',
      X_EL_ACCESS_TOKEN: 't',
      X_EL_ACCESS_SECRET: 'ts',
    };
    const el = getXAccountCredentials(env, 'el');
    assert.equal(el.configured, true);
    assert.equal(el.handle, '@3l3ctr0nLibr3');
    const bulletin = getXAccountCredentials(env, 'bulletin');
    assert.equal(bulletin.configured, false);
    const list = listXAccountsPublic(env);
    assert.equal(list.length, 2);
    assert.equal(list.find((a) => a.id === 'el').configured, true);
  });
});

describe('x-post', () => {
  it('percent-encodes reserved chars', () => {
    assert.equal(percentEncode('a b'), 'a%20b');
    assert.ok(percentEncode("!'()").includes('%'));
  });

  it('builds OAuth1 header with signature', () => {
    const h = buildOAuth1Header({
      method: 'POST',
      url: 'https://api.x.com/2/tweets',
      apiKey: 'ck',
      apiSecret: 'cs',
      accessToken: 'at',
      accessSecret: 'as',
    });
    assert.match(h, /^OAuth /);
    assert.match(h, /oauth_signature=/);
    assert.match(h, /oauth_consumer_key="ck"/);
  });

  it('weights URLs as 23 chars', () => {
    const t = 'Hello https://electronlibre.info/articles/1-foo/ end';
    assert.equal(xWeightedLength(t), 'Hello '.length + 23 + ' end'.length);
  });

  it('asserts text length', () => {
    assert.equal(assertXText('  hi  '), 'hi');
    assert.throws(() => assertXText(''), /requis/);
    const long = 'x'.repeat(X_MAX_LENGTH + 1);
    assert.throws(() => assertXText(long), /trop long/);
  });
});
