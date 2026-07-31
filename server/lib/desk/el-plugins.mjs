/**
 * Plugins ElectronLibre branchés sur le Pupitre (hors core).
 */
import { canPublish } from '../roles.mjs';
import { handleDeskNewsletter } from '../newsletter/handler.mjs';
import { handleDeskAudience } from '../audience/handler.mjs';
import { handleDeskArticleX } from '../x-desk.mjs';
import {
  anyXAccountConfigured,
  listXAccountsPublic,
} from '../x-accounts.mjs';
import {
  createPluginRegistry,
  resolveEnabledPluginIds,
} from './plugin-registry.mjs';
import { handleDeskAssist } from './plugins/assist.mjs';
import { handleDeskContentGen } from './plugins/content-gen.mjs';
import { handleDeskArticleKeywords } from './plugins/keywords.mjs';
import { handleDeskArticlePush } from './plugins/push.mjs';
import { handleDeskArticleTranslateUk } from './plugins/translate.mjs';

/** @type {import('./plugin-registry.mjs').DeskPlugin[]} */
export const EL_DESK_PLUGINS = [
  {
    id: 'newsletter',
    caps(ctx, session) {
      return {
        newsletter: Boolean(canPublish(session.role)),
        newsletterDryRun: Boolean(ctx.brevo?.dryRun),
      };
    },
    match(parts) {
      return parts[2] === 'newsletter';
    },
    handle(req, res, parts, ctx) {
      return handleDeskNewsletter(req, res, parts, ctx);
    },
  },
  {
    id: 'audience',
    caps(_ctx, session) {
      return {
        audience: Boolean(canPublish(session.role)),
      };
    },
    match(parts) {
      return parts[2] === 'audience';
    },
    handle(req, res, parts, ctx) {
      return handleDeskAudience(req, res, parts, ctx);
    },
  },
  {
    id: 'x',
    caps(ctx, session) {
      return {
        xPost: Boolean(
          canPublish(session.role) &&
            (ctx.x?.dryRun || anyXAccountConfigured(ctx.x?.env || {}))
        ),
        xPostDryRun: Boolean(ctx.x?.dryRun),
        xAccounts: listXAccountsPublic(ctx.x?.env || {}),
      };
    },
    matchArticle(parts) {
      return parts[4] === 'x';
    },
    handleArticle(req, res, parts, ctx, article) {
      return handleDeskArticleX(req, res, parts, ctx, article);
    },
  },
  {
    id: 'push',
    caps(ctx, session) {
      return {
        onesignal: Boolean(
          canPublish(session.role) &&
            (ctx.onesignal?.dryRun ||
              (ctx.onesignal?.apiKey && ctx.onesignal?.appId))
        ),
        onesignalDryRun: Boolean(ctx.onesignal?.dryRun),
      };
    },
    matchArticle(parts, req) {
      return parts[4] === 'push' && req.method === 'POST';
    },
    handleArticle(req, res, parts, ctx, article) {
      return handleDeskArticlePush(req, res, parts, ctx, article);
    },
  },
  {
    id: 'keywords',
    matchArticle(parts, req) {
      return parts[4] === 'keywords' && req.method === 'POST';
    },
    handleArticle(req, res, parts, ctx, article) {
      return handleDeskArticleKeywords(req, res, parts, ctx, article);
    },
  },
  {
    id: 'translate',
    matchArticle(parts, req) {
      return parts[4] === 'translate-uk' && req.method === 'POST';
    },
    handleArticle(req, res, parts, ctx, article) {
      return handleDeskArticleTranslateUk(req, res, parts, ctx, article);
    },
  },
  {
    id: 'assist',
    match(parts, req) {
      return parts[2] === 'assist' && !parts[3] && req.method === 'POST';
    },
    handle(req, res, parts, ctx) {
      return handleDeskAssist(req, res, parts, ctx);
    },
  },
  {
    id: 'content-gen',
    match(parts, req) {
      return parts[2] === 'content-gen' && !parts[3] && req.method === 'GET';
    },
    handle(req, res, parts, ctx) {
      return handleDeskContentGen(req, res, parts, ctx);
    },
  },
];

export function createElDeskRegistry(envValue = process.env.DESK_PLUGINS) {
  const allIds = EL_DESK_PLUGINS.map((p) => p.id);
  const enabled = new Set(resolveEnabledPluginIds(envValue, allIds));
  const plugins = EL_DESK_PLUGINS.filter((p) => enabled.has(p.id));
  return createPluginRegistry(plugins);
}
