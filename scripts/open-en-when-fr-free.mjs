#!/usr/bin/env node
/**
 * Ouvre les articles EN dont le jumeau FR est déjà gratuit.
 * Usage: node scripts/open-en-when-fr-free.mjs [--apply]
 */
import fs from 'node:fs';
import mysql from 'mysql2/promise';

const APPLY = process.argv.includes('--apply');
const ENV_FILE = process.env.EL_API_ENV_FILE || '/etc/electronlibre/el-astro-api.env';

function loadEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line || line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const env = loadEnv(ENV_FILE);
const pool = mysql.createPool({
  host: process.env.EL_DB_HOST || env.EL_DB_HOST || 'localhost',
  user: process.env.EL_DB_USER || env.EL_DB_USER || '',
  password: process.env.EL_DB_PASSWORD || env.EL_DB_PASSWORD || '',
  database: process.env.EL_DB_NAME || env.EL_DB_NAME || 'electronlibre',
  waitForConnections: true,
  connectionLimit: 2,
});

const [rows] = await pool.query(
  `SELECT en.article_id, en.slug, LEFT(en.title, 80) AS title, fr.article_id AS fr_id
   FROM el_articles en
   JOIN el_articles fr ON fr.article_id = en.translation_fr
   WHERE en.draft = 0 AND en.lang = 'en' AND en.access = 'subscribers'
     AND fr.draft = 0 AND fr.access = 'granted'
   ORDER BY en.date DESC`
);

console.log(`[open-en] ${rows.length} EN to open (FR already free)`);
for (const row of rows.slice(0, 12)) {
  console.log(`  #${row.article_id} ← FR #${row.fr_id}  ${row.title}`);
}
if (rows.length > 12) console.log(`  … +${rows.length - 12}`);

if (!APPLY) {
  console.log('[open-en] dry-run — pass --apply to update');
  await pool.end();
  process.exit(0);
}

const [result] = await pool.query(
  `UPDATE el_articles en
   JOIN el_articles fr ON fr.article_id = en.translation_fr
   SET en.access = 'granted', en.modified = UTC_TIMESTAMP()
   WHERE en.draft = 0 AND en.lang = 'en' AND en.access = 'subscribers'
     AND fr.draft = 0 AND fr.access = 'granted'`
);
console.log(`[open-en] updated ${result.affectedRows || 0}`);
await pool.end();
