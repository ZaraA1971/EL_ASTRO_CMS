/**
 * Host ElectronLibre du Pupitre — auth, /me, puis CRUD core
 * (articles, catégories, médias, authors, users) via tryHandleCoreCrud.
 *
 * Sensible (users) : hash WP + newsletter + mails restent dans users.mjs
 * (policy + hooks), jamais dans le core.
 */
import crypto from 'node:crypto';
import { parseJsonArray, rowToArticle } from './db.mjs';
import { canAccessDesk, canEditAll, canPublish, isStaffRole } from './roles.mjs';
import {
  canManageUsers,
  elUsersStore,
  elUserPolicy,
  elAfterUserCreate,
  elAfterUserDelete,
} from './users.mjs';
import { auditLog } from './audit.mjs';
import { chapo } from './excerpt.mjs';
import { cleanHtml } from './html-clean.mjs';
import { elCategoriesStore } from './categories.mjs';
import { elMediaStore } from './media/schema.mjs';
import {
  resolveMediaRoot,
  slugifyFilename,
  yyyymmDirs,
  uniqueRelPath,
  publicUrlFromPath,
  absoluteFromRel,
  toMediaDto,
  MAX_UPLOAD_BYTES,
} from './media/storage.mjs';
import { detectMediaMime, writeMediaFile } from './media/process.mjs';
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

const elMediaFs = {
  resolveMediaRoot,
  slugifyFilename,
  yyyymmDirs,
  uniqueRelPath,
  publicUrlFromPath,
  absoluteFromRel,
  toMediaDto,
  MAX_UPLOAD_BYTES,
  detectMediaMime,
  writeMediaFile,
};

/** Rôles staff pour autocomplete auteurs (inclut legacy administrator). */
const AUTHOR_STAFF_ROLES = [
  'admin',
  'administrator',
  'editor',
  'author',
];

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
  const { sendJson, resolveDeskSession, clientIp } = ctx;
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
    usersTable: elUsersStore.tableName,
    staffRoles: AUTHOR_STAFF_ROLES,
    slugify,
    categories: elCategoriesStore,
    mediaStore: elMediaStore,
    mediaFs: elMediaFs,
    usersStore: elUsersStore,
    userPolicy: elUserPolicy,
    afterUserCreate: elAfterUserCreate,
    afterUserDelete: elAfterUserDelete,
    rowToArticle,
    parseJsonArray,
    canEditAll,
    canPublish,
    isStaffRole,
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

  // CRUD portable (articles, catégories, médias, authors, users)
  if (await tryHandleCoreCrud(req, res, parts, deskReqCtx)) {
    return;
  }

  return sendJson(res, 404, { error: 'Route desk inconnue' });
}
