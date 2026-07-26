/**
 * API desk /api/desk/media/*
 */
import Busboy from 'busboy';
import fs from 'node:fs/promises';
import path from 'node:path';
import { canEditAll, isStaffRole } from '../roles.mjs';
import { auditLog } from '../audit.mjs';
import { ensureMediaSchema } from './schema.mjs';
import {
  resolveMediaRoot,
  slugifyFilename,
  yyyymmDirs,
  uniqueRelPath,
  publicUrlFromPath,
  absoluteFromRel,
  toMediaDto,
  MAX_UPLOAD_BYTES,
} from './storage.mjs';
import { detectImageMime, writeImageWithThumb } from './process.mjs';

function parseMultipart(req, { maxBytes = MAX_UPLOAD_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const ct = String(req.headers['content-type'] || '');
    if (!ct.includes('multipart/form-data')) {
      const err = new Error('multipart/form-data requis');
      err.status = 400;
      reject(err);
      return;
    }
    const bb = Busboy({
      headers: req.headers,
      limits: { files: 1, fileSize: maxBytes, fields: 10 },
    });
    /** @type {{ buffer: Buffer, filename: string, mime: string } | null} */
    let file = null;
    const fields = {};
    let truncated = false;

    bb.on('file', (name, stream, info) => {
      if (name !== 'file' || file) {
        stream.resume();
        return;
      }
      const chunks = [];
      stream.on('data', (d) => chunks.push(d));
      stream.on('limit', () => {
        truncated = true;
      });
      stream.on('end', () => {
        file = {
          buffer: Buffer.concat(chunks),
          filename: info.filename || 'image.jpg',
          mime: info.mimeType || '',
        };
      });
    });
    bb.on('field', (name, val) => {
      fields[name] = val;
    });
    bb.on('error', reject);
    bb.on('finish', () => {
      if (truncated) {
        const err = new Error(
          `Fichier trop volumineux (max ${Math.round(maxBytes / 1024 / 1024)} Mo).`
        );
        err.status = 413;
        reject(err);
        return;
      }
      resolve({ file, fields });
    });
    req.pipe(bb);
  });
}

async function loadMedia(pool, id) {
  const [rows] = await pool.query(
    'SELECT * FROM el_media WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [id]
  );
  return rows[0] || null;
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string[]} parts — ['api','desk','media', ...]
 */
export async function handleDeskMedia(req, res, parts, ctx) {
  const { pool, sendJson, session, actor, ip } = ctx;
  await ensureMediaSchema(pool);
  const mediaRoot = resolveMediaRoot(ctx.mediaRoot);

  // GET /api/desk/media
  if (!parts[3] && req.method === 'GET') {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const perPage = Math.min(
      60,
      Math.max(1, Number(url.searchParams.get('per_page')) || 24)
    );
    const q = String(url.searchParams.get('q') || '').trim();
    const offset = (page - 1) * perPage;
    const params = [];
    let where = 'deleted_at IS NULL';
    if (q) {
      where += ' AND (filename LIKE ? OR alt LIKE ? OR path LIKE ?)';
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM el_media WHERE ${where}`,
      params
    );
    const [rows] = await pool.query(
      `SELECT * FROM el_media WHERE ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...params, perPage, offset]
    );
    return sendJson(res, 200, {
      items: rows.map(toMediaDto),
      page,
      perPage,
      total: Number(total) || 0,
      pages: Math.max(1, Math.ceil((Number(total) || 0) / perPage)),
    });
  }

  // POST /api/desk/media
  if (!parts[3] && req.method === 'POST') {
    if (!isStaffRole(session.role)) {
      return sendJson(res, 403, { error: 'Upload non autorisé' });
    }
    let parsed;
    try {
      parsed = await parseMultipart(req);
    } catch (err) {
      return sendJson(res, err.status || 400, {
        error: err.message || 'Upload invalide',
      });
    }
    if (!parsed.file?.buffer?.length) {
      return sendJson(res, 400, { error: 'Champ file manquant' });
    }
    let mime;
    try {
      mime = await detectImageMime(parsed.file.buffer);
    } catch (err) {
      return sendJson(res, err.status || 400, {
        error: err.message || 'Type invalide',
      });
    }
    const { relDir } = yyyymmDirs();
    const filename = slugifyFilename(parsed.file.filename);
    const relPath = uniqueRelPath(mediaRoot, relDir, filename);
    let processed;
    try {
      processed = await writeImageWithThumb(
        mediaRoot,
        relPath,
        parsed.file.buffer,
        mime
      );
    } catch (err) {
      return sendJson(res, err.status || 500, {
        error: err.message || 'Écriture impossible',
      });
    }
    const alt = String(parsed.fields.alt || '').trim().slice(0, 500);
    const url = publicUrlFromPath(relPath);
    const [result] = await pool.query(
      `INSERT INTO el_media
        (path, url, filename, mime, bytes, width, height, thumb_path, thumb_url, alt, source, uploaded_by)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'upload', ?)`,
      [
        relPath,
        url,
        path.posix.basename(relPath),
        processed.mime,
        processed.bytes,
        processed.width,
        processed.height,
        processed.thumbPath,
        processed.thumbUrl,
        alt || null,
        session.uid,
      ]
    );
    const row = await loadMedia(pool, result.insertId);
    await auditLog(pool, {
      actor,
      action: 'media.upload',
      targetType: 'media',
      targetId: result.insertId,
      ip,
      meta: { path: relPath, bytes: processed.bytes },
    });
    return sendJson(res, 201, { item: toMediaDto(row) });
  }

  const id = Number(parts[3]) || 0;
  if (!id || parts[4]) {
    return sendJson(res, 404, { error: 'Not found' });
  }

  // PATCH /api/desk/media/:id
  if (req.method === 'PATCH') {
    const row = await loadMedia(pool, id);
    if (!row) return sendJson(res, 404, { error: 'Média introuvable' });
    let body = {};
    try {
      const raw = await new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (c) => {
          size += c.length;
          if (size > 64_000) {
            reject(Object.assign(new Error('Payload trop grand'), { status: 413 }));
            req.destroy();
            return;
          }
          chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
      });
      if (raw.length) body = JSON.parse(raw.toString('utf8'));
    } catch (err) {
      return sendJson(res, err.status || 400, {
        error: err.message || 'JSON invalide',
      });
    }
    const alt =
      body.alt != null ? String(body.alt).trim().slice(0, 500) : row.alt;
    await pool.query('UPDATE el_media SET alt = ? WHERE id = ?', [
      alt || null,
      id,
    ]);
    const updated = await loadMedia(pool, id);
    await auditLog(pool, {
      actor,
      action: 'media.patch',
      targetType: 'media',
      targetId: id,
      ip,
    });
    return sendJson(res, 200, { item: toMediaDto(updated) });
  }

  // DELETE /api/desk/media/:id — admin/editor
  if (req.method === 'DELETE') {
    if (!canEditAll(session.role)) {
      return sendJson(res, 403, {
        error: 'Suppression réservée aux éditeurs / admins',
      });
    }
    const row = await loadMedia(pool, id);
    if (!row) return sendJson(res, 404, { error: 'Média introuvable' });
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await pool.query('UPDATE el_media SET deleted_at = ? WHERE id = ?', [
      now,
      id,
    ]);
    for (const rel of [row.path, row.thumb_path].filter(Boolean)) {
      try {
        await fs.unlink(absoluteFromRel(mediaRoot, rel));
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.error('[media] unlink', rel, err.message);
        }
      }
    }
    await auditLog(pool, {
      actor,
      action: 'media.delete',
      targetType: 'media',
      targetId: id,
      ip,
      meta: { path: row.path },
    });
    return sendJson(res, 200, { ok: true, id });
  }

  return sendJson(res, 405, { error: 'Method not allowed' });
}
