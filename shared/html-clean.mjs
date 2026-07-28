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
 * Règles par contexte — source de vérité pour les call-sites.
 * @type {Record<string, { stripPmData?: boolean, normalizeStyles?: boolean, stripEmptyP?: boolean, stripFontJunk?: boolean }>}
 */
export const HTML_CLEAN_CONTEXTS = {
  /** Enregistrement BDD (desk create/update). */
  store: {
    extractClipboard: true,
    stripPmData: true,
    normalizeStyles: true,
    stripEmptyP: true,
    stripFontJunk: true,
  },
  /** Éditeur pupitre (même règles que store). */
  desk: {
    extractClipboard: true,
    stripPmData: true,
    normalizeStyles: true,
    stripEmptyP: true,
    stripFontJunk: true,
  },
  /** Serveur iOS — styles collés même sur archives non ré-enregistrées. */
  ios: {
    extractClipboard: false,
    stripPmData: true,
    normalizeStyles: true,
    stripEmptyP: false,
    stripFontJunk: true,
  },
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
 * @param {string} html
 * @param {'store'|'desk'|'ios'|string} [context='store']
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
  if (rules.stripPmData) {
    h = h.replace(
      /\s*data-(?:start|end|pm-slice|pm-paste)=["'][^"']*["']/gi,
      ''
    );
  }
  if (rules.stripFontJunk) {
    h = stripFontJunk(h);
  }
  if (rules.normalizeStyles) {
    h = normalizeInlineStyles(h);
  }
  if (rules.stripEmptyP) {
    h = h.replace(/<p(?:\s[^>]*)?>\s*<\/p>/gi, '');
  }

  return h
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+>/g, '>')
    .trim();
}
