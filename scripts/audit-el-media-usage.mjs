#!/usr/bin/env node
/**
 * Audit médiathèque : fichiers disque / el_media vs références site (el_articles).
 *
 * Usage:
 *   node scripts/audit-el-media-usage.mjs
 *   node scripts/audit-el-media-usage.mjs --out=/tmp/media-audit.json
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnvFile, createPool } from '../server/lib/db.mjs';
import { resolveMediaRoot } from '../server/lib/media/storage.mjs';

const ENV_FILE = process.env.EL_API_ENV_FILE || '/etc/electronlibre/el-astro-api.env';
const fileEnv = loadEnvFile(ENV_FILE);

function arg(name, fallback = null) {
  const pref = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  if (hit) return hit.slice(pref.length);
  if (process.argv.includes(`--${name}`)) return true;
  return fallback;
}

const OUT =
  arg('out') ||
  path.join(
    process.cwd(),
    'tmp',
    `media-audit-${new Date().toISOString().slice(0, 10)}.json`
  );

const IMAGE_EXT = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.svg',
  '.avif',
]);

const MEDIA_RE =
  /(?:https?:)?\/\/(?:www\.)?electronlibre\.info\/(?:wp-content\/uploads|media)\/([^\s"'<>?#,]+)/gi;
const MEDIA_RE2 =
  /\/(?:wp-content\/uploads|media)\/([^\s"'<>?#,]+)/gi;

function decodePath(raw) {
  let s = String(raw || '').trim();
  s = s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#8217;/g, '\u2019')
    .replace(/&#8216;/g, '\u2018')
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&lsquo;/g, '\u2018');
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep */
  }
  s = s.replace(/\\/g, '/').replace(/^\/+/, '');
  // drop query/hash leftovers
  s = s.split('?')[0].split('#')[0];
  return s;
}

/** Clé de rapprochement (casse + apostrophes pliée). */
function normKey(rel) {
  return decodePath(rel)
    .toLowerCase()
    .replace(/[\u2018\u2019\u02BC\u0060']/g, "'");
}

function stripWpSize(rel) {
  return String(rel).replace(/-\d+x\d+(\.[a-z0-9]+)$/i, '$1');
}

function isThumbFile(name) {
  return /\.thumb\.webp$/i.test(name);
}

function kindOf(rel) {
  const ext = path.extname(rel).toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (ext === '.pdf') return 'pdf';
  if (['.doc', '.docx', '.odt', '.xls', '.xlsx', '.ods', '.ppt', '.pptx', '.odp', '.csv', '.txt', '.zip'].includes(ext))
    return 'document';
  return 'other';
}

function extractFromHtml(html, into, source) {
  if (!html) return;
  const text = String(html);
  for (const re of [MEDIA_RE, MEDIA_RE2]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const rel = decodePath(m[1]);
      if (!rel || isThumbFile(rel)) continue;
      if (!into.has(rel)) into.set(rel, new Set());
      into.get(rel).add(source);
    }
  }
}

async function walkFiles(dir, out = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    console.error('[audit] read fail', dir, err.message);
    return out;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      await walkFiles(abs, out);
      continue;
    }
    if (!ent.isFile()) continue;
    if (isThumbFile(ent.name)) continue;
    out.push(abs);
  }
  return out;
}

function fmtBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} o`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} Ko`;
  if (b < 1024 ** 3) return `${(b / 1024 / 1024).toFixed(1)} Mo`;
  return `${(b / 1024 ** 3).toFixed(2)} Go`;
}

async function main() {
  const mediaRoot = resolveMediaRoot(
    process.env.EL_MEDIA_ROOT || fileEnv.EL_MEDIA_ROOT || ''
  );
  console.log('[audit] root', mediaRoot);

  const pool = createPool({
    host: process.env.EL_DB_HOST || fileEnv.EL_DB_HOST || 'localhost',
    user: process.env.EL_DB_USER || fileEnv.EL_DB_USER || '',
    password: process.env.EL_DB_PASSWORD || fileEnv.EL_DB_PASSWORD || '',
    database:
      process.env.EL_DB_NAME ||
      fileEnv.EL_DB_NAME ||
      process.env.EL_DB_DATABASE ||
      fileEnv.EL_DB_DATABASE ||
      '',
  });

  /** @type {Map<string, Set<string>>} */
  const refs = new Map();

  const [articles] = await pool.query(
    `SELECT article_id, draft, body, excerpt, source_url
     FROM el_articles`
  );
  for (const a of articles) {
    const status = a.draft ? 'draft' : 'published';
    const src = `article:${a.article_id}:${status}`;
    extractFromHtml(a.body, refs, src);
    extractFromHtml(a.excerpt, refs, src);
    extractFromHtml(a.source_url, refs, src);
  }
  console.log('[audit] articles scanned', articles.length, 'unique media refs', refs.size);

  // Yoast / postmeta image caches (legacy, may still be linked externally)
  try {
    const [meta] = await pool.query(
      `SELECT post_id, meta_key, meta_value FROM eaxgw_postmeta
       WHERE meta_value LIKE '%/uploads/%' OR meta_value LIKE '%/media/%'
       LIMIT 50000`
    );
    for (const row of meta) {
      extractFromHtml(
        row.meta_value,
        refs,
        `postmeta:${row.post_id}:${row.meta_key}`
      );
    }
    console.log('[audit] postmeta rows scanned', meta.length);
  } catch (err) {
    console.warn('[audit] postmeta skip', err.message);
  }

  const [mediaRows] = await pool.query(
    `SELECT id, path, url, filename, mime, bytes, source FROM el_media`
  );
  const dbByPath = new Map();
  for (const row of mediaRows) {
    const rel = decodePath(row.path);
    dbByPath.set(rel, row);
  }
  console.log('[audit] el_media rows', mediaRows.length);

  const files = await walkFiles(mediaRoot);
  console.log('[audit] disk files (hors .thumb.webp)', files.length);

  const diskByRel = new Map();
  /** @type {Map<string, string>} normKey → canonical rel on disk */
  const diskByNorm = new Map();
  let diskBytes = 0;
  for (const abs of files) {
    const rel = path.relative(mediaRoot, abs).replace(/\\/g, '/');
    const st = await fs.stat(abs);
    diskByRel.set(rel, { abs, bytes: st.size, mtime: st.mtime.toISOString() });
    diskByNorm.set(normKey(rel), rel);
    diskBytes += st.size;
  }

  const dbByNorm = new Map();
  for (const rel of dbByPath.keys()) {
    dbByNorm.set(normKey(rel), rel);
  }

  function resolveRel(rel) {
    if (diskByRel.has(rel) || dbByPath.has(rel)) return rel;
    const viaNorm = diskByNorm.get(normKey(rel)) || dbByNorm.get(normKey(rel));
    if (viaNorm) return viaNorm;
    const original = stripWpSize(rel);
    if (original !== rel) {
      if (diskByRel.has(original) || dbByPath.has(original)) return original;
      const oNorm = diskByNorm.get(normKey(original)) || dbByNorm.get(normKey(original));
      if (oNorm) return oNorm;
    }
    return null;
  }

  // Build used set: exact ref OR original of a WP-sized ref that exists
  const usedExact = new Set();
  const usedViaOriginal = new Set();
  const brokenRefs = [];
  const legacySizeBroken = [];

  for (const [rel, sources] of refs) {
    const resolved = resolveRel(rel);
    if (resolved) {
      if (resolved === rel || normKey(resolved) === normKey(rel)) {
        usedExact.add(resolved);
      } else {
        usedViaOriginal.add(resolved);
        legacySizeBroken.push({
          ref: rel,
          resolvesTo: resolved,
          sources: [...sources].slice(0, 5),
          sourceCount: sources.size,
        });
      }
      continue;
    }
    brokenRefs.push({
      ref: rel,
      sources: [...sources].slice(0, 5),
      sourceCount: sources.size,
    });
  }

  const used = new Set([...usedExact, ...usedViaOriginal]);

  // Site-displayed = referenced from published articles only
  const usedPublished = new Set();
  for (const [rel, sources] of refs) {
    const fromPub = [...sources].some((s) => s.includes(':published'));
    if (!fromPub) continue;
    const resolved = resolveRel(rel);
    if (resolved) usedPublished.add(resolved);
  }

  const unusedOnDisk = [];
  let unusedBytes = 0;
  const unusedByKind = { image: 0, pdf: 0, document: 0, other: 0 };
  const unusedBytesByKind = { image: 0, pdf: 0, document: 0, other: 0 };

  for (const [rel, info] of diskByRel) {
    // « Affiché par le site » = référencé par un article publié uniquement.
    if (usedPublished.has(rel)) continue;
    const kind = kindOf(rel);
    unusedOnDisk.push({
      path: rel,
      bytes: info.bytes,
      kind,
      inElMedia: dbByPath.has(rel),
      mtime: info.mtime,
    });
    unusedBytes += info.bytes;
    unusedByKind[kind] = (unusedByKind[kind] || 0) + 1;
    unusedBytesByKind[kind] = (unusedBytesByKind[kind] || 0) + info.bytes;
  }

  // Sort unused by size desc for samples
  unusedOnDisk.sort((a, b) => b.bytes - a.bytes);

  const usedOnDisk = [];
  let usedBytes = 0;
  const usedByKind = { image: 0, pdf: 0, document: 0, other: 0 };
  for (const rel of usedPublished) {
    const info = diskByRel.get(rel);
    if (!info) continue;
    const kind = kindOf(rel);
    usedOnDisk.push({ path: rel, bytes: info.bytes, kind });
    usedBytes += info.bytes;
    usedByKind[kind] = (usedByKind[kind] || 0) + 1;
  }

  // Files on disk never in el_media
  let orphanDisk = 0;
  let orphanDiskBytes = 0;
  for (const [rel, info] of diskByRel) {
    if (!dbByPath.has(rel)) {
      orphanDisk++;
      orphanDiskBytes += info.bytes;
    }
  }

  // el_media rows with missing file
  let dbMissingFile = 0;
  for (const rel of dbByPath.keys()) {
    if (!diskByRel.has(rel)) dbMissingFile++;
  }

  const unusedByTop = {};
  const unusedBytesByTop = {};
  for (const it of unusedOnDisk) {
    const top = it.path.split('/')[0] || '(root)';
    unusedByTop[top] = (unusedByTop[top] || 0) + 1;
    unusedBytesByTop[top] = (unusedBytesByTop[top] || 0) + it.bytes;
  }
  const unusedTopFolders = Object.entries(unusedByTop)
    .map(([folder, count]) => ({
      folder,
      count,
      bytes: unusedBytesByTop[folder],
      bytesLabel: fmtBytes(unusedBytesByTop[folder]),
    }))
    .sort((a, b) => b.bytes - a.bytes);

  const brokenSized = brokenRefs.filter((b) =>
    /-\d+x\d+\.[a-z0-9]+$/i.test(b.ref)
  ).length;

  const report = {
    generatedAt: new Date().toISOString(),
    mediaRoot,
    scope:
      'Référence site = chemins /media/ ou /wp-content/uploads/ dans el_articles (body, excerpt, source_url) + postmeta legacy. Fichiers .thumb.webp exclus. Matching normalisé (casse, apostrophes).',
    totals: {
      articles: articles.length,
      publishedArticles: articles.filter((a) => !a.draft).length,
      uniqueRefsInContent: refs.size,
      diskFiles: diskByRel.size,
      diskBytes,
      diskBytesLabel: fmtBytes(diskBytes),
      elMediaRows: mediaRows.length,
      usedByPublishedSite: usedPublished.size,
      usedByPublishedOnDisk: usedOnDisk.length,
      usedByPublishedBytes: usedBytes,
      usedByPublishedBytesLabel: fmtBytes(usedBytes),
      unusedByPublishedOnDisk: unusedOnDisk.length,
      unusedByPublishedBytes: unusedBytes,
      unusedByPublishedBytesLabel: fmtBytes(unusedBytes),
      brokenRefs: brokenRefs.length,
      brokenRefsWpSized: brokenSized,
      brokenRefsOther: brokenRefs.length - brokenSized,
      legacySizeRefsMissingButOriginalExists: legacySizeBroken.length,
      diskNotInElMedia: orphanDisk,
      diskNotInElMediaBytesLabel: fmtBytes(orphanDiskBytes),
      elMediaMissingOnDisk: dbMissingFile,
    },
    usedByKind,
    unusedByKind,
    unusedBytesByKind: Object.fromEntries(
      Object.entries(unusedBytesByKind).map(([k, v]) => [k, fmtBytes(v)])
    ),
    unusedTopFolders: unusedTopFolders.slice(0, 30),
    samples: {
      largestUnused: unusedOnDisk.slice(0, 40),
      brokenRefs: brokenRefs.slice(0, 40),
      legacySizeBroken: legacySizeBroken.slice(0, 40),
    },
  };

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(report, null, 2));
  // full unused list alongside
  const unusedOut = OUT.replace(/\.json$/, '.unused.json');
  await fs.writeFile(
    unusedOut,
    JSON.stringify(
      {
        generatedAt: report.generatedAt,
        count: unusedOnDisk.length,
        bytes: unusedBytes,
        items: unusedOnDisk,
      },
      null,
      2
    )
  );

  console.log('\n=== AUDIT MÉDIAS SITE ===');
  console.log(JSON.stringify(report.totals, null, 2));
  console.log('usedByKind', usedByKind);
  console.log('unusedByKind', unusedByKind);
  console.log('report', OUT);
  console.log('unused list', unusedOut);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
