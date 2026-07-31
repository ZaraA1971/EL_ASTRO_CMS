#!/usr/bin/env node
/**
 * Ajoute les index liste pupitre + backfill modified.
 * Idempotent : ignore les erreurs "Duplicate key name".
 */
import { loadEnvFile, createPool } from '../server/lib/db.mjs';

const ENV_FILE = process.env.EL_API_ENV_FILE || '/etc/electronlibre/el-astro-api.env';
const fileEnv = loadEnvFile(ENV_FILE);

const pool = createPool({
  host: process.env.EL_DB_HOST || fileEnv.EL_DB_HOST || 'localhost',
  user: process.env.EL_DB_USER || fileEnv.EL_DB_USER || '',
  password: process.env.EL_DB_PASSWORD || fileEnv.EL_DB_PASSWORD || '',
  database: process.env.EL_DB_NAME || fileEnv.EL_DB_NAME || 'electronlibre',
});

async function ensureIndex(name, ddl) {
  const [rows] = await pool.query(
    `SELECT 1 AS ok FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = 'el_articles' AND index_name = ?
     LIMIT 1`,
    [name]
  );
  if (rows.length) {
    console.log(`skip ${name} (exists)`);
    return;
  }
  await pool.query(ddl);
  console.log(`ok ${name}`);
}

async function main() {
  const [r] = await pool.query(
    'UPDATE el_articles SET modified = date WHERE modified IS NULL'
  );
  console.log('backfill modified:', r.affectedRows ?? r.changedRows ?? 0);

  await ensureIndex(
    'idx_list_modified',
    'ALTER TABLE el_articles ADD KEY idx_list_modified (modified, article_id)'
  );
  await ensureIndex(
    'idx_list_draft_modified',
    'ALTER TABLE el_articles ADD KEY idx_list_draft_modified (draft, modified, article_id)'
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
