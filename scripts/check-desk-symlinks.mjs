#!/usr/bin/env node
/**
 * Vérifie que tout import `./foo.mjs` depuis shared/ est joignable sous /desk/foo.mjs
 * (nginx ne sert que desk/ — sinon le pupitre ne boot pas).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharedDir = path.join(root, 'shared');
const deskDir = path.join(root, 'desk');

const IMPORT_RE = /from\s+['"]\.\/([^'"]+\.mjs)['"]/g;

/** @param {string} p */
function resolveModule(p) {
  if (!fs.existsSync(p)) return null;
  let real = fs.realpathSync(p);
  if (real.startsWith(sharedDir)) return real;
  return real;
}

/** @param {string} file */
function localImports(file) {
  const src = fs.readFileSync(file, 'utf8');
  const hits = new Set();
  for (const m of src.matchAll(IMPORT_RE)) {
    hits.add(m[1]);
  }
  return [...hits];
}

/** @param {string} entry */
function collectSharedModules(entry, seen = new Set()) {
  const real = resolveModule(entry);
  if (!real || !real.startsWith(sharedDir) || seen.has(real)) return seen;
  seen.add(real);
  for (const rel of localImports(real)) {
    collectSharedModules(path.join(sharedDir, rel.replace(/^\.\//, '')), seen);
  }
  return seen;
}

/** Modules shared atteints depuis desk/app.js (symlinks desk/*.js inclus). */
function deskSharedClosure() {
  const queue = [path.join(deskDir, 'app.js')];
  const visited = new Set();
  const sharedModules = new Set();

  while (queue.length) {
    const file = queue.pop();
    if (!file || visited.has(file) || !fs.existsSync(file)) continue;
    visited.add(file);

    const real = fs.realpathSync(file);
    if (real.startsWith(sharedDir)) {
      for (const s of collectSharedModules(real)) sharedModules.add(s);
    }

    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue;
      let resolved = path.resolve(path.dirname(file), spec);
      if (!path.extname(resolved)) resolved += '.js';
      if (fs.existsSync(resolved)) queue.push(resolved);
    }
  }
  return sharedModules;
}

const sharedUsed = deskSharedClosure();
const missing = [];

for (const mod of sharedUsed) {
  for (const rel of localImports(mod)) {
    const base = rel.replace(/\.mjs$/, '');
    const deskLink = path.join(deskDir, `${base}.mjs`);
    if (!fs.existsSync(deskLink)) {
      missing.push({
        from: path.relative(root, mod),
        import: rel,
        need: path.relative(root, deskLink),
      });
    }
  }
}

if (missing.length) {
  console.error('Symlinks pupitre manquants (le JS ne chargera pas) :\n');
  for (const m of missing) {
    console.error(`  ${m.from} → import ./${m.import}`);
    console.error(`    ln -sf ../shared/${m.import} ${m.need}\n`);
  }
  process.exit(1);
}

console.log(
  `OK — ${sharedUsed.size} module(s) shared dans le graphe pupitre, symlinks desk/*.mjs complets.`
);
