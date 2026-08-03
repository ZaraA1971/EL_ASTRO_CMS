/**
 * Chapô / excerpts — source unique (desk, API, front Astro).
 *
 * API principale : chapo(article, context)
 *   context = 'hero' | 'card' | 'related' | 'ios' | 'store'
 */

const CHAPO_LEAD_RE =
  /^\s*<p[^>]*>\s*<strong>[\s\S]*?<\/strong>\s*<\/p>\s*/i;

/** Mots d’extrait selon le contexte d’affichage. */
export const HERO_EXCERPT_WORDS = 130;
export const CARD_EXCERPT_WORDS = 28;
export const RELATED_EXCERPT_WORDS = 32;
export const IOS_BODY_FALLBACK_WORDS = 55;

/**
 * Règles par contexte — source de vérité pour les call-sites.
 * @type {Record<string, { words?: number, allowBody?: boolean, mode?: string }>}
 */
export const EXCERPT_CONTEXTS = {
  /** Une à la une : chapô prolongé avec le corps. */
  hero: { words: HERO_EXCERPT_WORDS, allowBody: true },
  /** Carte grille / archive. */
  card: { words: CARD_EXCERPT_WORDS, allowBody: false },
  /** Bloc « À lire aussi ». */
  related: { words: RELATED_EXCERPT_WORDS, allowBody: false },
  /** API iOS — body fallback seulement si entitled / public. */
  ios: { words: IOS_BODY_FALLBACK_WORDS, mode: 'ios' },
  /** Enregistrement BDD (desk) — dérivé proportionnel du corps. */
  store: { mode: 'store' },
};

export function stripLeadingChapoHtml(html) {
  return String(html || '').replace(CHAPO_LEAD_RE, '');
}

/**
 * HTML → texte.
 * @param {string} html
 * @param {{ blocks?: boolean }} [opts] blocks=true : sauts de ligne pour <br>/blocs (extracteurs).
 */
export function stripHtmlToText(html, opts = {}) {
  const blocks = Boolean(opts.blocks);
  let s = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  if (blocks) {
    s = s
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n');
  }
  s = s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
  if (blocks) {
    return s
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }
  return s.replace(/\s+/g, ' ').trim();
}

/** Alias lisible pour le front. */
export const plainTextFromHtml = stripHtmlToText;

/**
 * Excerpt BDD : début proportionnel du corps (hors chapô gras en tête).
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

export function trimExcerpt(text, words = CARD_EXCERPT_WORDS) {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length <= words) return clean;
  return parts.slice(0, words).join(' ') + '…';
}

/**
 * Extrait carte / hero (bas niveau — préférer chapo()).
 * @param {{ excerpt?: string, body?: string } | null} article
 * @param {number} words
 * @param {{ allowBody?: boolean }} [opts]
 */
function articleField(article, key) {
  // '' (listes sans body) ne doit pas masquer data.* / l’autre niveau
  const top = article?.[key];
  if (top != null && String(top).trim()) return String(top);
  const nested = article?.data?.[key];
  if (nested != null && String(nested).trim()) return String(nested);
  return '';
}

export function cardExcerpt(article, words, opts = {}) {
  const allowBody = Boolean(opts.allowBody);
  const excerpt = articleField(article, 'excerpt').trim();
  const bodyHtml = articleField(article, 'body');
  const excerptWords = excerpt ? excerpt.split(/\s+/).filter(Boolean) : [];

  if (!allowBody || excerptWords.length >= words) {
    return trimExcerpt(excerpt, words);
  }

  const bodyPlain = stripHtmlToText(bodyHtml);
  if (!bodyPlain) return trimExcerpt(excerpt, words);

  let source = excerpt;
  if (excerpt) {
    const head = excerptWords.slice(0, 16).join(' ').toLocaleLowerCase('fr');
    const bodyLc = bodyPlain.toLocaleLowerCase('fr');
    const idx = head ? bodyLc.indexOf(head) : -1;
    if (idx >= 0) {
      const after = bodyPlain.slice(idx + excerpt.length).trim();
      source = after ? `${excerpt} ${after}` : excerpt;
    } else {
      source = `${excerpt} ${bodyPlain}`;
    }
  } else {
    source = bodyPlain;
  }
  return trimExcerpt(source, words);
}

/**
 * Excerpt API client (iOS) — jamais de body paywall si non autorisé.
 * @param {{ excerpt?: string, body?: string }} row
 * @param {{ allowBodyFallback?: boolean, maxWords?: number }} [opts]
 */
export function excerptPlainForClient(row, opts = {}) {
  const allowBodyFallback = Boolean(opts.allowBodyFallback);
  const maxWords = Math.max(1, Number(opts.maxWords) || IOS_BODY_FALLBACK_WORDS);
  let excerpt = String(row?.excerpt || '').trim();
  if (!excerpt && allowBodyFallback && row?.body) {
    excerpt = trimExcerpt(stripHtmlToText(row.body), maxWords);
  }
  return excerpt
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Chapô selon le contexte d’appel.
 *
 * @param {object|string|null} articleOrBody
 *   article `{ excerpt, body }` / Astro `{ data }` pour hero|card|related|ios ;
 *   HTML corps (string) ou article pour `store`.
 * @param {'hero'|'card'|'related'|'ios'|'store'} context
 * @param {{
 *   entitled?: boolean,
 *   allowBodyFallback?: boolean,
 *   ratio?: number,
 *   minChars?: number,
 *   maxChars?: number,
 * }} [opts]
 * @returns {string}
 *
 * @example chapo(article, 'hero')
 * @example chapo(article, 'card')
 * @example chapo(row, 'ios', { entitled: canSeeBody })
 * @example chapo(bodyHtml, 'store')
 */
export function chapo(articleOrBody, context, opts = {}) {
  const key = String(context || 'card');
  const conf = EXCERPT_CONTEXTS[key];
  if (!conf) {
    throw new Error(
      `excerpt: contexte inconnu "${key}" (attendu: ${Object.keys(EXCERPT_CONTEXTS).join(', ')})`
    );
  }

  if (conf.mode === 'store') {
    const body =
      typeof articleOrBody === 'string'
        ? articleOrBody
        : articleField(articleOrBody, 'body');
    return deriveExcerptFromBody(body, opts);
  }

  if (conf.mode === 'ios') {
    const allow =
      opts.entitled !== undefined
        ? Boolean(opts.entitled)
        : Boolean(opts.allowBodyFallback);
    return excerptPlainForClient(articleOrBody, {
      allowBodyFallback: allow,
      maxWords: conf.words,
    });
  }

  return cardExcerpt(articleOrBody, conf.words, {
    allowBody: Boolean(conf.allowBody),
  });
}
