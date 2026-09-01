/**
 * Sitemap Google News — source unique (script statique + Astro).
 *
 * Un urlset sans <url> est refusé par GSC (« balise url manquante »).
 * Fenêtre officielle : 2 jours ; si vide, on garde les derniers articles.
 */

export const NEWS_SITEMAP_DAYS = 2;
export const NEWS_SITEMAP_FALLBACK = 20;

export function xmlEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function isoDate(d) {
  const dt = d instanceof Date ? d : new Date(String(d || ''));
  if (Number.isNaN(dt.getTime())) {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  return dt.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function newsLang(lang) {
  return String(lang || 'fr')
    .toLowerCase()
    .startsWith('en')
    ? 'en'
    : 'fr';
}

/**
 * @param {Array<{ article_id?: number, slug?: string, title?: string, date?: Date|string, lang?: string }>} rows
 * @param {{ locOf: (row: object) => string, name?: string }} opts
 */
export function newsSitemapXml(rows, opts) {
  const locOf = opts.locOf;
  const name = xmlEscape(opts.name || 'ElectronLibre');
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml +=
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n';
  for (const row of rows || []) {
    const loc = locOf(row);
    if (!loc) continue;
    xml += '  <url>\n';
    xml += `    <loc>${xmlEscape(loc)}</loc>\n`;
    xml += '    <news:news>\n';
    xml += '      <news:publication>\n';
    xml += `        <news:name>${name}</news:name>\n`;
    xml += `        <news:language>${newsLang(row.lang)}</news:language>\n`;
    xml += '      </news:publication>\n';
    xml += `      <news:publication_date>${xmlEscape(isoDate(row.date))}</news:publication_date>\n`;
    xml += `      <news:title>${xmlEscape(row.title)}</news:title>\n`;
    xml += '    </news:news>\n';
    xml += '  </url>\n';
  }
  xml += '</urlset>\n';
  return xml;
}
