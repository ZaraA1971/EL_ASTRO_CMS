/**
 * Extraction mots-clés IA via RAG local (/keywords) + normalisation éditoriale.
 * Cible : entités concrètes (noms, entreprises, secteurs) — pas de thèmes larges.
 */

/** Plafond de sécurité (articles extrêmes) — le corps entier passe en dessous. */
const MAX_CONTENT_CHARS = 80_000;
const MAX_KEYWORDS = 7;

/** Thèmes / termes trop larges à écarter côté API même si le modèle les renvoie. */
const KEYWORD_DENYLIST = new Set(
  [
    'innovation',
    'régulation',
    'regulation',
    'réseaux sociaux',
    'reseaux sociaux',
    'social media',
    'intelligence artificielle',
    'artificial intelligence',
    'ia',
    'ai',
    'numérique',
    'numerique',
    'digital',
    'tech',
    'technologie',
    'technologies',
    'actualité',
    'actualite',
    'news',
    'transformation',
    'marché',
    'marche',
    'market',
    'croissance',
    'growth',
    'scandale',
    'enquête',
    'enquete',
    'investigation',
    'internet',
    'web',
    'données',
    'donnees',
    'data',
    'cybersécurité',
    'cybersecurite',
    'cybersecurity',
    'privacy',
    'vie privée',
    'vie privee',
    'économie',
    'economie',
    'economy',
    'politique',
    'politics',
    'entreprise',
    'entreprises',
    'company',
    'companies',
    'secteur',
    'secteurs',
    'industrie',
    'futur',
    'avenir',
    'enjeu',
    'enjeux',
    'tendance',
    'tendances',
    'trend',
    'trends',
    'electronlibre',
    'electron libre',
    'électronlibre',
    'électron libre',
  ].map((s) => s.toLocaleLowerCase('fr'))
);

export function stripHtmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Construit le texte pour l’extracteur : titre + chapô + corps entier.
 */
export function buildKeywordSource({ title, excerpt, body, lang } = {}) {
  const parts = [];
  const t = String(title || '').trim();
  const ex = stripHtmlToText(excerpt);
  const bodyText = stripHtmlToText(body);
  if (t) parts.push(`Titre : ${t}`);
  if (ex) parts.push(`Chapô : ${ex}`);
  if (bodyText) parts.push(`Article :\n${bodyText}`);
  let content = parts.join('\n\n').trim();
  // Garde-fou uniquement pour les outliers (évite de saturer le LLM)
  if (content.length > MAX_CONTENT_CHARS) {
    content = `${content.slice(0, MAX_CONTENT_CHARS).trim()}…`;
  }
  const language = String(lang || 'fr').toLowerCase().startsWith('en')
    ? 'en'
    : 'fr';
  return { content, language };
}

export function normalizeKeywords(raw, { max = MAX_KEYWORDS } = {}) {
  const seen = new Set();
  const out = [];
  const list = Array.isArray(raw)
    ? raw
    : String(raw || '')
        .split(/[\n,;]+/)
        .map((s) => s.trim());

  for (let item of list) {
    if (!item) continue;
    item = String(item)
      .replace(/^[-*•\d.)\s]+/, '')
      .replace(/[.«»""„‟()[\]{}]/g, '')
      .replace(/[.!?;:…]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!item || item.length < 2) continue;
    const words = item.split(/\s+/);
    const looksLikePerson =
      words.length >= 2 &&
      words.length <= 4 &&
      words.every(
        (w) =>
          /^[A-ZÀ-ÖØ-Ý]/.test(w) ||
          ['de', 'del', 'van', 'von', 'da', 'di', 'le', 'la'].includes(w.toLowerCase())
      );
    if (looksLikePerson ? words.length > 4 : words.length > 3) continue;
    const key = item.toLocaleLowerCase('fr');
    if (seen.has(key) || KEYWORD_DENYLIST.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * @param {{ upstream: string, apiKey: string, content: string, language?: string }} opts
 */
export async function extractKeywordsViaRag({
  upstream,
  apiKey,
  content,
  language = 'fr',
}) {
  if (!upstream) throw new Error('RAG upstream manquant');
  if (!apiKey) throw new Error('RAG_API_KEY manquant');
  if (!content || content.length < 20) {
    throw new Error('Pas assez de texte pour extraire des mots-clés');
  }

  const res = await fetch(`${upstream.replace(/\/$/, '')}/keywords`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      Accept: 'application/json',
    },
    body: JSON.stringify({ content, language }),
    signal: AbortSignal.timeout(90_000),
  });
  const text = await res.text().catch(() => '');
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    const msg =
      data?.data?.message || data?.error || data?.message || `RAG HTTP ${res.status}`;
    throw new Error(msg);
  }
  return normalizeKeywords(data.keywords || []);
}
