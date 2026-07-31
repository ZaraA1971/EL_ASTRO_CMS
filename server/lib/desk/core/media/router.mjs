/**
 * CRUD médias portable — store + FS utils injectés via ctx.
 *
 * ctx requis :
 *   pool, sendJson, session, actor, ip
 *   mediaStore (createMediaStore)
 *   mediaFs : resolveMediaRoot, slugifyFilename, yyyymmDirs, uniqueRelPath,
 *             publicUrlFromPath, absoluteFromRel, toMediaDto, MAX_UPLOAD_BYTES,
 *             detectMediaMime, writeMediaFile
 *   canEditAll, isStaffRole
 *
 * ctx optionnel : auditLog, mediaRoot, readBody (unused — multipart via Busboy)
 */
import Busboy from 'busboy';
import fs from 'node:fs/promises';
import path from 'node:path';

function parseMultipart(req, { maxBytes }) {
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

/**
 * @returns {Promise<boolean>} true si route media traitée
 */
export async function handleCoreMedia(req, res, parts, ctx) {
  if (parts[2] !== 'media') return false;

  const {
    pool,
    sendJson,
    session,
    actor,
    ip,
    mediaStore,
    mediaFs,
    canEditAll,
    isStaffRole,
    auditLog,
  } = ctx;

  if (!mediaStore?.list || !mediaFs?.toMediaDto) {
    sendJson(res, 500, { error: 'Store médias manquant' });
    return true;
  }

  await mediaStore.ensureSchema(pool);
  const mediaRoot = mediaFs.resolveMediaRoot(ctx.mediaRoot);

  if (!parts[3] && req.method === 'GET') {
    const url = new URL(
      req.url || '/',
      `http://${req.headers.host || 'localhost'}`
    );
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const perPage = Math.min(
      60,
      Math.max(1, Number(url.searchParams.get('per_page')) || 24)
    );
    const q = String(url.searchParams.get('q') || '').trim();
    const { rows, total } = await mediaStore.list(pool, { q, page, perPage });
    sendJson(res, 200, {
      items: rows.map(mediaFs.toMediaDto),
      page,
      perPage,
      total,
      pages: Math.max(1, Math.ceil(total / perPage)),
    });
    return true;
  }

  if (!parts[3] && req.method === 'POST') {
    if (!isStaffRole(session.role)) {
      sendJson(res, 403, { error: 'Upload non autorisé' });
      return true;
    }
    let parsed;
    try {
      parsed = await parseMultipart(req, {
        maxBytes: mediaFs.MAX_UPLOAD_BYTES,
      });
    } catch (err) {
      sendJson(res, err.status || 400, {
        error: err.message || 'Upload invalide',
      });
      return true;
    }
    if (!parsed.file?.buffer?.length) {
      sendJson(res, 400, { error: 'Champ file manquant' });
      return true;
    }
    let mime;
    try {
      mime = await mediaFs.detectMediaMime(
        parsed.file.buffer,
        parsed.file.filename || ''
      );
    } catch (err) {
      sendJson(res, err.status || 400, {
        error: err.message || 'Type invalide',
      });
      return true;
    }
    const { relDir } = mediaFs.yyyymmDirs();
    let filename;
    try {
      filename = mediaFs.slugifyFilename(parsed.file.filename, mime);
    } catch (err) {
      sendJson(res, err.status || 400, {
        error: err.message || 'Nom de fichier invalide',
      });
      return true;
    }
    const relPath = mediaFs.uniqueRelPath(mediaRoot, relDir, filename);
    let processed;
    try {
      processed = await mediaFs.writeMediaFile(
        mediaRoot,
        relPath,
        parsed.file.buffer,
        mime
      );
    } catch (err) {
      sendJson(res, err.status || 500, {
        error: err.message || 'Écriture impossible',
      });
      return true;
    }
    const alt = String(parsed.fields.alt || '').trim().slice(0, 500);
    const url = mediaFs.publicUrlFromPath(relPath);
    const row = await mediaStore.insert(pool, {
      path: relPath,
      url,
      filename: path.posix.basename(relPath),
      mime: processed.mime,
      bytes: processed.bytes,
      width: processed.width,
      height: processed.height,
      thumbPath: processed.thumbPath,
      thumbUrl: processed.thumbUrl,
      alt,
      uploadedBy: session.uid,
    });
    if (typeof auditLog === 'function') {
      await auditLog(pool, {
        actor,
        action: 'media.upload',
        targetType: 'media',
        targetId: row.id,
        ip,
        meta: { path: relPath, bytes: processed.bytes },
      });
    }
    sendJson(res, 201, { item: mediaFs.toMediaDto(row) });
    return true;
  }

  const id = Number(parts[3]) || 0;
  if (!id || parts[4]) {
    sendJson(res, 404, { error: 'Introuvable' });
    return true;
  }

  if (req.method === 'PATCH') {
    const existing = await mediaStore.load(pool, id);
    if (!existing) {
      sendJson(res, 404, { error: 'Média introuvable' });
      return true;
    }
    let body = {};
    try {
      const raw = await new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (c) => {
          size += c.length;
          if (size > 64_000) {
            reject(
              Object.assign(new Error('Payload trop grand'), { status: 413 })
            );
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
      sendJson(res, err.status || 400, {
        error: err.message || 'JSON invalide',
      });
      return true;
    }
    const alt =
      body.alt != null ? String(body.alt).trim().slice(0, 500) : existing.alt;
    const updated = await mediaStore.patchAlt(pool, id, alt);
    if (typeof auditLog === 'function') {
      await auditLog(pool, {
        actor,
        action: 'media.patch',
        targetType: 'media',
        targetId: id,
        ip,
      });
    }
    sendJson(res, 200, { item: mediaFs.toMediaDto(updated) });
    return true;
  }

  if (req.method === 'DELETE') {
    if (!canEditAll(session.role)) {
      sendJson(res, 403, {
        error: 'Suppression réservée aux éditeurs / admins',
      });
      return true;
    }
    const row = await mediaStore.load(pool, id);
    if (!row) {
      sendJson(res, 404, { error: 'Média introuvable' });
      return true;
    }
    await mediaStore.softDelete(pool, id);
    for (const rel of [row.path, row.thumb_path].filter(Boolean)) {
      try {
        await fs.unlink(mediaFs.absoluteFromRel(mediaRoot, rel));
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.error('[media] unlink', rel, err.message);
        }
      }
    }
    if (typeof auditLog === 'function') {
      await auditLog(pool, {
        actor,
        action: 'media.delete',
        targetType: 'media',
        targetId: id,
        ip,
        meta: { path: row.path },
      });
    }
    sendJson(res, 200, { ok: true, id });
    return true;
  }

  sendJson(res, 405, { error: 'Méthode non autorisée' });
  return true;
}
