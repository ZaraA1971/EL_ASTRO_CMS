/**
 * API iOS /api/ios/v1/*
 * Seule surface app (pont /wp-json WP retiré).
 * Accès / RAG : modules partagés (access.mjs, rag-upstream.mjs, users-db.mjs).
 */
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import wordpressHash from 'wordpress-hash-node';
import { canAccessPremium, publicUser, STATUSES } from '../roles.mjs';
import { rateLimit, clientIp } from '../rate-limit.mjs';
import {
  AccessError,
  assertAuthenticated,
  assertEntitled,
  resolveAccess,
} from '../access.mjs';
import { findUserByLogin } from '../users-db.mjs';
import { fetchAskWeb, pipeSseToResponse } from '../rag-upstream.mjs';
import {
  bearerFromReq,
  iosJwtConfigured,
  issueIosJwt,
} from './jwt.mjs';
import {
  queryIosArticles,
  resolveArticleForLang,
  toIosArticleDto,
} from './articles.mjs';

const checkPhpass = wordpressHash.CheckPassword || wordpressHash.checkPassword;

function toBcryptjsHash(hash) {
  if (hash.startsWith('$2y$')) return '$2a$' + hash.slice(4);
  return hash;
}

function verifyWpPassword(plain, hash) {
  if (!plain || !hash) return false;
  if (hash.startsWith('$P$') || hash.startsWith('$H$')) {
    try {
      return !!checkPhpass(plain, hash);
    } catch {
      return false;
    }
  }
  if (hash.startsWith('$wp')) {
    try {
      const passwordToVerify = crypto
        .createHmac('sha384', 'wp-sha384')
        .update(plain, 'utf8')
        .digest('base64');
      return bcrypt.compareSync(passwordToVerify, toBcryptjsHash(hash.slice(3)));
    } catch {
      return false;
    }
  }
  if (
    hash.startsWith('$2y$') ||
    hash.startsWith('$2a$') ||
    hash.startsWith('$2b$')
  ) {
    try {
      return bcrypt.compareSync(plain, toBcryptjsHash(hash));
    } catch {
      return false;
    }
  }
  return false;
}

async function parseJsonBody(readBody, req) {
  const raw = await readBody(req);
  const text = Buffer.isBuffer(raw)
    ? raw.toString('utf8')
    : String(raw || '');
  if (!text.trim()) return {};
  return JSON.parse(text);
}

/** Bearer obligatoire (pas de fallback cookie sur les routes auth iOS). */
async function requireBearerAccess(pool, req, jwtCfg) {
  if (!bearerFromReq(req)) {
    throw new AccessError(
      401,
      'Authorization Bearer required.',
      'jwt_auth_no_auth_header'
    );
  }
  const access = await resolveAccess(req, { pool, jwtCfg });
  return assertAuthenticated(access);
}

/**
 * parts: ['api','ios','v1', ...]
 */
export async function handleIos(req, res, parts, ctx) {
  const { pool, sendJson, readBody, jwt, siteUrl, rag } = ctx;
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (parts[2] !== 'v1') {
    return sendJson(res, 404, { error: 'Not found' });
  }

  if (!iosJwtConfigured(jwt)) {
    return sendJson(res, 503, {
      error: 'API iOS non configurée (EL_IOS_JWT_SECRET)',
    });
  }

  const jwtCfg = {
    secret: jwt.secret,
    ttlDays: jwt.ttlDays,
    iss: siteUrl || 'https://electronlibre.info',
  };

  // POST /api/ios/v1/auth/token
  if (parts[3] === 'auth' && parts[4] === 'token' && !parts[5] && req.method === 'POST') {
    const ip = clientIp(req);
    const lim = rateLimit(`ios-login:${ip}`, { windowMs: 15 * 60_000, max: 20 });
    if (!lim.ok) {
      return sendJson(res, 429, {
        error: 'Trop de tentatives. Réessayez plus tard.',
        retryAfterSec: lim.retryAfterSec,
      });
    }
    let payload;
    try {
      payload = await parseJsonBody(readBody, req);
    } catch {
      return sendJson(res, 400, { error: 'JSON invalide' });
    }
    const username = String(payload.username || payload.login || '').trim();
    const password = String(payload.password || '');
    if (!username || !password) {
      return sendJson(res, 400, {
        code: 'jwt_auth_bad_request',
        message: 'Username and password required.',
        data: { status: 400 },
      });
    }
    const user = await findUserByLogin(pool, username);
    if (
      !user ||
      String(user.status || '').toLowerCase() === STATUSES.DISABLED ||
      !verifyWpPassword(password, user.password_hash)
    ) {
      return sendJson(res, 403, {
        code: 'jwt_auth_invalid_credentials',
        message: 'Wrong credentials.',
        data: { status: 403 },
      });
    }
    // isSubscriber === canAccessPremium (Pupitre courant) — toujours true|false.
    const isSubscriber = canAccessPremium(user) === true;
    const token = issueIosJwt(user.id, jwtCfg, { isSubscriber });
    return sendJson(res, 200, {
      success: true,
      data: { token },
    });
  }

  // POST /api/ios/v1/auth/refresh
  if (parts[3] === 'auth' && parts[4] === 'refresh' && !parts[5] && req.method === 'POST') {
    const ip = clientIp(req);
    const lim = rateLimit(`ios-refresh:${ip}`, { windowMs: 15 * 60_000, max: 60 });
    if (!lim.ok) {
      return sendJson(res, 429, {
        error: 'Trop de refresh. Réessayez plus tard.',
        retryAfterSec: lim.retryAfterSec,
      });
    }
    try {
      const access = await requireBearerAccess(pool, req, jwtCfg);
      // Recalcul Pupitre courant (pas le claim figé du token précédent).
      // Même règle que /auth/token et /auth/me.entitled.
      const isSubscriber = canAccessPremium(access.user) === true;
      const token = issueIosJwt(access.user.id, jwtCfg, { isSubscriber });
      return sendJson(res, 200, { success: true, data: { token } });
    } catch (err) {
      return sendJson(res, err.status || 401, {
        code: err.code || 'JWT_INVALID',
        message: err.message || 'Invalid token',
        data: { status: err.status || 401 },
      });
    }
  }

  // GET /api/ios/v1/auth/me
  if (parts[3] === 'auth' && parts[4] === 'me' && !parts[5] && req.method === 'GET') {
    try {
      const access = await requireBearerAccess(pool, req, jwtCfg);
      const pub = publicUser(access.user);
      // entitled === isSubscriber (même règle canAccessPremium).
      const entitled = canAccessPremium(access.user) === true;
      return sendJson(res, 200, {
        authenticated: true,
        entitled,
        user: pub ? { ...pub, entitled } : pub,
      });
    } catch (err) {
      return sendJson(res, err.status || 401, {
        authenticated: false,
        entitled: false,
        code: err.code || 'JWT_INVALID',
        message: err.message || 'Invalid token',
      });
    }
  }

  // GET /api/ios/v1/articles  |  /articles/:id  |  /search
  if (
    (parts[3] === 'articles' || parts[3] === 'search') &&
    req.method === 'GET'
  ) {
    const access = await resolveAccess(req, { pool, jwtCfg });
    if (access.bearerInvalid) {
      return sendJson(res, 401, {
        code: 'JWT_INVALID',
        message: 'Invalid or expired token',
        data: { status: 401 },
      });
    }
    const lang = url.searchParams.get('lang') || 'FR';
    const entitled = !!access.entitled;

    if (parts[3] === 'articles' && parts[4] && !parts[5]) {
      const row = await resolveArticleForLang(pool, parts[4], lang);
      if (!row) {
        return sendJson(res, 404, {
          code: 'no_post',
          message: 'Aucun article publié trouvé pour cette langue',
          data: { status: 404 },
        });
      }
      return sendJson(
        res,
        200,
        toIosArticleDto(row, { entitled, lang })
      );
    }

    if (
      (parts[3] === 'articles' && !parts[4]) ||
      (parts[3] === 'search' && !parts[4])
    ) {
      const rows = await queryIosArticles(pool, {
        lang,
        page: url.searchParams.get('page'),
        per_page: url.searchParams.get('per_page'),
        search:
          url.searchParams.get('search') ||
          (parts[3] === 'search' ? url.searchParams.get('q') : ''),
      });
      return sendJson(
        res,
        200,
        rows.map((row) => toIosArticleDto(row, { entitled, lang }))
      );
    }
  }

  // POST /api/ios/v1/rag/askWeb
  if (
    parts[3] === 'rag' &&
    parts[4] === 'askWeb' &&
    !parts[5] &&
    req.method === 'POST'
  ) {
    let access;
    try {
      access = await requireBearerAccess(pool, req, jwtCfg);
      assertEntitled(access);
    } catch (err) {
      const status = err.status || 401;
      return sendJson(res, status, {
        ...(status === 403
          ? { error: err.message || 'Abonnement requis ou expiré.', entitled: false }
          : {
              code: err.code || 'JWT_INVALID',
              message: err.message || 'Invalid token',
            }),
      });
    }
    const ip = clientIp(req);
    const lim = rateLimit(`ios-rag:${ip}:${access.user.id}`, {
      windowMs: 60_000,
      max: 20,
    });
    if (!lim.ok) {
      return sendJson(res, 429, {
        error: 'Trop de requêtes. Réessayez dans un instant.',
        retryAfterSec: lim.retryAfterSec,
      });
    }
    let payload;
    try {
      payload = await parseJsonBody(readBody, req);
    } catch {
      return sendJson(res, 400, { error: 'JSON invalide' });
    }
    try {
      const upstreamRes = await fetchAskWeb({
        upstream: rag?.upstream,
        apiKey: rag?.apiKey,
        question: payload.question,
        language: payload.language,
        client: payload.client || 'ios',
        inline_citations: payload.inline_citations,
      });
      await pipeSseToResponse(res, upstreamRes);
    } catch (err) {
      console.error('[ios] rag', err.message);
      const status = err.status || 502;
      return sendJson(res, status, {
        error:
          status === 502
            ? err.upstreamStatus
              ? 'Réponse RAG invalide'
              : 'Connexion RAG impossible'
            : err.message || 'Erreur RAG',
        ...(err.upstreamStatus ? { status: err.upstreamStatus } : {}),
      });
    }
    return;
  }

  return sendJson(res, 404, { error: 'Not found' });
}
