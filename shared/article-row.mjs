/**
 * Ligne MySQL el_articles → objet article desk/Astro — source unique.
 */

/** Normalise access stocké → `granted` | `subscribers`. */
export function normalizeAccess(v) {
  return v === 'granted' ? 'granted' : 'subscribers';
}

/** Épinglé en Une (sticky WP). */
export function normalizePinned(v) {
  return v === true || v === 1 || v === '1';
}

export function parseJsonArray(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function parseRowDate(v) {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {object|null|undefined} row
 * @param {{ includeBody?: boolean }} [opts]
 */
export function rowToArticle(row, { includeBody = true } = {}) {
  if (!row) return null;
  const date = parseRowDate(row.date);
  const modified = parseRowDate(row.modified);
  return {
    id: `db-${row.article_id}`,
    data: {
      article_id: Number(row.article_id),
      title: String(row.title || ''),
      slug: String(row.slug || ''),
      date,
      modified: modified || undefined,
      author: String(row.author || 'ElectronLibre'),
      author_slug: row.author_slug ? String(row.author_slug) : undefined,
      author_user_id:
        row.author_user_id != null ? Number(row.author_user_id) : null,
      categories: parseJsonArray(row.categories),
      category_names: parseJsonArray(row.category_names),
      tags: parseJsonArray(row.tags),
      ia_keywords: parseJsonArray(row.ia_keywords),
      translation_fr:
        row.translation_fr != null ? Number(row.translation_fr) : undefined,
      translation_en:
        row.translation_en != null ? Number(row.translation_en) : undefined,
      access: normalizeAccess(row.access),
      lang: String(row.lang || 'fr').toLowerCase(),
      source_url: row.source_url ? String(row.source_url) : undefined,
      excerpt: String(row.excerpt || ''),
      draft: Boolean(row.draft),
      pinned: normalizePinned(row.pinned),
    },
    body: includeBody ? String(row.body || '') : '',
  };
}
