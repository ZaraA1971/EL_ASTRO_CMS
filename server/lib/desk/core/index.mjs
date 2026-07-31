/**
 * Surface publique Pupitre core.
 * Host EL : `../el/index.mjs` / `../el/article-host.mjs` pour les bindings.
 */
export {
  createPluginRegistry,
  resolveEnabledPluginIds,
} from './plugin-registry.mjs';
export { bumpContentGen, getContentGen } from './content-gen.mjs';
export { emitDeskLifecycle } from './lifecycle.mjs';
export {
  createArticleHelpers,
  slugify,
  asJson,
  nowMysql,
  toMysqlDate,
  PLACEHOLDER_SLUGS,
} from './article-helpers.mjs';
export { createCategoriesStore } from './categories/store.mjs';
export { handleCoreCategories } from './categories/router.mjs';
export { handleCoreArticles } from './articles/router.mjs';
export { createMediaStore } from './media/store.mjs';
export { handleCoreMedia } from './media/router.mjs';
export { tryHandleCoreCrud } from './crud.mjs';
export { parseJsonBody, assertSafeSqlIdent } from './http.mjs';
