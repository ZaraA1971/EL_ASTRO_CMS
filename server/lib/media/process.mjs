/**
 * Traitement médias — images (sharp) + documents (PDF, Office, etc.).
 */
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import {
  THUMB_MAX_EDGE,
  MAX_UPLOAD_BYTES,
  absoluteFromRel,
  ensureDirSync,
  thumbRelPathFor,
  publicUrlFromPath,
  isImageMime,
  EXT_TO_MIME,
  MIME_TO_EXT,
  IMAGE_MIME,
} from './storage.mjs';
import path from 'node:path';

const ALLOWED_MIME = new Set(Object.keys(MIME_TO_EXT));

/** MIME renvoyés par file-type pour archives Office (souvent zip générique). */
const ZIP_CONTAINER_EXTS = new Set([
  'docx',
  'xlsx',
  'pptx',
  'odt',
  'ods',
  'odp',
  'zip',
]);

function mimeError() {
  const err = new Error(
    'Type de fichier non autorisé (images, PDF, texte, Office, zip).'
  );
  err.status = 400;
  err.code = 'MEDIA_MIME';
  return err;
}

function extFromName(filename) {
  const m = String(filename || '').match(/\.([a-z0-9]+)$/i);
  if (!m) return '';
  let ext = m[1].toLowerCase();
  if (ext === 'jpeg') ext = 'jpg';
  return ext;
}

function looksLikeText(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (sample.includes(0)) return false;
  let weird = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample[i];
    if (c === 9 || c === 10 || c === 13) continue;
    if (c < 32 || c === 127) weird += 1;
  }
  return weird / Math.max(sample.length, 1) < 0.05;
}

/**
 * Détecte un MIME autorisé (magic bytes + extension pour texte / Office zip).
 * @param {Buffer} buffer
 * @param {string} [filename]
 */
export async function detectMediaMime(buffer, filename = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const err = new Error('Fichier vide');
    err.status = 400;
    throw err;
  }

  const ext = extFromName(filename);
  const ft = await fileTypeFromBuffer(buffer);

  if (ft?.mime) {
    let mime = ft.mime;
    // OOXML / ODF : souvent détectés comme zip
    if (
      (mime === 'application/zip' || mime === 'application/x-zip-compressed') &&
      ZIP_CONTAINER_EXTS.has(ext)
    ) {
      mime = EXT_TO_MIME[ext] || 'application/zip';
    }
    // Normaliser jpeg
    if (mime === 'image/jpg') mime = 'image/jpeg';
    if (ALLOWED_MIME.has(mime)) return mime;
    // file-type a reconnu un type interdit
    throw mimeError();
  }

  // Pas de signature (txt/csv) : extension + contenu texte
  if ((ext === 'txt' || ext === 'csv') && looksLikeText(buffer)) {
    return EXT_TO_MIME[ext];
  }

  // Ancien .doc parfois non détecté : CFB (D0 CF 11 E0)
  if (
    ext === 'doc' &&
    buffer.length >= 4 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0
  ) {
    return EXT_TO_MIME.doc;
  }

  throw mimeError();
}

/** @deprecated alias — images uniquement (indexeur legacy). */
export async function detectImageMime(buffer) {
  const mime = await detectMediaMime(buffer);
  if (!IMAGE_MIME.has(mime)) throw mimeError();
  return mime;
}

/**
 * Écrit le fichier ; génère un thumb WebP pour les images uniquement.
 * @returns {{ width, height, bytes, mime, thumbPath, thumbUrl }}
 */
export async function writeMediaFile(mediaRoot, relPath, buffer, mime) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const err = new Error('Fichier vide');
    err.status = 400;
    throw err;
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    const err = new Error(
      `Fichier trop volumineux (max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} Mo).`
    );
    err.status = 413;
    err.code = 'MEDIA_TOO_LARGE';
    throw err;
  }

  const detected = mime || (await detectMediaMime(buffer, path.basename(relPath)));
  if (!ALLOWED_MIME.has(detected)) throw mimeError();

  const abs = absoluteFromRel(mediaRoot, relPath);
  ensureDirSync(path.dirname(abs));
  await fs.writeFile(abs, buffer);

  if (!isImageMime(detected)) {
    return {
      width: null,
      height: null,
      bytes: buffer.length,
      mime: detected,
      thumbPath: null,
      thumbUrl: null,
    };
  }

  let width = null;
  let height = null;
  try {
    const meta = await sharp(buffer, { animated: false }).metadata();
    width = meta.width || null;
    height = meta.height || null;
  } catch {
    /* metadata optionnelle */
  }

  const thumbRel = thumbRelPathFor(relPath);
  const thumbAbs = absoluteFromRel(mediaRoot, thumbRel);
  try {
    await sharp(buffer, { animated: false })
      .rotate()
      .resize({
        width: THUMB_MAX_EDGE,
        height: THUMB_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 78 })
      .toFile(thumbAbs);
  } catch (err) {
    console.error('[media] thumb failed', relPath, err.message);
    return {
      width,
      height,
      bytes: buffer.length,
      mime: detected,
      thumbPath: null,
      thumbUrl: null,
    };
  }

  return {
    width,
    height,
    bytes: buffer.length,
    mime: detected,
    thumbPath: thumbRel,
    thumbUrl: publicUrlFromPath(thumbRel),
  };
}

/** @deprecated alias */
export async function writeImageWithThumb(mediaRoot, relPath, buffer, mime) {
  return writeMediaFile(mediaRoot, relPath, buffer, mime);
}

/** Génère un thumb manquant pour une image déjà sur disque. */
export async function ensureThumbForFile(mediaRoot, relPath) {
  const abs = absoluteFromRel(mediaRoot, relPath);
  const thumbRel = thumbRelPathFor(relPath);
  const thumbAbs = absoluteFromRel(mediaRoot, thumbRel);
  try {
    await fs.access(thumbAbs);
    return {
      thumbPath: thumbRel,
      thumbUrl: publicUrlFromPath(thumbRel),
      created: false,
    };
  } catch {
    /* missing */
  }
  const buffer = await fs.readFile(abs);
  if (buffer.length > MAX_UPLOAD_BYTES * 4) {
    // legacy peut dépasser la limite upload ; on tente quand même jusqu'à 40 Mo
    if (buffer.length > 40 * 1024 * 1024) {
      return { thumbPath: null, thumbUrl: null, created: false };
    }
  }
  await sharp(buffer, { animated: false })
    .rotate()
    .resize({
      width: THUMB_MAX_EDGE,
      height: THUMB_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 78 })
    .toFile(thumbAbs);
  return {
    thumbPath: thumbRel,
    thumbUrl: publicUrlFromPath(thumbRel),
    created: true,
  };
}

export async function readImageMeta(mediaRoot, relPath) {
  const abs = absoluteFromRel(mediaRoot, relPath);
  const buffer = await fs.readFile(abs);
  let mime = 'application/octet-stream';
  try {
    mime = await detectImageMime(buffer.slice(0, 4100));
  } catch {
    const ext = path.extname(relPath).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
    else if (ext === '.png') mime = 'image/png';
    else if (ext === '.webp') mime = 'image/webp';
    else if (ext === '.gif') mime = 'image/gif';
    else {
      const err = new Error('Pas une image indexable');
      err.code = 'MEDIA_MIME';
      throw err;
    }
  }
  let width = null;
  let height = null;
  try {
    const meta = await sharp(buffer, { animated: false }).metadata();
    width = meta.width || null;
    height = meta.height || null;
  } catch {
    /* ignore */
  }
  return { mime, bytes: buffer.length, width, height };
}
