/**
 * Surface publique Pupitre core (portable).
 * Host EL : importer aussi `../el/el-plugins.mjs`.
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
} from './article-helpers.mjs';
