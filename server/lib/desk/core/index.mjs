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
