#!/usr/bin/env node
/**
 * Sync translation_fr / translation_en depuis meta WP.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import matter from 'gray-matter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'src/content/articles');

const php = path.join(ROOT, 'scripts/list-translations.php');
const map = JSON.parse(
  execFileSync('php', [php], { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 }).trim()
);

const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.md'));
let updated = 0;
let withPair = 0;

for (const name of files) {
  const file = path.join(OUT_DIR, name);
  const m = name.match(/^(\d+)-/);
  if (!m) continue;
  const id = m[1];
  const pair = map[id] || null;

  let parsed;
  try {
    parsed = matter.read(file);
  } catch {
    continue;
  }

  const { data, content } = parsed;
  if (pair?.fr) {
    data.translation_fr = Number(pair.fr);
    withPair += 1;
  } else {
    delete data.translation_fr;
  }
  if (pair?.en) {
    data.translation_en = Number(pair.en);
  } else {
    delete data.translation_en;
  }

  const next = matter.stringify(content, data);
  if (next !== fs.readFileSync(file, 'utf8')) {
    fs.writeFileSync(file, next, 'utf8');
    updated += 1;
  }
}

console.log(
  `[sync-translations] files=${files.length} updated=${updated} with_pair=${withPair}`
);
