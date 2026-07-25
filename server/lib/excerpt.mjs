/**
 * Excerpt = début proportionnel du corps (hors chapô gras en tête).
 * Aligné WP editorial-excerpt (~17 % du texte).
 */

const CHAPO_LEAD_RE =
  /^\s*<p[^>]*>\s*<strong>[\s\S]*?<\/strong>\s*<\/p>\s*/i;

export function stripLeadingChapoHtml(html) {
  return String(html || '').replace(CHAPO_LEAD_RE, '');
}

export function stripHtmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} bodyHtml
 * @param {{ ratio?: number, minChars?: number, maxChars?: number }} [opts]
 */
export function deriveExcerptFromBody(bodyHtml, opts = {}) {
  const ratio = opts.ratio ?? 0.17;
  const minChars = opts.minChars ?? 120;
  const maxChars = opts.maxChars ?? 420;
  const plain = stripHtmlToText(stripLeadingChapoHtml(bodyHtml));
  if (!plain) return '';
  const target = Math.max(
    minChars,
    Math.min(maxChars, Math.floor(plain.length * ratio))
  );
  if (plain.length <= target) return plain;
  let cut = plain.slice(0, target);
  const sp = cut.lastIndexOf(' ');
  if (sp > target * 0.55) cut = cut.slice(0, sp);
  cut = cut.trim();
  return cut ? `${cut}…` : plain.slice(0, target).trim();
}
