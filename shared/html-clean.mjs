/**
 * Nettoyage HTML corps d’article — source unique (desk, API, iOS).
 *
 * API principale : cleanHtml(html, context)
 *   context = 'store' | 'desk' | 'ios'
 *
 * Retire les scories de collage (Word / Docs / contenteditable) qui
 * forcent color:#000 — illisible en dark mode (app iOS).
 */

/** Propriétés CSS conservées dans style="" (le reste = collages). */
export const STYLE_ALLOWLIST = new Set(['text-align']);

/**
 * Alignement — une table, des contextes. Call-sites : align(ctx) / lift.
 * text-align va sur le bloc, jamais seulement sur une balise en ligne.
 */
export const ALIGN_CONTEXTS = {
  left: { css: 'left' },
  center: { css: 'center' },
  right: { css: 'right' },
};

export const ALIGN_BLOCK_TAGS = new Set([
  'p',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'blockquote',
  'td',
  'th',
  'pre',
  'figcaption',
  'article',
  'section',
  'header',
  'footer',
  'figure',
  'dt',
  'dd',
]);

export const ALIGN_INLINE_TAGS = new Set([
  'b',
  'strong',
  'i',
  'em',
  'span',
  'a',
  'u',
  's',
  'mark',
  'small',
  'sub',
  'sup',
  'code',
]);

const ALIGN_BLOCK_RE = [...ALIGN_BLOCK_TAGS].join('|');
const ALIGN_INLINE_RE = [...ALIGN_INLINE_TAGS].join('|');

/**
 * @param {string} value
 * @returns {''|'left'|'center'|'right'|'justify'}
 */
export function normalizeTextAlign(value) {
  const v = String(value || '')
    .toLowerCase()
    .replace(/['"]/g, '')
    .trim();
  if (v === 'start') return 'left';
  if (v === 'end') return 'right';
  if (v === 'left' || v === 'center' || v === 'right' || v === 'justify') {
    return v;
  }
  return '';
}

/** Attributs conservés sur les balises (le reste = scories Word / Docs / web). */
export const ATTR_ALLOWLIST = new Set([
  'href',
  'src',
  'alt',
  'title',
  'target',
  'rel',
  'colspan',
  'rowspan',
  'style',
]);

/**
 * Règles par contexte — source de vérité pour les call-sites.
 * @type {Record<string, { extractClipboard?: boolean, normalizeStyles?: boolean, stripEmptyP?: boolean, stripFontJunk?: boolean, normalizeInline?: boolean, stripEmbeddedCss?: boolean, unwrapPasteWrappers?: boolean, filterAttrs?: boolean, flattenHeadings?: boolean }>}
 */
const CLEAN_FULL = {
  extractClipboard: true,
  normalizeStyles: true,
  stripEmptyP: true,
  stripFontJunk: true,
  normalizeInline: true,
  stripEmbeddedCss: true,
  unwrapPasteWrappers: true,
  filterAttrs: true,
};

export const HTML_CLEAN_CONTEXTS = {
  /** Enregistrement BDD (desk create/update). */
  store: { ...CLEAN_FULL },
  /** Éditeur pupitre (même règles que store). */
  desk: { ...CLEAN_FULL },
  /** Collage extérieur : plus strict (titres web → paragraphes). */
  paste: { ...CLEAN_FULL, flattenHeadings: true },
  /** Serveur iOS — styles collés même sur archives non ré-enregistrées. */
  ios: { ...CLEAN_FULL, extractClipboard: false, stripEmptyP: false },
};

/**
 * Extrait le fragment utile d’un collage Word/Docs (StartFragment / body).
 * @param {string} html
 */
export function extractClipboardFragment(html) {
  let h = String(html || '');
  if (!h) return '';
  const frag = h.match(
    /<!--StartFragment-->([\s\S]*?)<!--EndFragment-->/i
  );
  if (frag) h = frag[1];
  else {
    const body = h.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (body) h = body[1];
  }
  h = h.replace(/<meta\b[^>]*>/gi, '');
  h = h.replace(/<link\b[^>]*>/gi, '');
  h = h.replace(/<xml[\s\S]*?<\/xml>/gi, '');
  h = h.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '');
  h = h.replace(/<!--[\s\S]*?-->/g, '');
  return h;
}

/**
 * Garde uniquement les déclarations CSS de STYLE_ALLOWLIST.
 * @param {string} styleValue
 * @returns {string}
 */
export function filterStyleDeclarations(styleValue) {
  const kept = [];
  for (const part of String(styleValue || '').split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon < 0) continue;
    const prop = trimmed.slice(0, colon).trim().toLowerCase();
    const val = trimmed.slice(colon + 1).trim();
    if (!val) continue;
    if (STYLE_ALLOWLIST.has(prop)) kept.push(`${prop}: ${val}`);
  }
  return kept.join('; ');
}

/**
 * Normalise / retire les attributs style="" collés (color, font-family…).
 * Conserve text-align (intertitres centrés).
 * Gère styles quotés et non quotés.
 * @param {string} html
 */
export function normalizeInlineStyles(html) {
  let h = String(html || '');
  // style="…" / style='…'
  h = h.replace(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi, (_m, quote, value) => {
    const next = filterStyleDeclarations(value);
    return next ? ` style=${quote}${next}${quote}` : '';
  });
  // style=text-align:center (sans guillemets, jusqu’à espace / >)
  h = h.replace(/\sstyle\s*=\s*([^\s"'<>]+)/gi, (_m, value) => {
    const next = filterStyleDeclarations(value);
    return next ? ` style="${next}"` : '';
  });
  return h;
}

/**
 * Retire balises <font> et attributs de présentation hérités (color, face, size).
 * @param {string} html
 */
export function stripFontJunk(html) {
  let h = String(html || '');
  // <font …>…</font> → contenu
  h = h.replace(/<\/?font\b[^>]*>/gi, '');
  // attrs présentation hors style=
  h = h.replace(
    /\s(?:color|face|size|bgcolor)\s*=\s*(["'][^"']*["']|[^\s>]+)/gi,
    ''
  );
  // spans/b/strong vides ne contenant que des espaces / &nbsp;
  h = h.replace(
    /<(span|strong|b|em|i)(?:\s[^>]*)?>\s*(?:&nbsp;|\u00a0|\s)*<\/\1>/gi,
    ' '
  );
  return h;
}

/**
 * contenteditable (Chrome) pose souvent font-weight/font-style en span.
 * On les remonte en <strong>/<i> avant de jeter les styles — sinon le formatage disparaît.
 * @param {string} html
 */
export function promoteInlineStyles(html) {
  let h = String(html || '');
  let prev = '';
  while (h !== prev) {
    prev = h;
    h = h.replace(
      /<span\b([^>]*)>((?:(?!<span\b)[\s\S])*?)<\/span>/gi,
      (_m, attrs, inner) => promoteSpan(attrs, inner)
    );
  }
  return h;
}

/**
 * Déplie spans vides, <b><b>, voisins identiques — le pupitre s’y perd sinon.
 * @param {string} html
 */
export function normalizeInlineMarkup(html) {
  let h = String(html || '');
  let prev = '';
  while (h !== prev) {
    prev = h;
    h = h.replace(/<span>([\s\S]*?)<\/span>/gi, '$1');
    h = unwrapNestedSame(h, 'b');
    h = unwrapNestedSame(h, 'strong');
    h = unwrapNestedSame(h, 'i');
    h = unwrapNestedSame(h, 'em');
    h = h.replace(
      /<(strong|b)>\s*<(b|strong)>([\s\S]*?)<\/\2>\s*<\/\1>/gi,
      '<strong>$3</strong>'
    );
    h = h.replace(
      /<(em|i)>\s*<(i|em)>([\s\S]*?)<\/\2>\s*<\/\1>/gi,
      '<em>$3</em>'
    );
    h = h.replace(/<b(\s[^>]*)?>/gi, '<strong$1>');
    h = h.replace(/<\/b>/gi, '</strong>');
    h = h.replace(/<\/strong>\s*<strong>/gi, '');
    h = h.replace(/<\/i>\s*<i>/gi, '');
    h = h.replace(/<\/em>\s*<em>/gi, '');
    h = h.replace(
      /<(span|strong|b|em|i)(?:\s[^>]*)?>\s*(?:&nbsp;|\u00a0|\s)*<\/\1>/gi,
      ' '
    );
  }
  return h;
}

function promoteSpan(attrs, inner) {
  const rawAttrs = String(attrs || '');
  const quoted = rawAttrs.match(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/i);
  const unquoted = !quoted && rawAttrs.match(/\sstyle\s*=\s*([^\s>]+)/i);
  const style = quoted ? quoted[2] : unquoted ? unquoted[1] : '';
  const bold = /font-weight\s*:\s*(bold|[6-9]00)/i.test(style);
  const italic = /font-style\s*:\s*italic/i.test(style);
  let out = inner;
  const trimmed = String(out || '').trim();
  if (italic && !/^<(?:i|em)\b/i.test(trimmed)) out = `<i>${out}</i>`;
  if (bold && !/^<(?:b|strong)\b/i.test(trimmed)) {
    out = `<strong>${out}</strong>`;
  }
  const rest = filterStyleDeclarations(style);
  const other = rawAttrs
    .replace(/\sstyle\s*=\s*(["'])[\s\S]*?\1/i, '')
    .replace(/\sstyle\s*=\s*[^\s>]+/i, '');
  if (rest) return `<span${other} style="${rest}">${out}</span>`;
  if (other.trim()) return `<span${other}>${out}</span>`;
  return out;
}

export function stripEmbeddedCss(html) {
  return String(html || '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

function styleFromAttrs(attrs) {
  const raw = String(attrs || '');
  const quoted = raw.match(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/i);
  if (quoted) return quoted[2];
  const unquoted = raw.match(/\sstyle\s*=\s*([^\s>]+)/i);
  return unquoted ? unquoted[1] : '';
}

function findMatchingClose(html, tag, from) {
  const openRe = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  const closeRe = new RegExp(`</${tag}>`, 'gi');
  let depth = 1;
  let i = from;
  while (i < html.length) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const open = openRe.exec(html);
    const close = closeRe.exec(html);
    if (!close) return -1;
    if (open && open.index < close.index) {
      depth += 1;
      i = open.index + open[0].length;
    } else {
      depth -= 1;
      if (depth === 0) return close.index;
      i = close.index + close[0].length;
    }
  }
  return -1;
}

function unwrapMatching(html, tag, pred) {
  let h = String(html || '');
  const openRe = new RegExp(`<${tag}\\b([^>]*)>`, 'gi');
  const hits = [];
  let m;
  while ((m = openRe.exec(h))) {
    if (pred(m[1] || '')) hits.push({ index: m.index, len: m[0].length });
  }
  const closeLen = `</${tag}>`.length;
  for (let k = hits.length - 1; k >= 0; k -= 1) {
    const hit = hits[k];
    const closeAt = findMatchingClose(h, tag, hit.index + hit.len);
    if (closeAt < 0) continue;
    h =
      h.slice(0, hit.index) +
      h.slice(hit.index + hit.len, closeAt) +
      h.slice(closeAt + closeLen);
  }
  return h;
}

function isFakeBoldWrapper(attrs) {
  const a = String(attrs || '');
  if (/\bid\s*=\s*["']?docs-internal-guid/i.test(a)) return true;
  return /font-weight\s*:\s*(normal|400)\b/i.test(styleFromAttrs(a));
}

/** Google Docs enveloppe tout dans <b id="docs-internal-guid" style="font-weight:normal">. */
export function unwrapPasteWrappers(html) {
  let h = String(html || '');
  h = unwrapMatching(h, 'b', isFakeBoldWrapper);
  h = unwrapMatching(h, 'strong', isFakeBoldWrapper);
  h = unwrapMatching(h, 'span', (attrs) =>
    /\bid\s*=\s*["']?docs-internal-guid/i.test(attrs)
  );
  h = h.replace(/<\/?o:p\b[^>]*>/gi, '');
  h = h.replace(/<\/?[a-z]+:[a-z][^>]*>/gi, '');
  return h;
}

export function filterTagAttributes(html) {
  return String(html || '').replace(
    /<([a-z][a-z0-9]*)\b([^>]*?)>/gi,
    (_full, tag, attrs) => {
      if (!String(attrs || '').trim()) return `<${tag}>`;
      const kept = [];
      const re =
        /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let am;
      while ((am = re.exec(attrs))) {
        const name = String(am[1] || '').toLowerCase();
        if (!ATTR_ALLOWLIST.has(name)) continue;
        const val = am[2] ?? am[3] ?? am[4];
        if (val == null) continue;
        if (name === 'style') {
          const next = filterStyleDeclarations(val);
          if (next) kept.push(`style="${next}"`);
          continue;
        }
        const q = am[2] != null ? '"' : am[3] != null ? "'" : '"';
        kept.push(`${name}=${q}${val}${q}`);
      }
      return kept.length ? `<${tag} ${kept.join(' ')}>` : `<${tag}>`;
    }
  );
}

export function flattenPastedHeadings(html) {
  return String(html || '')
    .replace(/<h[1-6]\b([^>]*)>/gi, '<p$1>')
    .replace(/<\/h[1-6]>/gi, '</p>');
}

function unwrapNestedSame(html, tag) {
  const re = new RegExp(
    `<${tag}(?:\\s[^>]*)?>\\s*<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>\\s*</${tag}>`,
    'gi'
  );
  return String(html || '').replace(re, `<${tag}>$1</${tag}>`);
}

function textAlignFromStyle(style) {
  for (const part of String(style || '').split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const prop = part.slice(0, colon).trim().toLowerCase();
    if (prop !== 'text-align') continue;
    return normalizeTextAlign(part.slice(colon + 1));
  }
  return '';
}

function removeTextAlignFromStyle(style) {
  const kept = [];
  for (const part of String(style || '').split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon < 0) continue;
    const prop = trimmed.slice(0, colon).trim().toLowerCase();
    if (prop === 'text-align') continue;
    kept.push(trimmed);
  }
  return kept.join('; ');
}

function replaceStyleInAttrs(attrs, styleValue) {
  let a = String(attrs || '');
  if (!styleValue) {
    return a
      .replace(/\sstyle\s*=\s*(["'])[\s\S]*?\1/i, '')
      .replace(/\sstyle\s*=\s*[^\s>]+/i, '');
  }
  if (/\sstyle\s*=\s*(["'])[\s\S]*?\1/i.test(a)) {
    return a.replace(/\sstyle\s*=\s*(["'])[\s\S]*?\1/i, ` style="${styleValue}"`);
  }
  if (/\sstyle\s*=\s*[^\s>]+/i.test(a)) {
    return a.replace(/\sstyle\s*=\s*[^\s>]+/i, ` style="${styleValue}"`);
  }
  return `${a} style="${styleValue}"`;
}

function findTopBlockRanges(html) {
  const ranges = [];
  let i = 0;
  const openRe = new RegExp(`<(${ALIGN_BLOCK_RE})\\b[^>]*>`, 'gi');
  while (i < html.length) {
    openRe.lastIndex = i;
    const m = openRe.exec(html);
    if (!m) break;
    const tag = m[1];
    const innerStart = m.index + m[0].length;
    const closeAt = findMatchingClose(html, tag, innerStart);
    if (closeAt < 0) break;
    const end = closeAt + `</${tag}>`.length;
    ranges.push({ start: m.index, end });
    i = end;
  }
  return ranges;
}

function stripDirectInlines(html) {
  let align = '';
  const replacements = [];
  const openRe = new RegExp(`<(${ALIGN_INLINE_RE})\\b([^>]*)>`, 'gi');
  const nested = findTopBlockRanges(html);
  let m;
  while ((m = openRe.exec(html))) {
    if (nested.some((r) => m.index >= r.start && m.index < r.end)) continue;
    const style = styleFromAttrs(m[2] || '');
    const ta = textAlignFromStyle(style);
    if (!ta) continue;
    if (!align) align = ta;
    const rest = removeTextAlignFromStyle(style);
    replacements.push({
      start: m.index,
      end: m.index + m[0].length,
      next: `<${m[1]}${replaceStyleInAttrs(m[2] || '', rest)}>`,
    });
  }
  let out = html;
  for (let k = replacements.length - 1; k >= 0; k -= 1) {
    const r = replacements[k];
    out = out.slice(0, r.start) + r.next + out.slice(r.end);
  }
  return { html: out, align };
}

function liftAlignRegion(html, wrapOrphans) {
  const src = String(html || '');
  if (!src) return src;
  const openRe = new RegExp(`<(${ALIGN_BLOCK_RE})\\b([^>]*)>`, 'gi');
  const first = new RegExp(`<(${ALIGN_BLOCK_RE})\\b([^>]*)>`, 'i').exec(src);
  if (!first) {
    if (!wrapOrphans) return src;
    const stripped = stripDirectInlines(src);
    if (!stripped.align) return src;
    return `<p style="text-align: ${stripped.align}">${stripped.html}</p>`;
  }

  let out = '';
  let i = 0;
  while (i < src.length) {
    openRe.lastIndex = i;
    const m = openRe.exec(src);
    if (!m) {
      const tail = src.slice(i);
      if (wrapOrphans) {
        const stripped = stripDirectInlines(tail);
        out +=
          stripped.align && !new RegExp(`<(${ALIGN_BLOCK_RE})\\b`, 'i').test(tail)
            ? `<p style="text-align: ${stripped.align}">${stripped.html}</p>`
            : tail;
      } else {
        out += tail;
      }
      break;
    }
    out += src.slice(i, m.index);
    const tag = m[1];
    const attrs = m[2] || '';
    const innerStart = m.index + m[0].length;
    const closeAt = findMatchingClose(src, tag, innerStart);
    if (closeAt < 0) {
      out += src.slice(m.index);
      break;
    }
    const inner = src.slice(innerStart, closeAt);
    const liftedInner = liftAlignRegion(inner, false);
    const stripped = stripDirectInlines(liftedInner);
    const blockAlign = textAlignFromStyle(styleFromAttrs(attrs));
    const nextAttrs =
      stripped.align && !blockAlign
        ? replaceStyleInAttrs(attrs, `text-align: ${stripped.align}`)
        : attrs;
    out += `<${tag}${nextAttrs}>${stripped.html}</${tag}>`;
    i = closeAt + `</${tag}>`.length;
  }
  return out;
}

/**
 * Remonte text-align des balises en ligne vers le bloc parent.
 * @param {string} html
 */
export function liftInlineTextAlign(html) {
  return liftAlignRegion(String(html || ''), true);
}

/**
 * @param {string} html
 * @param {'store'|'desk'|'paste'|'ios'|string} [context='store']
 */
export function cleanHtml(html, context = 'store') {
  const key = String(context || 'store').toLowerCase();
  const rules = HTML_CLEAN_CONTEXTS[key];
  if (!rules) {
    throw new Error(
      `cleanHtml: contexte inconnu "${key}" (attendu: ${Object.keys(HTML_CLEAN_CONTEXTS).join(', ')})`
    );
  }

  let h = typeof html === 'string' ? html : '';
  if (!h) return '';

  if (rules.extractClipboard) {
    h = extractClipboardFragment(h);
  }
  if (rules.stripEmbeddedCss) {
    h = stripEmbeddedCss(h);
  }
  if (rules.unwrapPasteWrappers) {
    h = unwrapPasteWrappers(h);
  }
  if (rules.normalizeInline) {
    h = promoteInlineStyles(h);
  }
  if (rules.stripFontJunk) {
    h = stripFontJunk(h);
  }
  if (rules.filterAttrs) {
    h = filterTagAttributes(h);
  }
  if (rules.normalizeStyles) {
    h = normalizeInlineStyles(h);
  }
  if (rules.flattenHeadings) {
    h = flattenPastedHeadings(h);
  }
  if (rules.normalizeInline) {
    h = normalizeInlineMarkup(h);
  }
  if (rules.normalizeStyles || rules.normalizeInline) {
    h = liftInlineTextAlign(h);
  }
  if (rules.stripEmptyP) {
    h = h.replace(/<p(?:\s[^>]*)?>\s*<\/p>/gi, '');
  }

  return h
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+>/g, '>')
    .trim();
}
