/** Re-export — implémentation dans /shared/excerpt.mjs */
export {
  EXCERPT_CONTEXTS,
  chapo,
  stripLeadingChapoHtml,
  stripHtmlToText,
  plainTextFromHtml,
  // helpers bas niveau (tests / usage avancé)
  HERO_EXCERPT_WORDS,
  CARD_EXCERPT_WORDS,
  RELATED_EXCERPT_WORDS,
  IOS_BODY_FALLBACK_WORDS,
  deriveExcerptFromBody,
  trimExcerpt,
  cardExcerpt,
  excerptPlainForClient,
} from '../../shared/excerpt.mjs';
