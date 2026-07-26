import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  slugifyFilename,
  publicUrlFromPath,
  thumbRelPathFor,
  isThumbFilename,
  toMediaDto,
  uniqueRelPath,
  absoluteFromRel,
} from './storage.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('media storage', () => {
  it('slugifies filenames and keeps image ext', () => {
    assert.equal(slugifyFilename('Photo Été 2026.PNG'), 'photo-ete-2026.png');
    assert.equal(slugifyFilename('no-ext'), 'no-ext.jpg');
    assert.equal(slugifyFilename('x.exe'), 'x.jpg');
  });

  it('builds /media URLs and thumb paths', () => {
    assert.equal(publicUrlFromPath('2026/07/foo.jpg'), '/media/2026/07/foo.jpg');
    assert.equal(
      thumbRelPathFor('2026/07/foo.jpg'),
      '2026/07/foo.thumb.webp'
    );
    assert.equal(isThumbFilename('foo.thumb.webp'), true);
    assert.equal(isThumbFilename('foo.jpg'), false);
  });

  it('maps DTO', () => {
    const dto = toMediaDto({
      id: 3,
      path: 'a/b.jpg',
      url: '/media/a/b.jpg',
      filename: 'b.jpg',
      mime: 'image/jpeg',
      bytes: 10,
      width: 1,
      height: 2,
      thumb_url: '/media/a/b.thumb.webp',
      alt: 'x',
      source: 'legacy',
      uploaded_by: null,
      created_at: '2026-01-01T00:00:00Z',
    });
    assert.equal(dto.id, 3);
    assert.equal(dto.thumbUrl, '/media/a/b.thumb.webp');
    assert.equal(dto.source, 'legacy');
  });

  it('rejects path traversal', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'el-media-'));
    assert.throws(() => absoluteFromRel(root, '../etc/passwd'));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('uniqueRelPath avoids collisions', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'el-media-'));
    const dir = path.join(root, '2026', '07');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'foo.jpg'), 'x');
    const next = uniqueRelPath(root, '2026/07', 'foo.jpg');
    assert.equal(next, '2026/07/foo-2.jpg');
    fs.rmSync(root, { recursive: true, force: true });
  });
});
