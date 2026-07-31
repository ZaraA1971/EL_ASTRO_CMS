/** Compteur in-memory pour invalider les caches HTTP courts (core, sans side-effects host). */
let contentGen = Date.now();

export function bumpContentGen() {
  contentGen = Date.now();
  return contentGen;
}

export function getContentGen() {
  return contentGen;
}
