#!/usr/bin/env node
/**
 * Importe src/content/articles/*.md → MySQL el_articles.
 * Usage: node scripts/import-md-to-el-articles.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ARTICLES_DIR = path.join(ROOT, 'src/content/articles');
const ENV_FILE = process.env.EL_API_ENV_FILE || '/etc/electronlibre/el-astro-api.env';
const SQL_FILE = path.join(__dirname, 'sql/el_articles.sql');

function loadEnvFile(file) {
  const out = {};
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
  } catch (err) {
    console.error('env read failed', err.message);
    process.exit(1);
  }
  return out;
}

function toMysqlDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function asJsonArray(v) {
  if (!v) return JSON.stringify([]);
  if (Array.isArray(v)) return JSON.stringify(v.map(String));
  return JSON.stringify([String(v)]);
}

function rewriteMediaUrls(html) {
  return String(html || '').replace(
    /https?:\/\/(?:www\.)?electronlibre\.info\/(?:wp-content\/uploads|media)\//gi,
    '/media/'
  ).replace(/\/wp-content\/uploads\//gi, '/media/');
}

const env = loadEnvFile(ENV_FILE);
const pool = mysql.createPool({
  host: env.EL_DB_HOST || 'localhost',
  user: env.EL_DB_USER,
  password: env.EL_DB_PASSWORD,
  database: env.EL_DB_NAME || 'electronlibre',
  waitForConnections: true,
  connectionLimit: 3,
});

const sql = fs.readFileSync(SQL_FILE, 'utf8');
await pool.query(sql);

const [users] = await pool.query(
  'SELECT id, login, display_name FROM el_users'
);
const byLogin = new Map(users.map((u) => [String(u.login).toLowerCase(), u.id]));
const byName = new Map(
  users.map((u) => [String(u.display_name).toLowerCase(), u.id])
);

const files = fs
  .readdirSync(ARTICLES_DIR)
  .filter((f) => f.endsWith('.md'))
  .sort();

let upserted = 0;
let errors = 0;

for (const file of files) {
  try {
    const raw = fs.readFileSync(path.join(ARTICLES_DIR, file), 'utf8');
    const { data, content } = matter(raw);
    const wpId = Number(data.wp_id);
    if (!wpId) {
      console.warn('skip no wp_id', file);
      errors++;
      continue;
    }
    const author = String(data.author || 'ElectronLibre');
    const authorSlug = data.author_slug ? String(data.author_slug) : null;
    const authorUserId =
      (authorSlug && byLogin.get(authorSlug.toLowerCase())) ||
      byName.get(author.toLowerCase()) ||
      null;

    await pool.query(
      `INSERT INTO el_articles (
        wp_id, slug, title, excerpt, body, date, modified,
        author, author_slug, author_user_id,
        categories, category_names, tags, ia_keywords,
        access, lang, draft, translation_fr, translation_en, source_url
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE
        slug=VALUES(slug), title=VALUES(title), excerpt=VALUES(excerpt),
        body=VALUES(body), date=VALUES(date), modified=VALUES(modified),
        author=VALUES(author), author_slug=VALUES(author_slug),
        author_user_id=COALESCE(VALUES(author_user_id), author_user_id),
        categories=VALUES(categories), category_names=VALUES(category_names),
        tags=VALUES(tags), ia_keywords=VALUES(ia_keywords),
        access=VALUES(access), lang=VALUES(lang), draft=VALUES(draft),
        translation_fr=VALUES(translation_fr), translation_en=VALUES(translation_en),
        source_url=VALUES(source_url)`,
      [
        wpId,
        String(data.slug || file.replace(/\.md$/, '')),
        String(data.title || 'Sans titre'),
        rewriteMediaUrls(String(data.excerpt || '')),
        rewriteMediaUrls(String(content || '').trim()),
        toMysqlDate(data.date) || toMysqlDate(new Date()),
        toMysqlDate(data.modified),
        author,
        authorSlug,
        authorUserId,
        asJsonArray(data.categories),
        asJsonArray(data.category_names),
        asJsonArray(data.tags),
        asJsonArray(data.ia_keywords),
        data.access === 'granted' ? 'granted' : 'subscribers',
        String(data.lang || 'fr').toLowerCase(),
        data.draft === true ? 1 : 0,
        data.translation_fr != null ? Number(data.translation_fr) : null,
        data.translation_en != null ? Number(data.translation_en) : null,
        data.source_url ? String(data.source_url) : null,
      ]
    );
    upserted++;
    if (upserted % 100 === 0) console.log('…', upserted);
  } catch (err) {
    console.error('fail', file, err.message);
    errors++;
  }
}

const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM el_articles');
console.log(JSON.stringify({ upserted, errors, total: n }));
await pool.end();
