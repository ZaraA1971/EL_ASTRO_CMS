import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveExcerptFromBody,
  stripLeadingChapoHtml,
} from './excerpt.mjs';

describe('excerpt', () => {
  it('strips leading bold chapô', () => {
    const html =
      '<p><strong>Chapô éditorial ici.</strong></p><p>Suite du texte longue.</p>';
    assert.equal(
      stripLeadingChapoHtml(html).includes('Chapô éditorial'),
      false
    );
    assert.match(stripLeadingChapoHtml(html), /Suite du texte/);
  });

  it('derives proportional excerpt from body, not chapô', () => {
    const body =
      '<p><strong>Accroche courte.</strong></p>' +
      `<p>${'mot '.repeat(200)}</p>`;
    const ex = deriveExcerptFromBody(body);
    assert.ok(ex.length > 50);
    assert.doesNotMatch(ex, /Accroche courte/);
    assert.match(ex, /^mot /);
  });
});
