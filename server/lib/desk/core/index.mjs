/**
 * Surface publique Pupitre core.
 * Host EL : `../el/index.mjs` pour les adapters.
 */
export {
  createPluginRegistry,
  resolveEnabledPluginIds,
} from './plugin-registry.mjs';
export { bumpContentGen, getContentGen } from './content-gen.mjs';
export { emitDeskLifecycle } from './lifecycle.mjs';
export {
  canEditArticle,
  normalizeKeywords,
  nextArticleId,
  uniqueSlug,
  resolveArticleSlug,
  slugify,
  asJson,
  nowMysql,
  toMysqlDate,
  ensureArticleDateNullable,
  PLACEHOLDER_SLUGS,
} from './article-helpers.mjs';
