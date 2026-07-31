/**
 * Binding host ElectronLibre des helpers articles Pupitre.
 * Table `el_articles` + rôles EL.
 */
import { canAccessDesk, canEditAll } from '../../roles.mjs';
import { createArticleHelpers } from '../core/article-helpers.mjs';

export const {
  canEditArticle,
  ensureArticleDateNullable,
  nextArticleId,
  uniqueSlug,
  resolveArticleSlug,
  slugify,
  asJson,
  nowMysql,
  toMysqlDate,
  PLACEHOLDER_SLUGS,
} = createArticleHelpers({
  tableName: 'el_articles',
  canAccessDesk,
  canEditAll,
});
