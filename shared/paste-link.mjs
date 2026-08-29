/**
 * Lien depuis collage / saisie — source unique (pupitre).
 *
 * API principale : hrefFrom(data, context)
 *   context = 'clipboard' | 'prompt'
 *
 * clipboard : URL nette (texte ou un seul <a href>) — pour coller sur une sélection.
 * prompt    : saisie bouton Lien — même sanitization, accepte un hôte nu (https://).
 */

import { extractClipboardFragment } from './html-clean.mjs';

/**
 * @typedef {{
 *   inferHttps?: boolean,
 *   allowWww?: boolean,
 *   allowMailto?: boolean,
 *   allowRelative?: boolean,
 *   allowHash?: boolean,
 * }} PasteLinkRules
 */

/**
 * Règles par contexte — source de vérité pour les call-sites.
 * @type {Record<string, PasteLinkRules>}
 */
export const PASTE_LINK_CONTEXTS = {
  clipboard: {
    inferHttps: false,
    allowWww: true,
    allowMailto: true,
    allowRelative: true,
    allowHash: true,
  },
  prompt: {
    inferHttps: true,
    allowWww: true,
    allowMailto: true,
    allowRelative: true,
    allowHash: true,
  },
};

const DANGEROUS_SCHEME =
  /^(javascript|vbscript|data|file|blob|about|intent|chrome|ms-):/i;

const BARE_HOST =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])+)+\.?(?::\d{1,5})?(?:[/?#][^\s]*)?$/i;

const WRAPPER_TAGS =
  /<\/?(?:html|head|body|p|div|span|font|meta|link|br|b|strong|em|i|u)(?:\s[^>]*)?\/?>/gi;

const MAX_HREF = 2048;

/**
 * @param {unknown} data
 * @param {'clipboard'|'prompt'|string} [context='clipboard']
 * @returns {string} href sûr, ou ''
 */
export function hrefFrom(data, context = 'clipboard') {
  const key = String(context || 'clipboard').toLowerCase();
  const rules = PASTE_LINK_CONTEXTS[key];
  if (!rules) {
    throw new Error(
      `hrefFrom: contexte inconnu "${key}" (attendu: ${Object.keys(PASTE_LINK_CONTEXTS).join(', ')})`
    );
  }

  const plain = typeof data === 'string' ? data : data?.plain ?? '';
  const html = typeof data === 'object' && data ? data.html ?? '' : '';
  const uriList = typeof data === 'object' && data ? data.uriList ?? '' : '';

  return (
    hrefFromPlain(plain, rules) ||
    hrefFromUriList(uriList, rules) ||
    hrefFromHtml(html, rules)
  );
}

/**
 * Sanitize / normalise une URL candidate.
 * @param {string} raw
 * @param {PasteLinkRules} [opts]
 * @returns {string}
 */
export function safeHref(raw, opts = PASTE_LINK_CONTEXTS.clipboard) {
  let href = normalizeClipboardText(raw);
  if (!href || href.length > MAX_HREF) return '';
  if (/\s/.test(href)) return '';
  if (DANGEROUS_SCHEME.test(href)) return '';
  if (href.startsWith('//')) return '';
  if (/[<>"'`]/.test(href)) return '';

  if (/^https?:\/\//i.test(href)) return normalizeHttpUrl(href);
  if (opts.allowMailto !== false && /^mailto:/i.test(href)) {
    return normalizeMailto(href);
  }
  if (opts.allowWww !== false && /^www\./i.test(href)) {
    return normalizeHttpUrl(`https://${href}`);
  }
  if (opts.allowHash !== false && href.startsWith('#') && href.length > 1) {
    return href;
  }
  if (
    opts.allowRelative !== false &&
    href.startsWith('/') &&
    href.length > 1 &&
    !href.startsWith('//')
  ) {
    return href;
  }
  if (opts.inferHttps && BARE_HOST.test(href)) {
    return normalizeHttpUrl(`https://${href.replace(/\.$/, '')}`);
  }
  return '';
}

/**
 * @param {string} text
 * @param {PasteLinkRules} [opts]
 */
function hrefFromPlain(text, opts = PASTE_LINK_CONTEXTS.clipboard) {
  let t = normalizeClipboardText(text);
  if (!t) return '';
  if (
    (t.startsWith('<') && t.endsWith('>')) ||
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith('\u00ab') && t.endsWith('\u00bb')) ||
    (t.startsWith('\u201c') && t.endsWith('\u201d'))
  ) {
    t = t.slice(1, -1);
    t = normalizeClipboardText(t);
  }
  return safeHref(t, opts);
}

/**
 * Premier URL de `text/uri-list` (copie barre d’adresse / macOS).
 * @param {string} list
 * @param {PasteLinkRules} [opts]
 */
function hrefFromUriList(list, opts = PASTE_LINK_CONTEXTS.clipboard) {
  for (const line of String(list || '').split(/\r?\n/)) {
    const t = normalizeClipboardText(line);
    if (!t || t.startsWith('#')) continue;
    const href = safeHref(t, opts);
    if (href) return href;
  }
  return '';
}

/**
 * Un seul `<a href>` (éventuellement wrappé Word/Docs) → href.
 * @param {string} html
 * @param {PasteLinkRules} [opts]
 */
export function hrefFromHtml(html, opts = PASTE_LINK_CONTEXTS.clipboard) {
  const raw = String(html || '');
  if (!raw) return '';
  let h = extractClipboardFragment(raw);
  if (!h) h = raw;
  if (!/<a\b/i.test(h)) return hrefFromPlain(plainFromHtml(raw), opts);

  const anchors = h.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [];
  if (anchors.length !== 1) return '';

  const leftover = h
    .replace(anchors[0], '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(WRAPPER_TAGS, '')
    .replace(/&nbsp;|\s/g, '');
  if (leftover) return '';

  const href = extractHrefAttr(anchors[0]);
  return safeHref(href, opts);
}

function extractHrefAttr(anchorHtml) {
  const quoted = String(anchorHtml || '').match(
    /\bhref\s*=\s*(["'])([\s\S]*?)\1/i
  );
  if (quoted) return quoted[2];
  const bare = String(anchorHtml || '').match(/\bhref\s*=\s*([^\s>]+)/i);
  return bare ? bare[1] : '';
}

function normalizeHttpUrl(href) {
  try {
    const u = new URL(href);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (u.username || u.password) return '';
    return u.href;
  } catch {
    return '';
  }
}

function normalizeMailto(href) {
  const rest = href.replace(/^mailto:/i, '');
  if (!rest || /[\s<>"'`]/.test(rest)) return '';
  return `mailto:${rest}`;
}

function decodeEntities(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
}

/** BOM, espaces invisibles, retours — copies barre d’adresse / Cmd+C. */
function normalizeClipboardText(s) {
  return decodeEntities(String(s || ''))
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .trim();
}

function plainFromHtml(html) {
  let h = extractClipboardFragment(String(html || ''));
  if (!h) h = String(html || '');
  h = h
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return normalizeClipboardText(h).replace(/\s+/g, ' ');
}
