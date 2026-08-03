/**
 * Génération de variantes de posts X orientées engagement.
 */

import { chapo, stripHtmlToText } from './excerpt.mjs';
import { callEditorialAssist } from './editorial-assist.mjs';
import { X_ACCOUNTS, normalizeXAccount, DEFAULT_X_ACCOUNT } from './x-accounts.mjs';
import { X_MAX_LENGTH, xWeightedLength } from './x-post.mjs';
import { absoluteArticleUrl } from './article-path.mjs';

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

function fallbackVariants(row, url) {
  const title = String(row.title || '').trim();
  const excerpt =
    chapo(row, 'card') || stripHtmlToText(row.excerpt).slice(0, 180);
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
  const url = absoluteArticleUrl(opts.siteUrl, row);
  const title = String(row.title || '').trim();
  const excerpt =
    chapo(row, 'card') || stripHtmlToText(row.excerpt).slice(0, 220);
  const fallback = fallbackVariants(row, url);

  const source = [
    `Titre : ${title}`,
    excerpt ? `Chapô : ${excerpt}` : '',
    `URL (à ne pas répéter dans l’accroche) : ${url}`,
  ]
    .filter(Boolean)
    .join('\n');

  const prompt =
    accountId === 'bulletin'
      ? `Tu rédiges des posts X pour le compte ${meta.handle} (veille / régulation UE, Bruxelles, marchés européens).
Produis EXACTEMENT 3 variantes d’accroche orientées engagement (hook, tension, chiffre ou question).
Règles : pas d’URL, pas de hashtags, pas de « thread », max ~200 caractères par variante, ton professionnel français.
Réponds UNIQUEMENT avec les 3 textes séparés par une ligne contenant seulement ---`
      : `Tu rédiges des posts X pour le compte ${meta.handle} (média ElectronLibre : numérique, IA, médias, plateformes).
Produis EXACTEMENT 3 variantes d’accroche orientées engagement (hook, tension, chiffre ou question).
Règles : pas d’URL, pas de hashtags spam, pas de « thread », max ~200 caractères par variante, ton professionnel français.
Réponds UNIQUEMENT avec les 3 textes séparés par une ligne contenant seulement ---`;

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
    url,
    variants: variants.slice(0, 3),
    text: variants[0] || compose(title || 'ElectronLibre', url),
    source: sourceMode,
  };
}
