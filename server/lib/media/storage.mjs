/**
 * Chemins médias — racine disque + URLs /media/
 */
import fs from 'node:fs';
import path from 'node:path';
import { slugify } from '../slugify.mjs';

export const DEFAULT_MEDIA_ROOT = '/var/www/el-media/uploads';
export const MEDIA_URL_PREFIX = '/media';
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const THUMB_MAX_EDGE = 320;

/** Extensions autorisées (pièces jointes éditoriales). */
export const ALLOWED_EXT = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'pdf',
  'txt',
  'csv',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'odt',
  'ods',
  'odp',
  'zip',
]);

/** MIME → extension préférée pour le nom de fichier. */
export const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'pptx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/zip': 'zip',
};

/** Extension → MIME canonique. */
export const EXT_TO_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  zip: 'application/zip',
};

export const IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export function isImageMime(mime) {
  return IMAGE_MIME.has(String(mime || '').toLowerCase());
}

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

/**
 * Slug fichier sûr (garde extension autorisée).
 * @param {string} originalName
 * @param {string} [mime] — si fourni, impose l’extension dérivée du MIME
 */
export function slugifyFilename(originalName, mime) {
  const raw = String(originalName || 'document').trim() || 'document';
  const extMatch = raw.match(/\.([a-z0-9]+)$/i);
  let ext = extMatch ? extMatch[1].toLowerCase() : '';
  if (ext === 'jpeg') ext = 'jpg';

  if (mime) {
    const fromMime = MIME_TO_EXT[String(mime).toLowerCase()];
    if (fromMime) ext = fromMime;
  }

  if (!ALLOWED_EXT.has(ext)) {
    const err = new Error(
      'Extension non autorisée (images, PDF, texte, Office, zip).'
    );
    err.status = 400;
    err.code = 'MEDIA_EXT';
    throw err;
  }

  const stem = slugify(raw.replace(/\.[^.]+$/, ''), {
    sep: '-',
    max: 80,
    fallback: 'document',
  });
  return `${stem}.${ext}`;
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
    `${stem}-${Date.now()}${ext || '.bin'}`
  );
  return candidate;
}

export function toMediaDto(row) {
  if (!row) return null;
  const mime = row.mime || '';
  const thumbUrl = row.thumb_url || (isImageMime(mime) ? row.url : null) || null;
  return {
    id: Number(row.id),
    path: row.path,
    url: row.url,
    filename: row.filename,
    mime,
    bytes: Number(row.bytes) || 0,
    width: row.width != null ? Number(row.width) : null,
    height: row.height != null ? Number(row.height) : null,
    thumbUrl,
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
