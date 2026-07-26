#!/usr/bin/env node
/**
 * Export pilote WP → src/content/articles/{id}-{slug}.md
 *
 * Usage:
 *   node scripts/export-wp-articles.mjs [--limit=100] [--page=1]
 *   node scripts/export-wp-articles.mjs --all
 *
 * - Contenu via REST publique
 * - access granted via scripts/list-granted-ids.php (WP-CLI/PHP local)
 * - URLs médias → chemins relatifs /wp-content/uploads/ (servis par nginx alias)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import matter from 'gray-matter';
import he from 'he';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'src/content/articles');
const WP_API = process.env.EL_WP_API || 'https://electronlibre.info/wp-json/wp/v2';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  })
);
const EXPORT_ALL = Boolean(args.all);
const LIMIT = EXPORT_ALL
  ? Number.POSITIVE_INFINITY
  : Math.min(Number(args.limit || 100), 5000);
const START_PAGE = Number(args.page || 1);

function loadGrantedSet() {
  const php = path.join(ROOT, 'scripts/list-granted-ids.php');
  try {
    const out = execFileSync('php', [php], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    const ids = JSON.parse(out.trim());
    return new Set(ids.map(Number));
  } catch (err) {
    console.warn('[export] granted IDs unavailable — default access=subscribers', err.message);
    return new Set();
  }
}

function loadLangMap() {
  const php = path.join(ROOT, 'scripts/list-post-langs.php');
  try {
    const out = execFileSync('php', [php], { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 });
    return JSON.parse(out.trim());
  } catch (err) {
    console.warn('[export] lang map unavailable — default lang=fr', err.message);
    return {};
  }
}

/** @deprecated Ne plus importer le cache WP _ia_keywords (auto à la visite). */
function loadIaKeywordsMap() {
  return {};
}

function loadTranslationsMap() {
  const php = path.join(ROOT, 'scripts/list-translations.php');
  try {
    const out = execFileSync('php', [php], { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 });
    return JSON.parse(out.trim());
  } catch (err) {
    console.warn('[export] translations unavailable', err.message);
    return {};
  }
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'el-astro-export/1.0' },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const totalPages = Number(res.headers.get('x-wp-totalpages') || 1);
  const total = Number(res.headers.get('x-wp-total') || 0);
  const data = await res.json();
  return { data, totalPages, total };
}

async function loadMap(endpoint, fields = 'id,slug,name') {
  const map = new Map();
  let page = 1;
  let totalPages = 1;
  do {
    const url = `${WP_API}/${endpoint}?per_page=100&page=${page}&_fields=${fields}`;
    const { data, totalPages: tp } = await fetchJson(url);
    totalPages = tp;
    for (const row of data) {
      map.set(row.id, { slug: row.slug, name: row.name });
    }
    page += 1;
  } while (page <= totalPages);
  return map;
}

/** Absolu WP → relatif (servi par nginx alias sur staging/cutover). */
function rewriteMediaUrls(html) {
  return String(html || '').replace(
    /https?:\/\/(?:www\.)?electronlibre\.info\/(?:wp-content\/uploads|media)\//gi,
    '/media/'
  ).replace(/\/wp-content\/uploads\//gi, '/media/');
}

function cleanHtml(html) {
  let s = String(html || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  // Neutralise shortcodes WP courants non portés
  s = s.replace(/\[\/?(?:caption|gallery|embed|audio|video)[^\]]*\]/gi, '');
  s = rewriteMediaUrls(s);
  return s.trim();
}

function stripTags(html) {
  return he
    .decode(String(html || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function yamlSafe(s) {
  return String(s || '')
    .replace(/\r/g, '')
    .replace(/\t/g, ' ');
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const granted = loadGrantedSet();
  const langs = loadLangMap();
  const iaKeywords = loadIaKeywordsMap();
  const translations = loadTranslationsMap();
  console.log(
    `[export] granted IDs: ${granted.size} · lang map: ${Object.keys(langs).length} · ia keywords: ${Object.keys(iaKeywords).length} · translations: ${Object.keys(translations).length}`
  );

  const categories = await loadMap('categories');
  const tags = await loadMap('tags');
  const users = await loadMap('users', 'id,slug,name');

  let exported = 0;
  let page = START_PAGE;
  const perPage = EXPORT_ALL ? 100 : Math.min(Number.isFinite(LIMIT) ? LIMIT : 100, 100);
  const limitLabel = EXPORT_ALL ? 'all' : String(LIMIT);

  console.log(
    `[export] mode=${EXPORT_ALL ? 'all' : 'limit'} target=${limitLabel} per_page=${perPage} start_page=${START_PAGE}`
  );

  while (exported < LIMIT) {
    const need = EXPORT_ALL
      ? perPage
      : Math.min(perPage, LIMIT - exported);
    const url =
      `${WP_API}/posts?per_page=${need}&page=${page}` +
      `&_fields=id,slug,link,title,content,excerpt,date,modified,author,categories,tags`;
    const { data: posts, totalPages, total } = await fetchJson(url);
    if (!posts.length) break;

    for (const post of posts) {
      const id = post.id;
      const slug = post.slug;
      const filename = `${id}-${slug}.md`;
      const title = he.decode(post.title?.rendered || '').trim();
      const excerpt = rewriteMediaUrls(stripTags(post.excerpt?.rendered || ''));
      const body = cleanHtml(post.content?.rendered || '');
      const author = users.get(post.author) || { name: 'ElectronLibre', slug: 'electronlibre' };
      const cats = (post.categories || [])
        .map((cid) => categories.get(cid))
        .filter(Boolean);
      const tagList = (post.tags || [])
        .map((tid) => tags.get(tid))
        .filter(Boolean);

      const access = granted.has(id) ? 'granted' : 'subscribers';
      const lang = langs[String(id)] === 'en' ? 'en' : 'fr';
      const pair = translations[String(id)] || null;

      const front = {
        wp_id: id,
        title: yamlSafe(title),
        slug,
        date: post.date,
        modified: post.modified,
        author: author.name,
        author_slug: author.slug,
        categories: cats.map((c) => c.slug),
        category_names: cats.map((c) => c.name),
        tags: tagList.map((t) => t.slug),
        // Mots-clés IA : uniquement via le pupitre (pas le cache WP auto)
        ia_keywords: [],
        access,
        lang,
        source_url: post.link,
        excerpt: yamlSafe(excerpt),
        draft: false,
      };
      if (pair?.fr) front.translation_fr = Number(pair.fr);
      if (pair?.en) front.translation_en = Number(pair.en);

      const file = matter.stringify(body + '\n', front);
      fs.writeFileSync(path.join(OUT_DIR, filename), file, 'utf8');
      exported += 1;
      if (exported % 50 === 0 || exported === 1) {
        const denom = total || limitLabel;
        console.log(`[export] ${exported}/${denom} … ${filename} (${access}/${lang})`);
      }
      if (exported >= LIMIT) break;
    }

    if (page >= totalPages) break;
    page += 1;
  }

  console.log(`[export] done — ${exported} files in ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
