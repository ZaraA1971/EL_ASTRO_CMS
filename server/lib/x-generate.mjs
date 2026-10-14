/**
 * Génération de variantes de posts X orientées engagement.
 * La langue du post suit la langue de l’article (fr ou en).
 */

import { chapo, stripHtmlToText } from './excerpt.mjs';
import { callEditorialAssist } from './editorial-assist.mjs';
import { X_ACCOUNTS, normalizeXAccount, DEFAULT_X_ACCOUNT } from './x-accounts.mjs';
import { X_MAX_LENGTH, xWeightedLength } from './x-post.mjs';
import { absoluteArticleUrl } from './article-path.mjs';

const COPY = {
  fr: {
    langLine: 'Langue : français',
    title: 'Titre',
    excerpt: 'Chapô',
    url: 'URL (à ne pas répéter dans l’accroche)',
    only: 'L’article est en français. Écris UNIQUEMENT en français.',
    produce:
      'Produis EXACTEMENT 3 variantes d’accroche orientées engagement (tension, chiffre ou question).',
    rules: (tags) =>
      `Règles : pas d’URL, ${tags}, pas de « thread », max ~200 caractères par variante, ton professionnel.`,
    reply:
      'Réponds UNIQUEMENT avec les 3 textes séparés par une ligne contenant seulement ---',
    write: (beat) => `Tu rédiges des posts X pour ${beat}.`,
    beats: {
      bulletin: (handle) =>
        `le compte ${handle} (veille / régulation UE, Bruxelles, marchés européens)`,
      el: (handle) =>
        `le compte ${handle} (média ElectronLibre : numérique, IA, médias, plateformes)`,
    },
    tags: { bulletin: 'pas de hashtags', el: 'pas de hashtags spam' },
    empty: 'À lire sur ElectronLibre',
    takeaway: (title) => `${title} — ce qu’il faut retenir`,
    closer: (title) => `Et si on regardait ça de près ? ${title}`,
    closerEmpty: 'Nouvelle analyse ElectronLibre',
  },
  en: {
    langLine: 'Language: English',
    title: 'Title',
    excerpt: 'Standfirst',
    url: 'URL (do not repeat it in the hook)',
    only: 'The article is in English. Write ONLY in English.',
    produce:
      'Produce EXACTLY 3 engagement-oriented hooks (tension, a figure, or a question).',
    rules: (tags) =>
      `Rules: no URL, ${tags}, no “thread”, about 200 characters max per variant, professional tone.`,
    reply:
      'Reply ONLY with the 3 texts separated by a line that contains only ---',
    write: (beat) => `You write X posts for ${beat}.`,
    beats: {
      bulletin: (handle) =>
        `the account ${handle} (EU watch: regulation, Brussels, European markets)`,
      el: (handle) =>
        `the account ${handle} (ElectronLibre: digital, AI, media, platforms)`,
    },
    tags: { bulletin: 'no hashtags', el: 'no spam hashtags' },
    empty: 'Read on ElectronLibre',
    takeaway: (title) => `${title} — the takeaway`,
    closer: (title) => `A closer look: ${title}`,
    closerEmpty: 'New ElectronLibre analysis',
  },
};

function copyFor(language) {
  return COPY[language] || COPY.fr;
}

/** @param {object} row */
export function articleXLanguage(row) {
  return String(row?.lang || 'fr').toLowerCase().startsWith('en') ? 'en' : 'fr';
}

/**
 * @param {'el'|'bulletin'} accountId
 * @param {'fr'|'en'} language
 * @param {string} handle
 */
export function buildXPrompt(accountId, language, handle) {
  const copy = copyFor(language);
  const beat = (copy.beats[accountId] || copy.beats.el)(handle);
  const tags = copy.tags[accountId] || copy.tags.el;
  return [copy.write(beat), copy.only, copy.produce, copy.rules(tags), copy.reply].join(
    '\n'
  );
}

function trimHook(hook, url, max = X_MAX_LENGTH) {
  const fixed = xWeightedLength(`\n${url}`);
  const budget = Math.max(40, max - fixed);
  let h = String(hook || '').trim().replace(/\s+/g, ' ');
  h = h.replace(/\s*https?:\/\/\S+/gi, '').trim();
  if (xWeightedLength(h) <= budget) return h;
  const chars = [...h];
  let cut = '';
  for (const ch of chars) {
    if (xWeightedLength(cut + ch + '…') > budget) break;
    cut += ch;
  }
  const sp = cut.lastIndexOf(' ');
  if (sp > budget * 0.55) cut = cut.slice(0, sp);
  return cut.replace(/[.,;:\s]+$/u, '') + '…';
}

function compose(hook, url) {
  const h = trimHook(hook, url);
  return `${h}\n${url}`;
}

function articleExcerpt(row) {
  return (chapo(row, 'card') || stripHtmlToText(row.excerpt)).slice(0, 220);
}

function fallbackVariants(row, url, language) {
  const copy = copyFor(language);
  const title = String(row.title || '').trim();
  const excerpt = articleExcerpt(row);
  const v1 = title || excerpt || copy.empty;
  const v2 = excerpt && excerpt !== title ? excerpt : copy.takeaway(title);
  const v3 = title ? copy.closer(title) : copy.closerEmpty;
  return [compose(v1, url), compose(v2, url), compose(v3, url)];
}

function parseVariants(raw, url) {
  const text = String(raw || '').trim();
  if (!text) return [];
  let parts = text
    .split(/\n\s*---\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) {
    parts = text
      .split(/\n\s*\d+[\).\]]\s+/)
      .map((p) => p.trim())
      .filter(Boolean);
  }
  if (parts.length < 2) {
    parts = text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
  }
  const out = [];
  for (const p of parts) {
    const hook = p
      .replace(/^(?:variante|variant)\s*\d+\s*[:.\-–—]\s*/i, '')
      .replace(/^[-*•]\s*/, '')
      .replace(/\s*https?:\/\/\S+\s*$/i, '')
      .trim();
    if (!hook) continue;
    out.push(compose(hook, url));
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * @param {object} row — el_articles
 * @param {{ account?: string, siteUrl: string, agentEditorial?: { url?: string, apiKey?: string } }} opts
 */
export async function generateXVariants(row, opts) {
  const accountId = normalizeXAccount(opts.account) || DEFAULT_X_ACCOUNT;
  const meta = X_ACCOUNTS[accountId];
  const language = articleXLanguage(row);
  const copy = copyFor(language);
  const url = absoluteArticleUrl(opts.siteUrl, row);
  const title = String(row.title || '').trim();
  const excerpt = articleExcerpt(row);
  const fallback = fallbackVariants(row, url, language);

  const source = [
    copy.langLine,
    `${copy.title} : ${title}`,
    excerpt ? `${copy.excerpt} : ${excerpt}` : '',
    `${copy.url} : ${url}`,
  ]
    .filter(Boolean)
    .join('\n');

  let variants = fallback;
  let sourceMode = 'fallback';
  try {
    if (opts.agentEditorial?.url && opts.agentEditorial?.apiKey) {
      const result = await callEditorialAssist({
        upstream: opts.agentEditorial.url,
        apiKey: opts.agentEditorial.apiKey,
        type: 'reformuler',
        text: source,
        prompt: buildXPrompt(accountId, language, meta.handle),
        profile: 'electronlibre',
        timeoutMs: 90_000,
      });
      const parsed = parseVariants(result.text, url);
      if (parsed.length >= 2) {
        variants = parsed;
        sourceMode = 'assist';
      }
    }
  } catch (err) {
    console.warn('[x-generate] assist failed, fallback', err.message);
  }

  return {
    account: accountId,
    handle: meta.handle,
    language,
    url,
    variants: variants.slice(0, 3),
    text: variants[0] || compose(title || 'ElectronLibre', url),
    source: sourceMode,
  };
}
