#!/usr/bin/env node
/**
 * Génère les sitemaps XML statiques (nginx les sert en 200 + Content-Length).
 * Usage: node scripts/build-sitemaps.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import {
  NEWS_SITEMAP_DAYS,
  NEWS_SITEMAP_FALLBACK,
  newsSitemapXml,
  xmlEscape,
  isoDate,
} from '../shared/sitemap-news.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'var/sitemaps');
const SITE = 'https://electronlibre.info';
const PAGE_SIZE = 2000;
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

function articleLoc(id, slug) {
  const n = Number(id) || 0;
  if (!n) return '';
  return `${SITE}/articles/${n}-${slug || 'article'}/`;
}

function writeAtomic(file, body) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, body, 'utf8');
  fs.renameSync(tmp, file);
}

const STATIC = [
  { loc: `${SITE}/`, changefreq: 'hourly', priority: '1.0' },
  { loc: `${SITE}/en/`, changefreq: 'hourly', priority: '0.9' },
  { loc: `${SITE}/abonnement/`, changefreq: 'monthly', priority: '0.6' },
  { loc: `${SITE}/a-propos/`, changefreq: 'yearly', priority: '0.3' },
  { loc: `${SITE}/mentions-legales/`, changefreq: 'yearly', priority: '0.2' },
  { loc: `${SITE}/search/`, changefreq: 'monthly', priority: '0.4' },
];

function buildIndex(locs) {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml +=
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  for (const loc of locs) {
    xml += '  <sitemap>\n';
    xml += `    <loc>${xmlEscape(loc)}</loc>\n`;
    xml += '  </sitemap>\n';
  }
  xml += '</sitemapindex>\n';
  return xml;
}

function buildUrlset(urls) {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  for (const u of urls) {
    if (!u.loc) continue;
    xml += '  <url>\n';
    xml += `    <loc>${xmlEscape(u.loc)}</loc>\n`;
    if (u.lastmod) xml += `    <lastmod>${xmlEscape(u.lastmod)}</lastmod>\n`;
    if (u.changefreq) xml += `    <changefreq>${xmlEscape(u.changefreq)}</changefreq>\n`;
    if (u.priority) xml += `    <priority>${xmlEscape(u.priority)}</priority>\n`;
    xml += '  </url>\n';
  }
  xml += '</urlset>\n';
  return xml;
}

async function main() {
  const env = loadEnv(ENV_FILE);
  const pool = mysql.createPool({
    host: process.env.EL_DB_HOST || env.EL_DB_HOST || 'localhost',
    user: process.env.EL_DB_USER || env.EL_DB_USER || '',
    password: process.env.EL_DB_PASSWORD || env.EL_DB_PASSWORD || '',
    database: process.env.EL_DB_NAME || env.EL_DB_NAME || 'electronlibre',
    waitForConnections: true,
    connectionLimit: 2,
  });

  fs.mkdirSync(OUT, { recursive: true });

  const [countRows] = await pool.query(
    'SELECT COUNT(*) AS n FROM el_articles WHERE draft = 0'
  );
  const total = Number(countRows[0]?.n || 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Index sous les 2 noms historiques + canon
  const indexLocs = [`${SITE}/wp-sitemap-pages.xml`];
  for (let i = 1; i <= pages; i += 1) {
    indexLocs.push(`${SITE}/wp-sitemap-posts-${i}.xml`);
  }
  const indexXml = buildIndex(indexLocs);
  for (const name of ['wp-sitemap.xml', 'sitemap_index.xml', 'sitemap.xml']) {
    writeAtomic(path.join(OUT, name), indexXml);
  }

  writeAtomic(path.join(OUT, 'wp-sitemap-pages.xml'), buildUrlset(STATIC));
  writeAtomic(path.join(OUT, 'sitemap-pages.xml'), buildUrlset(STATIC));

  for (let p = 1; p <= pages; p += 1) {
    const offset = (p - 1) * PAGE_SIZE;
    const [rows] = await pool.query(
      `SELECT article_id, slug, date, modified
       FROM el_articles
       WHERE draft = 0
       ORDER BY date DESC, article_id DESC
       LIMIT ? OFFSET ?`,
      [PAGE_SIZE, offset]
    );
    const urls = rows
      .map((r) => {
        const loc = articleLoc(r.article_id, r.slug);
        if (!loc) return null;
        return { loc, lastmod: isoDate(r.modified || r.date) };
      })
      .filter(Boolean);
    const xml = buildUrlset(urls);
    writeAtomic(path.join(OUT, `wp-sitemap-posts-${p}.xml`), xml);
    writeAtomic(path.join(OUT, `sitemap-posts-${p}.xml`), xml);
  }

  // Purge d’anciens chunks au-delà
  for (let p = pages + 1; p <= pages + 5; p += 1) {
    for (const prefix of ['wp-sitemap-posts', 'sitemap-posts']) {
      const f = path.join(OUT, `${prefix}-${p}.xml`);
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  }

  const [newsRows] = await pool.query(
    `SELECT article_id, slug, title, date, lang
     FROM el_articles
     WHERE draft = 0
       AND date >= (UTC_TIMESTAMP() - INTERVAL ? DAY)
     ORDER BY date DESC
     LIMIT 1000`,
    [NEWS_SITEMAP_DAYS]
  );
  let rows = newsRows;
  if (!rows.length) {
    const [fallback] = await pool.query(
      `SELECT article_id, slug, title, date, lang
       FROM el_articles
       WHERE draft = 0
       ORDER BY date DESC
       LIMIT ?`,
      [NEWS_SITEMAP_FALLBACK]
    );
    rows = fallback;
  }
  const news = newsSitemapXml(rows, {
    locOf: (row) => articleLoc(row.article_id, row.slug),
  });
  writeAtomic(path.join(OUT, 'news-sitemap.xml'), news);

  await pool.end();
  console.log(
    `[sitemaps] wrote ${pages} post chunks + index + news → ${OUT} (articles=${total})`
  );
}

main().catch((e) => {
  console.error('[sitemaps]', e);
  process.exit(1);
});
