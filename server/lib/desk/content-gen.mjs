import { purgeFrontCache } from '../front-cache.mjs';

/** In-memory generation for short HTTP cache busting */
let contentGen = Date.now();

export function bumpContentGen() {
  contentGen = Date.now();
  // Home / archives publiques : vider le cache nginx dès qu’un article change
  purgeFrontCache();
  return contentGen;
}

export function getContentGen() {
  return contentGen;
}
