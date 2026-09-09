import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLoginId,
  validateLoginId,
  LOGIN_ID_MAX,
} from './login-id.mjs';

describe('validateLoginId (store)', () => {
  it('normalizes case and trim', () => {
    assert.equal(normalizeLoginId('  Marie@EL.info  '), 'marie@el.info');
  });

  it('accepts an email as login', () => {
    const out = validateLoginId('Marie+Tag@Example.com', 'store');
    assert.equal(out.ok, true);
    assert.equal(out.login, 'marie+tag@example.com');
  });

  it('still accepts the historic charset', () => {
    const out = validateLoginId('jean-pierre_01', 'store');
    assert.equal(out.ok, true);
    assert.equal(out.login, 'jean-pierre_01');
  });

  it('rejects empty, too short, too long, and spaces', () => {
    assert.equal(validateLoginId('', 'store').ok, false);
    assert.equal(validateLoginId('ab', 'store').ok, false);
    assert.equal(validateLoginId('a'.repeat(LOGIN_ID_MAX + 1), 'store').ok, false);
    assert.match(validateLoginId('marie dupont', 'store').error, /espace/);
  });
});
