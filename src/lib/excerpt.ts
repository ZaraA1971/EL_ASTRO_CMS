/**
 * Re-export typé — source : shared/excerpt.mjs
 * Call-sites front : préférer chapo(article, context).
 */
export {
  EXCERPT_CONTEXTS,
  chapo,
  stripLeadingChapoHtml,
  stripHtmlToText,
  plainTextFromHtml,
} from '@el/excerpt';
