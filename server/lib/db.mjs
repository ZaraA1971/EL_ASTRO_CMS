import fs from 'node:fs';
import mysql from 'mysql2/promise';

export {
  parseJsonArray,
  parseRowDate,
  rowToArticle,
} from './article-row.mjs';

export function loadEnvFile(file) {
  const out = {};
  try {
    const raw = fs.readFileSync(file, 'utf8');
    for (const line of raw.split('\n')) {
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
  } catch (err) {
    console.error('[api] env read failed', file, err.message);
  }
  return out;
}

export function createPool(DB) {
  return mysql.createPool({
    ...DB,
    waitForConnections: true,
    connectionLimit: 8,
  });
}
