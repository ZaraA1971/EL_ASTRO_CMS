/**
 * Invalide le cache nginx du front après mutation éditoriale.
 * Purge = fichiers seulement. Ne jamais supprimer les dossiers zone
 * (sinon 502 nginx : mkdir() failed No such file — voir CURSOR.md).
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const CACHE_DIRS = [
  '/var/cache/nginx/el-astro-prod',
  // legacy staging zones (no-op si vides)
  '/var/cache/nginx/el-astro',
  '/var/cache/nginx/el-astro-qualif',
];

function ensureZoneDir(dir) {
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    // Permission / hors contexte : la purge find échouera silencieusement.
    console.warn('[front-cache] mkdir failed', dir, err.message);
  }
}

export function purgeFrontCache() {
  for (const dir of CACHE_DIRS) {
    try {
      ensureZoneDir(dir);
      const child = spawn('find', [dir, '-type', 'f', '-delete'], {
        stdio: 'ignore',
        detached: true,
      });
      child.unref();
    } catch (err) {
      console.warn('[front-cache] purge failed', dir, err.message);
    }
  }
}
