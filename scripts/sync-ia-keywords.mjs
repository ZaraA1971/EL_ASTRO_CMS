#!/usr/bin/env node
/**
 * Sync ia_keywords via gray-matter (sûr) depuis meta WP _ia_keywords.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import matter from 'gray-matter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'src/content/articles');

function loadIaKeywordsMap() {
  const php = path.join(ROOT, 'scripts/list-ia-keywords.php');
  const out = execFileSync('php', [php], { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 });
  return JSON.parse(out.trim());
}

const map = loadIaKeywordsMap();
const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.md'));
let updated = 0;
let withKw = 0;
let broken = 0;

for (const name of files) {
  const file = path.join(OUT_DIR, name);
  const m = name.match(/^(\d+)-/);
  if (!m) continue;
  const id = m[1];
  const keywords = Array.isArray(map[id]) ? map[id].map(String) : [];
  if (keywords.length) withKw += 1;

  let parsed;
  try {
    parsed = matter.read(file);
  } catch (err) {
    console.warn(`[sync-ia] BROKEN ${name}: ${err.message}`);
    broken += 1;
    continue;
  }

  const { data, content } = parsed;
  if (!data || typeof data.wp_id === 'undefined') {
    broken += 1;
    continue;
  }

  // Répare d’éventuelles listes orphelines / draft corrompu
  if (typeof data.draft === 'string') {
    data.draft = data.draft === 'true' || data.draft === 'false' ? data.draft === 'true' : false;
  }
  if (typeof data.draft !== 'boolean') data.draft = false;

  data.ia_keywords = keywords;

  const next = matter.stringify(content, data);
  if (next !== fs.readFileSync(file, 'utf8')) {
    fs.writeFileSync(file, next, 'utf8');
    updated += 1;
  }
}

console.log(
  `[sync-ia-keywords] files=${files.length} updated=${updated} with_keywords=${withKw} broken=${broken}`
);
