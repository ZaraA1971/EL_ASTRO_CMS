/**
 * Traitement images — sharp + file-type.
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
} from './storage.mjs';
import path from 'node:path';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export async function detectImageMime(buffer) {
  const ft = await fileTypeFromBuffer(buffer);
  if (!ft || !ALLOWED_MIME.has(ft.mime)) {
    const err = new Error(
      'Type de fichier non autorisé (jpeg, png, webp, gif uniquement).'
    );
    err.status = 400;
    err.code = 'MEDIA_MIME';
    throw err;
  }
  return ft.mime;
}

/**
 * Écrit le buffer original + génère un thumb WebP.
 * @returns {{ width, height, bytes, mime, thumbPath, thumbUrl }}
 */
export async function writeImageWithThumb(mediaRoot, relPath, buffer, mime) {
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

  const detected = mime || (await detectImageMime(buffer));
  const abs = absoluteFromRel(mediaRoot, relPath);
  ensureDirSync(path.dirname(abs));
  await fs.writeFile(abs, buffer);

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

/** Génère un thumb manquant pour un fichier déjà sur disque. */
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
