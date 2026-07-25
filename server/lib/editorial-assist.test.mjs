import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAssistType } from './editorial-assist.mjs';

describe('editorial-assist', () => {
  it('normalizes known types', () => {
    assert.equal(normalizeAssistType('corriger'), 'corriger');
    assert.equal(normalizeAssistType('Reformuler'), 'reformuler');
    assert.equal(normalizeAssistType('chapo'), 'chapo');
    assert.equal(normalizeAssistType('titre'), null);
    assert.equal(normalizeAssistType(''), null);
  });
});
