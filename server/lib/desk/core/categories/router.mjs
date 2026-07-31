/**
 * GET/POST /api/desk/categories — CRUD rubriques (store injecté).
 */
import { parseJsonBody } from '../http.mjs';
import { emitDeskLifecycle } from '../lifecycle.mjs';

/**
 * @param {object} ctx
 * @param {ReturnType<import('./store.mjs').createCategoriesStore>} ctx.categories
 */
export async function handleCoreCategories(req, res, _parts, ctx) {
  const {
    pool,
    sendJson,
    readBody,
    session,
    actor,
    ip,
    plugins,
    categories,
    auditLog,
  } = ctx;

  if (!categories?.list || !categories?.create) {
    return sendJson(res, 500, { error: 'Store catégories manquant' });
  }

  if (req.method === 'GET') {
    const list = await categories.list(pool);
    return sendJson(res, 200, { categories: list });
  }

  if (req.method === 'POST') {
    const parsed = await parseJsonBody(req, readBody);
    if (!parsed.ok) {
      return sendJson(res, 400, { error: 'JSON invalide' });
    }
    try {
      const category = await categories.create(pool, {
        name: parsed.value.name,
        slug: parsed.value.slug,
      });
      if (typeof auditLog === 'function') {
        await auditLog(pool, {
          actor,
          action: 'category.create',
          targetType: 'category',
          targetId: category.slug,
          meta: { name: category.name },
          ip,
        });
      }
      await emitDeskLifecycle(
        plugins,
        'onCategoryChange',
        { category },
        ctx
      );
      return sendJson(res, 201, { category });
    } catch (err) {
      return sendJson(res, err.status || 500, {
        error: err.message || 'Création rubrique impossible',
      });
    }
  }

  return sendJson(res, 405, { error: 'Méthode non autorisée' });
}
