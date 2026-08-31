import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EDITORIAL_UPDATE_GRACE_MS,
  isEditorialUpdate,
  shouldBumpEditorialModified,
} from './editorial-update.mjs';

describe('editorial-update', () => {
  it('rejects updates inside the 45 minute grace', () => {
    const pub = new Date('2026-08-03T12:00:00.000Z');
    assert.equal(isEditorialUpdate(pub, new Date(pub.getTime() + 5 * 60 * 1000)), false);
    assert.equal(
      isEditorialUpdate(pub, new Date(pub.getTime() + EDITORIAL_UPDATE_GRACE_MS - 1)),
      false
    );
  });

  it('accepts updates at or after 45 minutes', () => {
    const pub = new Date('2026-08-03T12:00:00.000Z');
    assert.equal(
      isEditorialUpdate(pub, new Date(pub.getTime() + EDITORIAL_UPDATE_GRACE_MS)),
      true
    );
    assert.equal(
      isEditorialUpdate(pub, new Date(pub.getTime() + 2 * 60 * 60 * 1000)),
      true
    );
  });

  it('only content otherFieldsChanged bumps modified', () => {
    assert.equal(
      shouldBumpEditorialModified({
        accessChanged: true,
        iaKeywordsChanged: true,
        otherFieldsChanged: false,
      }),
      false
    );
    assert.equal(
      shouldBumpEditorialModified({
        accessChanged: false,
        iaKeywordsChanged: true,
        otherFieldsChanged: false,
      }),
      false
    );
    assert.equal(
      shouldBumpEditorialModified({
        accessChanged: false,
        iaKeywordsChanged: false,
        otherFieldsChanged: false,
      }),
      false
    );
    assert.equal(
      shouldBumpEditorialModified({
        accessChanged: true,
        iaKeywordsChanged: false,
        otherFieldsChanged: true,
      }),
      true
    );
  });
});
