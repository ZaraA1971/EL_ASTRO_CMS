import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit } from './rate-limit.mjs';

describe('rateLimit', () => {
  it('allows up to max then blocks', () => {
    const key = `test-${Date.now()}-${Math.random()}`;
    const opts = { windowMs: 60_000, max: 3 };
    assert.equal(rateLimit(key, opts).ok, true);
    assert.equal(rateLimit(key, opts).ok, true);
    assert.equal(rateLimit(key, opts).ok, true);
    const blocked = rateLimit(key, opts);
    assert.equal(blocked.ok, false);
    assert.ok(blocked.retryAfterSec >= 1);
  });
});
