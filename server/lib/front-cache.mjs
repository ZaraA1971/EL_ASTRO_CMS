/**
 * Invalide le cache nginx du front après mutation éditoriale.
 */
import { spawn } from 'node:child_process';

const CACHE_DIRS = [
  '/var/cache/nginx/el-astro-prod',
  // legacy staging zones (no-op si vides)
  '/var/cache/nginx/el-astro',
  '/var/cache/nginx/el-astro-qualif',
];

export function purgeFrontCache() {
  for (const dir of CACHE_DIRS) {
    try {
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
