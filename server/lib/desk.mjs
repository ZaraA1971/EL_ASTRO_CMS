/**
 * Host ElectronLibre du Pupitre — auth, /me, media, authors, users,
 * puis délégation CRUD articles/catégories au core.
 */
import crypto from 'node:crypto';
import { parseJsonArray, rowToArticle } from './db.mjs';
import { canAccessDesk, canEditAll, canPublish } from './roles.mjs';
import { canManageUsers, handleDeskUsers } from './users.mjs';
import { auditLog } from './audit.mjs';
import { chapo } from './excerpt.mjs';
import { cleanHtml } from './html-clean.mjs';
import { handleDeskMedia } from './media/handler.mjs';
import { elCategoriesStore } from './categories.mjs';
import { createElDeskRegistry } from './desk/el/el-plugins.mjs';
import { normalizeKeywords } from './keywords.mjs';
import {
  ARTICLES_TABLE,
  articleHelpers,
  canEditArticle,
  slugify,
} from './desk/el/article-host.mjs';
import {
  ensureSubscriberKeywords,
  loadEditableTwin,
  syncKeywordsToTwin,
} from './desk/el/article-el.mjs';
import { pushPublishedArticle } from './desk/el/plugins/push.mjs';
import { getContentGen } from './desk/core/content-gen.mjs';
import { tryHandleCoreCrud } from './desk/core/crud.mjs';

function deskBrand(ctx) {
  return {
    name: ctx.brand?.name || process.env.DESK_BRAND_NAME || 'Pupitre',
    product:
      ctx.brand?.product || process.env.DESK_BRAND_PRODUCT || '',
    shortName:
      ctx.brand?.shortName ||
      process.env.DESK_BRAND_SHORT ||
      'Pupitre',
  };
}

export { canAccessDesk, canEditAll, canPublish };
export { canEditArticle } from './desk/el/article-host.mjs';
export { bumpContentGen, getContentGen } from './desk/core/content-gen.mjs';

/** Plugins EL (+ front-cache hooks). */
const defaultDeskPlugins = createElDeskRegistry();

/** Qualif / services machine — création brouillon uniquement. */
const DESK_INGEST_SESSION = Object.freeze({
  uid: null,
  login: 'qualif',
  name: 'Qualif',
  role: 'editor',
  ingest: true,
});

function safeEqualStr(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (!ba.length || ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function readDeskIngestKey(req) {
  const header = req.headers['x-desk-ingest-key'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  const auth = req.headers.authorization;
  if (typeof auth === 'string') {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  return '';
}

/**
 * Auth machine Qualif → Desk (clé partagée).
 * Autorise uniquement POST /api/desk/articles (création brouillon).
 */
function resolveDeskIngestSession(req, parts, apiKey) {
  if (!apiKey) return null;
  const provided = readDeskIngestKey(req);
  if (!provided || !safeEqualStr(provided, apiKey)) return null;
  const isCreate =
    parts[2] === 'articles' && !parts[3] && req.method === 'POST';
  if (!isCreate) {
    const err = new Error('Ingest Desk : création de brouillon uniquement');
    err.status = 403;
    throw err;
  }
  return DESK_INGEST_SESSION;
}

export async function handleDesk(req, res, parts, ctx) {
  const { pool, sendJson, resolveDeskSession, clientIp } = ctx;
  let session = null;
  try {
    session = resolveDeskIngestSession(req, parts, ctx.deskIngestApiKey);
  } catch (err) {
    return sendJson(res, err.status || 403, {
      error: err.message || 'Accès pupitre refusé',
    });
  }
  if (!session) {
    const resolved = resolveDeskSession
      ? await resolveDeskSession(req)
      : null;
    session = resolved?.session || null;
  }
  if (!session || !canAccessDesk(session.role)) {
    return sendJson(res, 403, { error: 'Accès pupitre refusé' });
  }
  const ip = typeof clientIp === 'function' ? clientIp(req) : undefined;
  const actor = session.ingest
    ? { uid: null, login: session.login }
    : { uid: session.uid, login: session.login };
  const plugins = ctx.plugins || defaultDeskPlugins;

  const deskReqCtx = {
    ...ctx,
    session,
    actor,
    ip,
    plugins,
    articleHelpers,
    articlesTable: ARTICLES_TABLE,
    categories: elCategoriesStore,
    rowToArticle,
    parseJsonArray,
    canEditAll,
    canPublish,
    cleanHtml,
    chapo,
    auditLog,
    normalizeKeywords,
    ensureSubscriberKeywords,
    loadEditableTwin,
    syncKeywordsToTwin,
    beforeArticleRoute: (req2, res2, parts2, c, existing) =>
      plugins.tryHandleArticle(req2, res2, parts2, c, existing),
    afterPublish: async ({ row, payload }, c) => {
      if (!payload?.push) return null;
      return pushPublishedArticle(row, c, { segment: payload.segment });
    },
  };

  // /api/desk/me
  if (parts[2] === 'me' && req.method === 'GET') {
    return sendJson(res, 200, {
      user: {
        id: session.uid,
        login: session.login,
        name: session.name,
        role: session.role,
      },
      capabilities: plugins.mergeCaps(
        {
          editAll: canEditAll(session.role),
          create: true,
          publish: canPublish(session.role),
          manageUsers: canManageUsers(session.role),
          media: true,
          mediaDelete: canEditAll(session.role),
        },
        ctx,
        session
      ),
      brand: deskBrand(ctx),
      contentGen: getContentGen(),
      plugins: plugins.ids(),
    });
  }

  // Plugins top-level (newsletter, audience, …)
  if (await plugins.tryHandle(req, res, parts, deskReqCtx)) {
    return;
  }

  // /api/desk/media — médiathèque (EL)
  if (parts[2] === 'media') {
    return handleDeskMedia(req, res, parts, {
      ...ctx,
      session,
      actor,
      ip,
    });
  }

  // GET /api/desk/authors?q= — autocomplete (EL)
  if (parts[2] === 'authors' && !parts[3] && req.method === 'GET') {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const q = String(url.searchParams.get('q') || '').trim();
    const like = q ? `%${q}%` : null;
    const out = [];
    const seen = new Set();

    const push = (row) => {
      const name = String(row.name || '').trim();
      if (!name) return;
      const key = name.toLocaleLowerCase('fr');
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        name,
        slug: row.slug ? String(row.slug) : slugify(name),
        userId: row.user_id != null ? Number(row.user_id) : null,
        source: row.source || 'article',
      });
    };

    if (like) {
      const [fromArticles] = await pool.query(
        `SELECT author AS name, author_slug AS slug, author_user_id AS user_id,
                COUNT(*) AS n, 'article' AS source
         FROM el_articles
         WHERE author LIKE ?
         GROUP BY author, author_slug, author_user_id
         ORDER BY n DESC, author ASC
         LIMIT 16`,
        [like]
      );
      for (const r of fromArticles) push(r);

      const [fromUsers] = await pool.query(
        `SELECT display_name AS name, login AS slug, id AS user_id, 'user' AS source
         FROM el_users
         WHERE status = 'active'
           AND role IN ('admin', 'administrator', 'editor', 'author')
           AND (display_name LIKE ? OR login LIKE ?)
         ORDER BY display_name ASC
         LIMIT 16`,
        [like, like]
      );
      for (const r of fromUsers) push(r);
    } else {
      const [top] = await pool.query(
        `SELECT author AS name, author_slug AS slug, author_user_id AS user_id,
                COUNT(*) AS n, 'article' AS source
         FROM el_articles
         WHERE author IS NOT NULL AND TRIM(author) != ''
         GROUP BY author, author_slug, author_user_id
         ORDER BY n DESC, author ASC
         LIMIT 12`
      );
      for (const r of top) push(r);
    }

    return sendJson(res, 200, { authors: out.slice(0, 12) });
  }

  // /api/desk/users[/:id]
  if (parts[2] === 'users') {
    return handleDeskUsers(req, res, parts, { ...ctx, session, ip, actor });
  }

  // CRUD portable articles + catégories
  if (await tryHandleCoreCrud(req, res, parts, deskReqCtx)) {
    return;
  }

  return sendJson(res, 404, { error: 'Route desk inconnue' });
}
