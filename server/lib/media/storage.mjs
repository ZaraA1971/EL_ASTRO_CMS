/**
 * Chemins médias — racine disque + URLs /media/
 */
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_MEDIA_ROOT = '/var/www/el-media/uploads';
export const MEDIA_URL_PREFIX = '/media';
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
export const THUMB_MAX_EDGE = 320;

const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

export function resolveMediaRoot(envRoot) {
  const root = String(envRoot || process.env.EL_MEDIA_ROOT || DEFAULT_MEDIA_ROOT)
    .trim()
    .replace(/\/+$/, '');
  return root || DEFAULT_MEDIA_ROOT;
}

export function publicUrlFromPath(relPath) {
  const clean = String(relPath || '')
    .replace(/^\/+/, '')
    .replace(/\\/g, '/');
  return `${MEDIA_URL_PREFIX}/${clean}`;
}

export function isThumbFilename(name) {
  return /\.thumb\.webp$/i.test(String(name || ''));
}

export function thumbRelPathFor(relPath) {
  const p = String(relPath || '').replace(/\\/g, '/');
  const dir = path.posix.dirname(p);
  const base = path.posix.basename(p);
  const stem = base.replace(/\.[^.]+$/, '');
  const thumbName = `${stem}.thumb.webp`;
  return dir === '.' ? thumbName : `${dir}/${thumbName}`;
}

/** Slug fichier sûr (garde extension). */
export function slugifyFilename(originalName) {
  const raw = String(originalName || 'image').trim() || 'image';
  const extMatch = raw.match(/\.([a-z0-9]+)$/i);
  let ext = extMatch ? extMatch[1].toLowerCase() : '';
  if (ext === 'jpeg') ext = 'jpg';
  if (!ALLOWED_EXT.has(ext)) ext = 'jpg';
  const stem = raw
    .replace(/\.[^.]+$/, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${stem || 'image'}.${ext}`;
}

export function yyyymmDirs(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return { y: String(y), m, relDir: `${y}/${m}` };
}

/**
 * Empêche path traversal : relPath doit rester sous mediaRoot.
 */
export function absoluteFromRel(mediaRoot, relPath) {
  const root = path.resolve(mediaRoot);
  const abs = path.resolve(root, String(relPath || '').replace(/^\/+/, ''));
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    const err = new Error('Chemin média invalide');
    err.code = 'MEDIA_PATH';
    err.status = 400;
    throw err;
  }
  return abs;
}

export function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** Nom unique si collision. */
export function uniqueRelPath(mediaRoot, relDir, filename) {
  let candidate = path.posix.join(relDir, filename);
  let abs = absoluteFromRel(mediaRoot, candidate);
  if (!fs.existsSync(abs)) return candidate;
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext);
  for (let i = 2; i < 1000; i++) {
    candidate = path.posix.join(relDir, `${stem}-${i}${ext}`);
    abs = absoluteFromRel(mediaRoot, candidate);
    if (!fs.existsSync(abs)) return candidate;
  }
  candidate = path.posix.join(
    relDir,
    `${stem}-${Date.now()}${ext || '.jpg'}`
  );
  return candidate;
}

export function toMediaDto(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    path: row.path,
    url: row.url,
    filename: row.filename,
    mime: row.mime || '',
    bytes: Number(row.bytes) || 0,
    width: row.width != null ? Number(row.width) : null,
    height: row.height != null ? Number(row.height) : null,
    thumbUrl: row.thumb_url || row.url,
    thumbPath: row.thumb_path || null,
    alt: row.alt || '',
    source: row.source || 'upload',
    uploadedBy:
      row.uploaded_by != null ? Number(row.uploaded_by) : null,
    createdAt: row.created_at
      ? new Date(row.created_at).toISOString()
      : null,
  };
}
