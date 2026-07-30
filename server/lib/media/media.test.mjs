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
  isImageMime,
} from './storage.mjs';
import { detectMediaMime } from './process.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('media storage', () => {
  it('slugifies filenames and keeps image / document ext', () => {
    assert.equal(slugifyFilename('Photo Été 2026.PNG'), 'photo-ete-2026.png');
    assert.equal(slugifyFilename('Jugement.PDF'), 'jugement.pdf');
    assert.equal(
      slugifyFilename('Rapport final.DOCX'),
      'rapport-final.docx'
    );
    assert.equal(
      slugifyFilename('scan.bin', 'application/pdf'),
      'scan.pdf'
    );
  });

  it('rejects dangerous or unknown extensions', () => {
    assert.throws(() => slugifyFilename('x.exe'), (err) => err.code === 'MEDIA_EXT');
    assert.throws(() => slugifyFilename('no-ext'), (err) => err.code === 'MEDIA_EXT');
    assert.throws(() => slugifyFilename('evil.html'), (err) => err.code === 'MEDIA_EXT');
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

  it('maps DTO — thumb fallback only for images', () => {
    const img = toMediaDto({
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
    assert.equal(img.id, 3);
    assert.equal(img.thumbUrl, '/media/a/b.thumb.webp');
    assert.equal(img.source, 'legacy');
    assert.equal(isImageMime(img.mime), true);

    const imgNoThumb = toMediaDto({
      id: 4,
      path: 'a/c.jpg',
      url: '/media/a/c.jpg',
      filename: 'c.jpg',
      mime: 'image/jpeg',
      bytes: 10,
      thumb_url: null,
      thumb_path: null,
    });
    assert.equal(imgNoThumb.thumbUrl, '/media/a/c.jpg');

    const pdf = toMediaDto({
      id: 5,
      path: 'a/d.pdf',
      url: '/media/a/d.pdf',
      filename: 'd.pdf',
      mime: 'application/pdf',
      bytes: 100,
      thumb_url: null,
      thumb_path: null,
    });
    assert.equal(pdf.thumbUrl, null);
    assert.equal(isImageMime(pdf.mime), false);
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

describe('media detect', () => {
  it('detects PDF magic bytes', async () => {
    const buf = Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
    assert.equal(await detectMediaMime(buf, 'doc.pdf'), 'application/pdf');
  });

  it('detects plain text via extension', async () => {
    const buf = Buffer.from('hello world\nline 2\n');
    assert.equal(await detectMediaMime(buf, 'notes.txt'), 'text/plain');
  });

  it('rejects binary as txt', async () => {
    const buf = Buffer.from([0, 1, 2, 3, 4, 5, 0xff, 0xfe]);
    await assert.rejects(() => detectMediaMime(buf, 'notes.txt'));
  });
});
