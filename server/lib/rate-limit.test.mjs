import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit, clientIp } from './rate-limit.mjs';

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

describe('clientIp', () => {
  it('prefers X-Real-IP over spoofed X-Forwarded-For', () => {
    const req = {
      headers: {
        'x-forwarded-for': '1.2.3.4, 10.0.0.1',
        'x-real-ip': '203.0.113.9',
      },
      socket: { remoteAddress: '127.0.0.1' },
    };
    assert.equal(clientIp(req), '203.0.113.9');
  });

  it('ignores X-Forwarded-For when X-Real-IP missing (uses socket)', () => {
    const req = {
      headers: { 'x-forwarded-for': '1.2.3.4' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    assert.equal(clientIp(req), '127.0.0.1');
  });
});
