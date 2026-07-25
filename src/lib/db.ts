import fs from 'node:fs';
import mysql from 'mysql2/promise';
import type { Pool } from 'mysql2/promise';

const ENV_FILE = process.env.EL_API_ENV_FILE || '/etc/electronlibre/el-astro-api.env';

function loadEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
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
  } catch {
    // ignore
  }
  return out;
}

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  const fileEnv = loadEnvFile(ENV_FILE);
  const DB = {
    host: process.env.EL_DB_HOST || fileEnv.EL_DB_HOST || 'localhost',
    user: process.env.EL_DB_USER || fileEnv.EL_DB_USER || '',
    password: process.env.EL_DB_PASSWORD || fileEnv.EL_DB_PASSWORD || '',
    database: process.env.EL_DB_NAME || fileEnv.EL_DB_NAME || 'electronlibre',
  };
  if (!DB.user) {
    throw new Error('EL DB credentials missing for Astro SSR');
  }
  pool = mysql.createPool({
    ...DB,
    waitForConnections: true,
    connectionLimit: 5,
  });
  return pool;
}

export function parseJsonArray(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}
