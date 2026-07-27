import fs from 'node:fs';
import mysql from 'mysql2/promise';

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

export function parseJsonArray(v) {
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

function parseRowDate(v) {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function rowToArticle(row, { includeBody = true } = {}) {
  if (!row) return null;
  const date = parseRowDate(row.date);
  const modified = parseRowDate(row.modified);
  return {
    id: `db-${row.wp_id}`,
    data: {
      wp_id: Number(row.wp_id),
      title: row.title,
      slug: row.slug,
      date,
      modified: modified || undefined,
      author: row.author || 'ElectronLibre',
      author_slug: row.author_slug || undefined,
      author_user_id: row.author_user_id != null ? Number(row.author_user_id) : null,
      categories: parseJsonArray(row.categories),
      category_names: parseJsonArray(row.category_names),
      tags: parseJsonArray(row.tags),
      ia_keywords: parseJsonArray(row.ia_keywords),
      translation_fr:
        row.translation_fr != null ? Number(row.translation_fr) : undefined,
      translation_en:
        row.translation_en != null ? Number(row.translation_en) : undefined,
      access: row.access === 'granted' ? 'granted' : 'subscribers',
      lang: String(row.lang || 'fr').toLowerCase(),
      source_url: row.source_url || undefined,
      excerpt: row.excerpt || '',
      draft: Boolean(row.draft),
    },
    body: includeBody ? String(row.body || '') : '',
  };
}
