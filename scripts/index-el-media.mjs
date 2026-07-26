#!/usr/bin/env node
/**
 * Indexe /var/www/el-media/uploads → el_media (+ thumbs .thumb.webp).
 *
 * Usage:
 *   node scripts/index-el-media.mjs
 *   node scripts/index-el-media.mjs --limit=200
 *   node scripts/index-el-media.mjs --no-thumbs
 *   node scripts/index-el-media.mjs --dry-run
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnvFile, createPool } from '../server/lib/db.mjs';
import { ensureMediaSchema } from '../server/lib/media/schema.mjs';
import {
  resolveMediaRoot,
  isThumbFilename,
  publicUrlFromPath,
} from '../server/lib/media/storage.mjs';
import {
  readImageMeta,
  ensureThumbForFile,
} from '../server/lib/media/process.mjs';

const ENV_FILE = process.env.EL_API_ENV_FILE || '/etc/electronlibre/el-astro-api.env';
const fileEnv = loadEnvFile(ENV_FILE);

function arg(name, fallback = null) {
  const pref = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  if (hit) return hit.slice(pref.length);
  if (process.argv.includes(`--${name}`)) return true;
  return fallback;
}

const LIMIT = Math.max(0, Number(arg('limit', 0)) || 0);
const NO_THUMBS = Boolean(arg('no-thumbs', false));
const DRY = Boolean(arg('dry-run', false));
const mediaRoot = resolveMediaRoot(
  process.env.EL_MEDIA_ROOT || fileEnv.EL_MEDIA_ROOT || ''
);

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    console.error('[media:index] read fail', dir, err.message);
    return out;
  }
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    if (ent.name.startsWith('.')) continue;
    if (ent.isDirectory()) {
      await walk(abs, out);
      continue;
    }
    if (!ent.isFile()) continue;
    if (isThumbFilename(ent.name)) continue;
    const ext = path.extname(ent.name).toLowerCase();
    if (!IMAGE_EXT.has(ext)) continue;
    out.push(abs);
  }
  return out;
}

async function main() {
  console.log('[media:index] root', mediaRoot);
  const files = await walk(mediaRoot);
  files.sort();
  console.log('[media:index] candidates', files.length);

  const pool = DRY
    ? null
    : createPool({
        host: process.env.EL_DB_HOST || fileEnv.EL_DB_HOST || 'localhost',
        user: process.env.EL_DB_USER || fileEnv.EL_DB_USER || '',
        password: process.env.EL_DB_PASSWORD || fileEnv.EL_DB_PASSWORD || '',
        database: process.env.EL_DB_NAME || fileEnv.EL_DB_NAME || 'electronlibre',
      });

  if (!DRY) await ensureMediaSchema(pool);

  let done = 0;
  let upserted = 0;
  let thumbs = 0;
  let skipped = 0;
  let errors = 0;

  for (const abs of files) {
    if (LIMIT && done >= LIMIT) break;
    done++;
    const rel = path.relative(mediaRoot, abs).split(path.sep).join('/');
    try {
      const meta = await readImageMeta(mediaRoot, rel);
      let thumbPath = null;
      let thumbUrl = null;
      if (!NO_THUMBS) {
        const t = await ensureThumbForFile(mediaRoot, rel);
        thumbPath = t.thumbPath;
        thumbUrl = t.thumbUrl;
        if (t.created) thumbs++;
      }
      if (DRY) {
        if (done <= 5 || done % 500 === 0) {
          console.log('[dry]', rel, meta.mime, meta.bytes);
        }
        upserted++;
        continue;
      }
      const url = publicUrlFromPath(rel);
      await pool.query(
        `INSERT INTO el_media
          (path, url, filename, mime, bytes, width, height, thumb_path, thumb_url, source)
         VALUES (?,?,?,?,?,?,?,?,?, 'legacy')
         ON DUPLICATE KEY UPDATE
           url = VALUES(url),
           filename = VALUES(filename),
           mime = VALUES(mime),
           bytes = VALUES(bytes),
           width = VALUES(width),
           height = VALUES(height),
           thumb_path = COALESCE(VALUES(thumb_path), thumb_path),
           thumb_url = COALESCE(VALUES(thumb_url), thumb_url),
           deleted_at = NULL,
           updated_at = CURRENT_TIMESTAMP`,
        [
          rel,
          url,
          path.posix.basename(rel),
          meta.mime,
          meta.bytes,
          meta.width,
          meta.height,
          thumbPath,
          thumbUrl,
        ]
      );
      upserted++;
      if (done % 200 === 0) {
        console.log(`[media:index] ${done}/${files.length}…`);
      }
    } catch (err) {
      if (err.code === 'MEDIA_MIME') {
        skipped++;
      } else {
        errors++;
        console.error('[media:index] error', rel, err.message);
      }
    }
  }

  if (pool) await pool.end();
  console.log('[media:index] done', {
    scanned: done,
    upserted,
    thumbsCreated: thumbs,
    skipped,
    errors,
    dryRun: DRY,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
