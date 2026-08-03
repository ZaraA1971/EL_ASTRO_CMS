/**
 * Politique mots-clés / tags — denylist extraction + stop tags newsletter.
 */

import { stripDiacritics } from './slugify.mjs';
import { DEFAULT_CATEGORIES } from './categories.mjs';

/** Clé de comparaison (NFD, minuscules, espaces). */
export function normalizeKeywordKey(value) {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Thèmes trop larges à écarter de l’extraction IA
 * (même si le modèle les renvoie).
 */
export const KEYWORD_DENY_TERMS = Object.freeze([
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
]);

/** Stop tags newsletter en plus de la denylist + rubriques. */
export const NEWSLETTER_TAG_STOP_EXTRA = Object.freeze([
  'android',
  'newsletter',
  'googlebook',
  'plateformes',
  'streaming',
  'musique',
  'cinéma',
  'cinema',
]);

const DENY_NORM = new Set(
  KEYWORD_DENY_TERMS.map(normalizeKeywordKey).filter(Boolean)
);

function buildNewsletterStopNorm() {
  const set = new Set(DENY_NORM);
  for (const t of NEWSLETTER_TAG_STOP_EXTRA) {
    const k = normalizeKeywordKey(t);
    if (k) set.add(k);
  }
  for (const c of DEFAULT_CATEGORIES) {
    for (const raw of [c.name, c.slug, String(c.slug || '').replace(/_/g, ' ')]) {
      const k = normalizeKeywordKey(raw);
      if (k) set.add(k);
    }
  }
  return set;
}

const NEWSLETTER_STOP_NORM = buildNewsletterStopNorm();

export function isDeniedKeyword(value) {
  const key = normalizeKeywordKey(value);
  return Boolean(key) && DENY_NORM.has(key);
}

export function isNewsletterStopTag(value) {
  const key = normalizeKeywordKey(value);
  return Boolean(key) && NEWSLETTER_STOP_NORM.has(key);
}
