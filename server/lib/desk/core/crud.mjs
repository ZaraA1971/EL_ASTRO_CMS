/**
 * Entrée CRUD portable : catégories + articles + médias + authors + users.
 * Auth /me restent dans le host.
 */
import { handleCoreCategories } from './categories/router.mjs';
import { handleCoreArticles } from './articles/router.mjs';
import { handleCoreMedia } from './media/router.mjs';
import { handleCoreAuthors } from './authors/router.mjs';
import { handleCoreUsers } from './users/router.mjs';

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
  if (parts[2] === 'authors') {
    return handleCoreAuthors(req, res, parts, ctx);
  }
  if (parts[2] === 'users') {
    return handleCoreUsers(req, res, parts, ctx);
  }
  if (parts[2] === 'articles') {
    return handleCoreArticles(req, res, parts, ctx);
  }
  return false;
}
