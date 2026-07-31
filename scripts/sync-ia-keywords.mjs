#!/usr/bin/env node
/**
 * Migration mots-clés : purge ia_keywords, puis copie tags WP → ia_keywords.
 *
 * - Supprime tout contenu ia_keywords (imports / restes).
 * - Remplit ia_keywords avec les tags WP humanisés (slugs → libellés).
 * - Articles sans tags → ia_keywords = [].
 *
 * Usage :
 *   node scripts/sync-ia-keywords.mjs
 *   node scripts/sync-ia-keywords.mjs --dry-run
 *   node scripts/sync-ia-keywords.mjs --limit=100
 */
import { loadEnvFile, createPool, parseJsonArray } from '../server/lib/db.mjs';

const ENV_FILE = process.env.EL_API_ENV_FILE || '/etc/electronlibre/el-astro-api.env';
const fileEnv = loadEnvFile(ENV_FILE);

function arg(name, fallback = null) {
  const pref = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  if (hit) return hit.slice(pref.length);
  if (process.argv.includes(`--${name}`)) return true;
  return fallback;
}

const DRY = Boolean(arg('dry-run', false));
const LIMIT = Math.max(0, Number(arg('limit', 0)) || 0);

function humanizeTag(slug) {
  return String(slug || '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function tagsToIaKeywords(tags) {
  const seen = new Set();
  const out = [];
  for (const raw of tags) {
    const label = humanizeTag(raw).trim();
    // Autoriser 1 caractère (ex. tag WP « x » → X)
    if (!label) continue;
    const key = label.toLocaleLowerCase('fr');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

async function main() {
  const pool = createPool({
    host: process.env.EL_DB_HOST || fileEnv.EL_DB_HOST || 'localhost',
    user: process.env.EL_DB_USER || fileEnv.EL_DB_USER || '',
    password: process.env.EL_DB_PASSWORD || fileEnv.EL_DB_PASSWORD || '',
    database: process.env.EL_DB_NAME || fileEnv.EL_DB_NAME || 'electronlibre',
  });

  const [[before]] = await pool.query(`
    SELECT
      COUNT(*) AS total,
      SUM(ia_keywords IS NOT NULL AND JSON_LENGTH(ia_keywords) > 0) AS with_ia,
      SUM(tags IS NOT NULL AND JSON_LENGTH(tags) > 0) AS with_tags
    FROM el_articles
  `);
  console.log('[sync-ia-keywords] before', before, DRY ? '(dry-run)' : '');

  if (!DRY) {
    const [cleared] = await pool.query(
      `UPDATE el_articles SET ia_keywords = JSON_ARRAY()
       WHERE ia_keywords IS NULL OR JSON_LENGTH(COALESCE(ia_keywords, JSON_ARRAY())) > 0`
    );
    console.log('[sync-ia-keywords] purged ia_keywords', cleared.affectedRows);
  }

  let sql = `
    SELECT article_id, tags FROM el_articles
    WHERE tags IS NOT NULL AND JSON_LENGTH(tags) > 0
    ORDER BY article_id
  `;
  if (LIMIT) sql += ` LIMIT ${LIMIT}`;

  const [rows] = await pool.query(sql);
  let updated = 0;
  let emptyAfter = 0;

  for (const row of rows) {
    const tags = parseJsonArray(row.tags);
    const ia = tagsToIaKeywords(tags);
    if (!ia.length) {
      emptyAfter++;
      continue;
    }
    if (DRY) {
      if (updated < 5) {
        console.log('[dry]', row.article_id, tags.slice(0, 4), '→', ia.slice(0, 4));
      }
      updated++;
      continue;
    }
    await pool.query(
      'UPDATE el_articles SET ia_keywords = ? WHERE article_id = ?',
      [JSON.stringify(ia), row.article_id]
    );
    updated++;
    if (updated % 1000 === 0) {
      console.log(`[sync-ia-keywords] ${updated}/${rows.length}…`);
    }
  }

  const [[after]] = await pool.query(`
    SELECT
      COUNT(*) AS total,
      SUM(ia_keywords IS NOT NULL AND JSON_LENGTH(ia_keywords) > 0) AS with_ia,
      SUM(tags IS NOT NULL AND JSON_LENGTH(tags) > 0) AS with_tags
    FROM el_articles
  `);

  console.log('[sync-ia-keywords] done', {
    scannedWithTags: rows.length,
    updated,
    skippedEmptyHumanize: emptyAfter,
    after,
    dryRun: DRY,
  });

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
