/** Aligné sur server/lib/editorial-update.mjs — délai avant libellé « Mis à jour ». */
export const EDITORIAL_UPDATE_GRACE_MS = 45 * 60 * 1000;

export function isPastEditorialUpdateGrace(published, now = Date.now()) {
  if (published == null || published === "") return false;
  const pub = new Date(published).getTime();
  if (Number.isNaN(pub)) return false;
  const t = typeof now === "number" ? now : new Date(now).getTime();
  return t - pub >= EDITORIAL_UPDATE_GRACE_MS;
}
