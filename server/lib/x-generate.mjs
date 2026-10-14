/**
 * Génération de variantes de posts X orientées engagement.
 * La langue du post suit la langue de l’article (fr ou en).
 */

import { chapo, stripHtmlToText } from './excerpt.mjs';
import { callEditorialAssist } from './editorial-assist.mjs';
import { X_ACCOUNTS, normalizeXAccount, DEFAULT_X_ACCOUNT } from './x-accounts.mjs';
import { X_MAX_LENGTH, xWeightedLength } from './x-post.mjs';
import { absoluteArticleUrl } from './article-path.mjs';

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
  if (language === 'en') {
    const beat =
      accountId === 'bulletin'
        ? `the account ${handle} (EU watch: regulation, Brussels, European markets)`
        : `the account ${handle} (ElectronLibre: digital, AI, media, platforms)`;
    const tags = accountId === 'bulletin' ? 'no hashtags' : 'no spam hashtags';
    return `You write X posts for ${beat}.
The article is in English. Write ONLY in English.
Produce EXACTLY 3 engagement-oriented hooks (tension, a figure, or a question).
Rules: no URL, ${tags}, no “thread”, about 200 characters max per variant, professional tone.
Reply ONLY with the 3 texts separated by a line that contains only ---`;
  }
  const beat =
    accountId === 'bulletin'
      ? `le compte ${handle} (veille / régulation UE, Bruxelles, marchés européens)`
      : `le compte ${handle} (média ElectronLibre : numérique, IA, médias, plateformes)`;
  const tags = accountId === 'bulletin' ? 'pas de hashtags' : 'pas de hashtags spam';
  return `Tu rédiges des posts X pour ${beat}.
L’article est en français. Écris UNIQUEMENT en français.
Produis EXACTEMENT 3 variantes d’accroche orientées engagement (hook, tension, chiffre ou question).
Règles : pas d’URL, ${tags}, pas de « thread », max ~200 caractères par variante, ton professionnel.
Réponds UNIQUEMENT avec les 3 textes séparés par une ligne contenant seulement ---`;
}

function trimHook(hook, url, max = X_MAX_LENGTH) {
  const fixed = xWeightedLength(`\n${url}`);
  const budget = Math.max(40, max - fixed);
  let h = String(hook || '').trim().replace(/\s+/g, ' ');
  // Retirer une URL déjà collée par le modèle (on la remet proprement)
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

function fallbackVariants(row, url, language) {
  const title = String(row.title || '').trim();
  const excerpt =
    chapo(row, 'card') || stripHtmlToText(row.excerpt).slice(0, 180);
  if (language === 'en') {
    const v1 = title || excerpt || 'Read on ElectronLibre';
    const v2 =
      excerpt && excerpt !== title ? excerpt : `${title} — the takeaway`;
    const v3 = title
      ? `A closer look: ${title}`
      : 'New ElectronLibre analysis';
    return [compose(v1, url), compose(v2, url), compose(v3, url)];
  }
  const v1 = title || excerpt || 'À lire sur ElectronLibre';
  const v2 =
    excerpt && excerpt !== title ? excerpt : `${title} — ce qu’il faut retenir`;
  const v3 = title
    ? `Et si on regardait ça de près ? ${title}`
    : 'Nouvelle analyse ElectronLibre';
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
    let hook = p
      .replace(/^variante\s*\d+\s*[:.\-–—]\s*/i, '')
      .replace(/^variant\s*\d+\s*[:.\-–—]\s*/i, '')
      .replace(/^[-*•]\s*/, '')
      .trim();
    hook = hook.replace(/\s*https?:\/\/\S+\s*$/i, '').trim();
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
  const url = absoluteArticleUrl(opts.siteUrl, row);
  const title = String(row.title || '').trim();
  const excerpt =
    chapo(row, 'card') || stripHtmlToText(row.excerpt).slice(0, 220);
  const fallback = fallbackVariants(row, url, language);

  const labels =
    language === 'en'
      ? {
          lang: 'Language: English',
          title: 'Title',
          excerpt: 'Standfirst',
          url: 'URL (do not repeat it in the hook)',
        }
      : {
          lang: 'Langue : français',
          title: 'Titre',
          excerpt: 'Chapô',
          url: 'URL (à ne pas répéter dans l’accroche)',
        };

  const source = [
    labels.lang,
    `${labels.title} : ${title}`,
    excerpt ? `${labels.excerpt} : ${excerpt}` : '',
    `${labels.url} : ${url}`,
  ]
    .filter(Boolean)
    .join('\n');

  const prompt = buildXPrompt(accountId, language, meta.handle);

  let variants = [];
  let sourceMode = 'fallback';
  try {
    if (opts.agentEditorial?.url && opts.agentEditorial?.apiKey) {
      const result = await callEditorialAssist({
        upstream: opts.agentEditorial.url,
        apiKey: opts.agentEditorial.apiKey,
        type: 'reformuler',
        text: source,
        prompt,
        profile: 'electronlibre',
        timeoutMs: 90_000,
      });
      variants = parseVariants(result.text, url);
      if (variants.length) sourceMode = 'assist';
    }
  } catch (err) {
    console.warn('[x-generate] assist failed, fallback', err.message);
  }

  if (variants.length < 2) {
    variants = fallback;
    sourceMode = sourceMode === 'assist' ? 'assist+fallback' : 'fallback';
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
