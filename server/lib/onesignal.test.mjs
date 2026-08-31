import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_PUSH_SEGMENTS,
  mergeSegmentLists,
  parseSegmentsResponse,
  resolvePushSegments,
  segmentLabel,
  togglePushSelection,
} from './onesignal-segments.mjs';
import { listPushSegments } from './onesignal.mjs';

describe('onesignal segments', () => {
  it('labels builtins in French', () => {
    assert.equal(segmentLabel('All'), 'Tout le monde');
    assert.equal(segmentLabel('Subscribed Users'), 'Abonnés');
    assert.equal(segmentLabel('iOS FR'), 'iOS FR');
  });

  it('parses OneSignal list payload', () => {
    const rows = parseSegmentsResponse({
      segments: [
        { id: '1', name: 'iOS FR', description: 'app' },
        { id: '2', name: '  ' },
      ],
    });
    assert.deepEqual(rows, [{ id: '1', name: 'iOS FR', description: 'app' }]);
  });

  it('keeps builtins and prepends All', () => {
    const list = mergeSegmentLists([{ id: '1', name: 'iOS FR' }]);
    assert.equal(list[0].name, 'All');
    assert.ok(list.some((s) => s.name === 'Subscribed Users'));
    assert.ok(list.some((s) => s.name === 'iOS FR' && s.builtin === false));
    assert.equal(list.length, BUILTIN_PUSH_SEGMENTS.length + 1);
  });

  it('resolves empty input to All', () => {
    assert.deepEqual(resolvePushSegments(undefined), ['All']);
    assert.deepEqual(resolvePushSegments([]), ['All']);
    assert.deepEqual(resolvePushSegments('Abonnés'), ['Abonnés']);
    assert.deepEqual(resolvePushSegments(['iOS FR', 'iOS FR', '']), ['iOS FR']);
  });

  it('toggles All vs specific groups', () => {
    assert.deepEqual(togglePushSelection(['All'], 'All'), ['All']);
    assert.deepEqual(togglePushSelection(['All'], 'iOS FR'), ['iOS FR']);
    assert.deepEqual(togglePushSelection(['iOS FR'], 'Active Users'), [
      'iOS FR',
      'Active Users',
    ]);
    assert.deepEqual(togglePushSelection(['iOS FR'], 'iOS FR'), ['All']);
    assert.deepEqual(togglePushSelection(['iOS FR'], 'All'), ['All']);
  });

  it('lists builtins without credentials', async () => {
    const data = await listPushSegments({
      appId: '',
      apiKey: '',
      bypassCache: true,
    });
    assert.equal(data.source, 'builtin');
    assert.ok(data.segments.some((s) => s.name === 'All'));
  });

  it('maps a mocked OneSignal response', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          segments: [{ id: '9', name: 'iOS FR', description: 'app' }],
        }),
    });
    try {
      const data = await listPushSegments({
        appId: 'app',
        apiKey: 'os_v_test',
        bypassCache: true,
      });
      assert.equal(data.source, 'onesignal');
      assert.ok(data.segments.some((s) => s.name === 'iOS FR'));
      assert.ok(data.segments.some((s) => s.name === 'All'));
    } finally {
      globalThis.fetch = orig;
    }
  });
});
