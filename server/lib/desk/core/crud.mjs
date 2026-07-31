/**
 * Entrée CRUD portable : catégories + articles + médias.
 * Auth /me / users / authors restent dans le host.
 */
import { handleCoreCategories } from './categories/router.mjs';
import { handleCoreArticles } from './articles/router.mjs';
import { handleCoreMedia } from './media/router.mjs';

/**
 * @returns {Promise<boolean>} true si une route core a répondu
 */
export async function tryHandleCoreCrud(req, res, parts, ctx) {
  if (parts[2] === 'categories' && !parts[3]) {
    await handleCoreCategories(req, res, parts, ctx);
    return true;
  }
  if (parts[2] === 'media') {
    return handleCoreMedia(req, res, parts, ctx);
  }
  if (parts[2] === 'articles') {
    return handleCoreArticles(req, res, parts, ctx);
  }
  return false;
}
