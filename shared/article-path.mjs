/**
 * URL publique article — source unique.
 * Forme : `/articles/{article_id}-{slug}/`
 */

function resolveIdSlug(articleOrId, slug) {
  if (slug != null && (typeof articleOrId === 'number' || typeof articleOrId === 'string')) {
    return {
      id: Number(articleOrId) || 0,
      slug: String(slug || 'article') || 'article',
    };
  }
  const a = articleOrId?.data || articleOrId || {};
  return {
    id: Number(a.article_id) || 0,
    slug: String(a.slug || 'article') || 'article',
  };
}

/** Chemin relatif avec slash final. */
export function articlePath(articleOrId, slug) {
  const { id, slug: s } = resolveIdSlug(articleOrId, slug);
  if (!id) return '';
  return `/articles/${id}-${s}/`;
}

/** Segment `{id}-{slug}` (sans slashes). */
export function articleIdSlug(articleOrId, slug) {
  const { id, slug: s } = resolveIdSlug(articleOrId, slug);
  if (!id) return '';
  return `${id}-${s}`;
}

/** URL absolue ; si `siteUrl` vide → chemin relatif. */
export function absoluteArticleUrl(siteUrl, articleOrId, slug) {
  const path = articlePath(articleOrId, slug);
  if (!path) return '';
  const base = String(siteUrl || '').replace(/\/+$/, '');
  return base ? `${base}${path}` : path;
}
