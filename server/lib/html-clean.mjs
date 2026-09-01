/** Re-export — implémentation dans /shared/html-clean.mjs */
export {
  HTML_CLEAN_CONTEXTS,
  STYLE_ALLOWLIST,
  ATTR_ALLOWLIST,
  filterStyleDeclarations,
  normalizeInlineStyles,
  extractClipboardFragment,
  stripFontJunk,
  promoteInlineStyles,
  normalizeInlineMarkup,
  stripEmbeddedCss,
  unwrapPasteWrappers,
  filterTagAttributes,
  flattenPastedHeadings,
  cleanHtml,
} from '../../shared/html-clean.mjs';
