/**
 * API ElectronLibre Astro (prod)
 * - /api/rag/*     → proxy uvicorn RAG local
 * - /api/auth/*    → login / logout / me (hashes WP via el_users)
 * - /api/content/* → corps article abonné (session requise) — MySQL el_articles
 * - /api/desk/*    → pupitre rédactionnel (rôles admin/editor/author)
 * - /api/ios/v1/*  → app iOS (Bearer JWT) — unique surface app (/wp-json retiré)
 * - /api/billing/* → abonnement Stripe (checkout, portail, webhook)
 * - /api/ops/follow/* → suivi Vigie (localhost only : audience, comptes)
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import bcrypt from 'bcryptjs';
import wordpressHash from 'wordpress-hash-node';
import { loadEnvFile, createPool, rowToArticle } from './lib/db.mjs';
import { anyXAccountConfigured } from './lib/x-accounts.mjs';
import { ensureXPostsSchema } from './lib/x-schema.mjs';
import { handleDesk, getContentGen } from './lib/desk.mjs';
import { handleIos } from './lib/ios/handler.mjs';
import {
  canAccessPremium,
  normalizeRole,
  publicUser,
  STATUSES,
} from './lib/roles.mjs';
import { resolveAccess, toEntitledSession } from './lib/access.mjs';
import { fetchAskWeb, pipeSseToResponse } from './lib/rag-upstream.mjs';
import { rateLimit, clientIp } from './lib/rate-limit.mjs';
import { ensureAuditTable } from './lib/audit.mjs';
import { ensureNewsletterSchema } from './lib/newsletter/schema.mjs';
import { ensureMediaSchema } from './lib/media/schema.mjs';
import { resolveMediaRoot } from './lib/media/storage.mjs';
import { handlePublicNewsletter } from './lib/newsletter/handler.mjs';
import {
  ensurePasswordResetSchema,
  normalizeLoginId,
  requestPasswordReset,
  resetPasswordWithToken,
  validateResetToken,
} from './lib/password-reset.mjs';
import { auditLog } from './lib/audit.mjs';
import { loadBillingConfig } from './lib/billing/config.mjs';
import { ensureBillingSchema } from './lib/billing/schema.mjs';
import { handleBilling } from './lib/billing/handler.mjs';
import { handleOpsFollow } from './lib/ops/follow.mjs';

const checkPhpass = wordpressHash.CheckPassword || wordpressHash.checkPassword;

const PORT = Number(process.env.EL_API_PORT || 8787);
const UPSTREAM = (process.env.EL_RAG_UPSTREAM || 'http://127.0.0.1:8080').replace(
  /\/$/,
  ''
);
const ENV_FILE = process.env.EL_API_ENV_FILE || '/etc/electronlibre/el-astro-api.env';
const SESSION_TTL_SEC = 60 * 60 * 24 * 14;
const COOKIE_NAME = 'el_session';

const fileEnv = loadEnvFile(ENV_FILE);
const prodEnv = loadEnvFile('/etc/electronlibre/prod.env');
const RAG_KEY = process.env.RAG_API_KEY || fileEnv.RAG_API_KEY || '';
const SESSION_SECRET =
  process.env.EL_SESSION_SECRET || fileEnv.EL_SESSION_SECRET || '';
const DEEPL_API_KEY =
  process.env.DEEPL_API_KEY || fileEnv.DEEPL_API_KEY || prodEnv.DEEPL_API_KEY || '';
const AGENT_API_KEY =
  process.env.AGENT_API_KEY ||
  fileEnv.AGENT_API_KEY ||
  prodEnv.AGENT_API_KEY ||
  '';
const AGENT_EDITORIAL_URL = (
  process.env.AGENT_EDITORIAL_URL ||
  fileEnv.AGENT_EDITORIAL_URL ||
  prodEnv.ASSISTANT_IA_AGENT_EDITORIAL_URL ||
  'http://127.0.0.1:8300/editorial/assist'
).replace(/\/+$/, '');
const ONESIGNAL_APP_ID =
  process.env.ONESIGNAL_APP_ID ||
  fileEnv.ONESIGNAL_APP_ID ||
  '2037d918-24b1-4140-8a12-92eacf2b7167';
const ONESIGNAL_REST_API_KEY =
  process.env.ONESIGNAL_REST_API_KEY || fileEnv.ONESIGNAL_REST_API_KEY || '';
const ONESIGNAL_SITE_URL = (
  process.env.ONESIGNAL_SITE_URL ||
  fileEnv.ONESIGNAL_SITE_URL ||
  'https://electronlibre.info'
).replace(/\/+$/, '');
const ONESIGNAL_DRY_RUN =
  String(process.env.ONESIGNAL_DRY_RUN || fileEnv.ONESIGNAL_DRY_RUN || '1') ===
  '1';
const brevoEnv = loadEnvFile('/etc/electronlibre/brevo-smtp.env');
const BREVO_API_KEY =
  process.env.BREVO_API_KEY ||
  fileEnv.BREVO_API_KEY ||
  brevoEnv.FLUENTMAIL_SENDINBLUE_API_KEY ||
  '';
const BREVO_SMTP_USER =
  process.env.BREVO_SMTP_USER ||
  fileEnv.BREVO_SMTP_USER ||
  brevoEnv.FLUENTMAIL_SMTP_USERNAME ||
  '';
const BREVO_SMTP_PASS =
  process.env.BREVO_SMTP_PASS ||
  fileEnv.BREVO_SMTP_PASS ||
  brevoEnv.FLUENTMAIL_SMTP_PASSWORD ||
  '';
const BREVO_DRY_RUN =
  String(process.env.BREVO_DRY_RUN || fileEnv.BREVO_DRY_RUN || '1') === '1';
const BREVO_FROM_EMAIL =
  process.env.BREVO_FROM_EMAIL ||
  fileEnv.BREVO_FROM_EMAIL ||
  'info@electronlibre.info';
const BREVO_FROM_NAME =
  process.env.BREVO_FROM_NAME || fileEnv.BREVO_FROM_NAME || 'ElectronLibre';

const GOATCOUNTER_SITE = (
  process.env.GOATCOUNTER_SITE ||
  fileEnv.GOATCOUNTER_SITE ||
  prodEnv.GOATCOUNTER_SITE ||
  ''
).replace(/^https?:\/\//, '').replace(/\.goatcounter\.com.*$/, '').replace(/\/$/, '');
const GOATCOUNTER_API_KEY =
  process.env.GOATCOUNTER_API_KEY ||
  fileEnv.GOATCOUNTER_API_KEY ||
  prodEnv.GOATCOUNTER_API_KEY ||
  '';
/** Qualif Admin → brouillons Desk (POST /api/desk/articles). */
const DESK_INGEST_API_KEY =
  process.env.DESK_INGEST_API_KEY || fileEnv.DESK_INGEST_API_KEY || '';

/** X / Twitter — post depuis le Pupitre (OAuth 1.0a par compte). */
const X_DRY_RUN =
  String(process.env.X_DRY_RUN || fileEnv.X_DRY_RUN || '1') === '1';
const X_ENV = {
  X_EL_API_KEY: process.env.X_EL_API_KEY || fileEnv.X_EL_API_KEY || '',
  X_EL_API_SECRET: process.env.X_EL_API_SECRET || fileEnv.X_EL_API_SECRET || '',
  X_EL_ACCESS_TOKEN:
    process.env.X_EL_ACCESS_TOKEN || fileEnv.X_EL_ACCESS_TOKEN || '',
  X_EL_ACCESS_SECRET:
    process.env.X_EL_ACCESS_SECRET || fileEnv.X_EL_ACCESS_SECRET || '',
  X_BULLETIN_API_KEY:
    process.env.X_BULLETIN_API_KEY || fileEnv.X_BULLETIN_API_KEY || '',
  X_BULLETIN_API_SECRET:
    process.env.X_BULLETIN_API_SECRET || fileEnv.X_BULLETIN_API_SECRET || '',
  X_BULLETIN_ACCESS_TOKEN:
    process.env.X_BULLETIN_ACCESS_TOKEN ||
    fileEnv.X_BULLETIN_ACCESS_TOKEN ||
    '',
  X_BULLETIN_ACCESS_SECRET:
    process.env.X_BULLETIN_ACCESS_SECRET ||
    fileEnv.X_BULLETIN_ACCESS_SECRET ||
    '',
};

const IOS_JWT_SECRET =
  process.env.EL_IOS_JWT_SECRET ||
  fileEnv.EL_IOS_JWT_SECRET ||
  prodEnv.JWT_AUTH_SECRET_KEY ||
  '';
const IOS_JWT_TTL_DAYS = Math.max(
  1,
  Number(
    process.env.EL_IOS_JWT_TTL_DAYS ||
      fileEnv.EL_IOS_JWT_TTL_DAYS ||
      30
  )
);

const BREVO_CONFIGURED = Boolean(
  BREVO_API_KEY || (BREVO_SMTP_USER && BREVO_SMTP_PASS)
);
const SITE_URL = (
  process.env.SITE_URL ||
  fileEnv.SITE_URL ||
  ONESIGNAL_SITE_URL ||
  'https://electronlibre.info'
).replace(/\/+$/, '');
const COOKIE_SECURE =
  String(process.env.EL_COOKIE_SECURE || fileEnv.EL_COOKIE_SECURE || '') === '1';
const BILLING_CFG = loadBillingConfig(fileEnv);
const BREVO_CTX = {
  apiKey: BREVO_API_KEY,
  smtpUser: BREVO_SMTP_USER,
  smtpPass: BREVO_SMTP_PASS,
  dryRun: BREVO_DRY_RUN,
  fromEmail: BREVO_FROM_EMAIL,
  fromName: BREVO_FROM_NAME,
};
const MAX_BODY_BYTES = Math.max(
  64_000,
  Number(process.env.EL_MAX_BODY_BYTES || fileEnv.EL_MAX_BODY_BYTES || 2_000_000)
);
const DB = {
  host: process.env.EL_DB_HOST || fileEnv.EL_DB_HOST || 'localhost',
  user: process.env.EL_DB_USER || fileEnv.EL_DB_USER || '',
  password: process.env.EL_DB_PASSWORD || fileEnv.EL_DB_PASSWORD || '',
  database: process.env.EL_DB_NAME || fileEnv.EL_DB_NAME || 'electronlibre',
};

if (!RAG_KEY) {
  console.error('[api] RAG_API_KEY missing');
  process.exit(1);
}
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error('[api] EL_SESSION_SECRET missing or too short (>=32)');
  process.exit(1);
}
if (!DB.user) {
  console.error('[api] DB credentials missing');
  process.exit(1);
}

const pool = createPool(DB);

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlJson(obj) {
  return b64url(JSON.stringify(obj));
}

function sign(payloadB64) {
  return b64url(
    crypto.createHmac('sha256', SESSION_SECRET).update(payloadB64).digest()
  );
}

function cookieSuffix(maxAge) {
  let s = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
  if (COOKIE_SECURE) s += '; Secure';
  return s;
}

function makeSessionCookie(user) {
  const payload = b64urlJson({
    uid: user.id,
    login: user.login,
    name: user.display_name,
    role: normalizeRole(user.role),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
  });
  const sig = sign(payload);
  const value = `${payload}.${sig}`;
  return `${COOKIE_NAME}=${value}; ${cookieSuffix(SESSION_TTL_SEC)}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; ${cookieSuffix(0)}`;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (!k) continue;
    out[k] = rest.join('=');
  }
  return out;
}

function sigEqual(a, b) {
  try {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function readSession(req) {
  const raw = parseCookies(req)[COOKIE_NAME];
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig || !sigEqual(sign(payload), sig)) return null;
  try {
    const json = Buffer.from(
      payload.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    ).toString('utf8');
    const data = JSON.parse(json);
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

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
  if (hash.startsWith('$2y$') || hash.startsWith('$2a$') || hash.startsWith('$2b$')) {
    try {
      return bcrypt.compareSync(plain, toBcryptjsHash(hash));
    } catch {
      return false;
    }
  }
  return false;
}

function sendJson(res, status, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > limit) {
        done = true;
        const err = new Error('Payload trop volumineux');
        err.code = 'PAYLOAD_TOO_LARGE';
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!done) resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

async function findUser(loginOrEmail) {
  const id = normalizeLoginId(loginOrEmail);
  if (!id) return null;
  const [rows] = await pool.query(
    `SELECT id, login, email, display_name, password_hash, role, status, access_until, wp_role, source
     FROM el_users
     WHERE login = ? OR email = ?
     LIMIT 1`,
    [id, id]
  );
  return rows[0] || null;
}

async function findUserById(id) {
  const [rows] = await pool.query(
    `SELECT id, login, email, display_name, password_hash, role, status, access_until, wp_role, source
     FROM el_users
     WHERE id = ?
     LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

function authPayload(user) {
  const pub = publicUser(user);
  return {
    authenticated: true,
    user: pub,
    desk: pub.desk,
    entitled: pub.entitled,
  };
}

async function handleAuth(req, res, parts) {
  const action = parts[2];

  if (action === 'me' && req.method === 'GET') {
    const s = readSession(req);
    if (!s) return sendJson(res, 200, { authenticated: false, entitled: false });
    // Recharge DB : statut / expiration à jour (pas seulement le cookie)
    const user = await findUserById(s.uid);
    if (!user) {
      return sendJson(
        res,
        200,
        { authenticated: false, entitled: false },
        { 'Set-Cookie': clearSessionCookie() }
      );
    }
    if (String(user.status || '').toLowerCase() === STATUSES.DISABLED) {
      return sendJson(
        res,
        200,
        { authenticated: false, entitled: false, error: 'Compte désactivé' },
        { 'Set-Cookie': clearSessionCookie() }
      );
    }
    return sendJson(res, 200, authPayload(user));
  }

  if (action === 'logout' && req.method === 'POST') {
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
  }

  if (action === 'login' && req.method === 'POST') {
    const ip = clientIp(req);
    const lim = rateLimit(`login:${ip}`, { windowMs: 15 * 60_000, max: 20 });
    if (!lim.ok) {
      return sendJson(res, 429, {
        error: 'Trop de tentatives. Réessayez plus tard.',
        retryAfterSec: lim.retryAfterSec,
      });
    }
    let payload;
    try {
      payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    } catch {
      return sendJson(res, 400, { error: 'JSON invalide' });
    }
    const login = normalizeLoginId(payload.login);
    const password = String(payload.password || '');
    if (!login || !password) {
      return sendJson(res, 400, { error: 'Identifiant et mot de passe requis' });
    }
    const user = await findUser(login);
    if (!user || !verifyWpPassword(password, user.password_hash)) {
      return sendJson(res, 401, { error: 'Identifiants incorrects' });
    }
    if (String(user.status || '').toLowerCase() === STATUSES.DISABLED) {
      return sendJson(res, 403, { error: 'Compte désactivé' });
    }
    const pub = publicUser(user);
    return sendJson(
      res,
      200,
      {
        ok: true,
        user: pub,
        desk: pub.desk,
        entitled: pub.entitled,
      },
      { 'Set-Cookie': makeSessionCookie(user) }
    );
  }

  // POST /api/auth/forgot — demande de reset (login ou e-mail)
  if (action === 'forgot' && req.method === 'POST') {
    const ip = clientIp(req);
    const lim = rateLimit(`forgot:${ip}`, { windowMs: 15 * 60_000, max: 8 });
    if (!lim.ok) {
      return sendJson(res, 429, {
        error: 'Trop de demandes. Réessayez plus tard.',
        retryAfterSec: lim.retryAfterSec,
      });
    }
    let payload;
    try {
      payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    } catch {
      return sendJson(res, 400, { error: 'JSON invalide' });
    }
    try {
      await requestPasswordReset(
        pool,
        payload.login || payload.email,
        {
          apiKey: BREVO_API_KEY,
          smtpUser: BREVO_SMTP_USER,
          smtpPass: BREVO_SMTP_PASS,
          dryRun: BREVO_DRY_RUN,
          fromEmail: BREVO_FROM_EMAIL,
          fromName: BREVO_FROM_NAME,
        },
        SITE_URL
      );
    } catch (err) {
      if (err.code === 'INVALID_ID') {
        return sendJson(res, 400, { error: err.message });
      }
      console.error('[auth] forgot', err.message);
      return sendJson(res, 500, { error: 'Envoi impossible pour le moment' });
    }
    // Message volontairement générique
    return sendJson(res, 200, {
      ok: true,
      message:
        'Si un compte correspond, un e-mail de réinitialisation vient d’être envoyé. Vérifiez aussi vos spams.',
    });
  }

  // GET /api/auth/reset?token= — valide le jeton
  if (action === 'reset' && req.method === 'GET') {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const token = String(url.searchParams.get('token') || '');
    const user = await validateResetToken(pool, token);
    if (!user) {
      return sendJson(res, 400, { error: 'Lien invalide ou expiré', valid: false });
    }
    return sendJson(res, 200, {
      valid: true,
      login: user.login,
    });
  }

  // POST /api/auth/reset — nouveau mot de passe
  if (action === 'reset' && req.method === 'POST') {
    const ip = clientIp(req);
    const lim = rateLimit(`reset:${ip}`, { windowMs: 15 * 60_000, max: 10 });
    if (!lim.ok) {
      return sendJson(res, 429, {
        error: 'Trop de tentatives. Réessayez plus tard.',
        retryAfterSec: lim.retryAfterSec,
      });
    }
    let payload;
    try {
      payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    } catch {
      return sendJson(res, 400, { error: 'JSON invalide' });
    }
    try {
      const result = await resetPasswordWithToken(
        pool,
        payload.token,
        payload.password
      );
      await auditLog(pool, {
        actor: { uid: result.id, login: result.login },
        action: 'user.password_forgot_reset',
        targetType: 'user',
        targetId: result.id,
        meta: { via: 'email_token' },
        ip,
      }).catch(() => {});
      return sendJson(res, 200, {
        ok: true,
        message: 'Mot de passe mis à jour. Vous pouvez vous connecter.',
        login: result.login,
      });
    } catch (err) {
      const status =
        err.code === 'TOKEN_INVALID' || err.code === 'PASSWORD_WEAK' ? 400 : 500;
      return sendJson(res, status, {
        error: err.message || 'Échec de la réinitialisation',
      });
    }
  }

  return sendJson(res, 404, { error: 'Unknown auth route' });
}

function iosJwtCfg() {
  return {
    secret: IOS_JWT_SECRET,
    ttlDays: IOS_JWT_TTL_DAYS,
    iss: SITE_URL,
  };
}

/** Session + droits premium (cookie web OU Bearer iOS) via resolveAccess. */
async function loadEntitledSession(req) {
  const access = await resolveAccess(req, {
    pool,
    readSession,
    jwtCfg: iosJwtCfg(),
  });
  return toEntitledSession(access);
}

/** Session desk : rôle/status toujours lus en DB (jamais cookie seul). */
async function resolveDeskSession(req) {
  const s = readSession(req);
  if (!s) return null;
  const user = await findUserById(s.uid);
  if (!user) return null;
  if (String(user.status || '').toLowerCase() === STATUSES.DISABLED) return null;
  return {
    session: {
      uid: Number(user.id),
      login: user.login,
      name: user.display_name,
      role: normalizeRole(user.role),
      exp: s.exp,
    },
    user,
  };
}

async function handleContent(req, res, parts) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  const articleId = Number(parts[2]);
  if (!articleId) return sendJson(res, 400, { error: 'article_id invalide' });

  const [rows] = await pool.query(
    'SELECT access, body, draft FROM el_articles WHERE article_id = ? LIMIT 1',
    [articleId]
  );
  const row = rows[0];
  if (!row || row.draft) return sendJson(res, 404, { error: 'Article inconnu' });

  const headers = { 'X-EL-Content-Gen': String(getContentGen()) };

  if (row.access === 'granted') {
    return sendJson(
      res,
      200,
      { access: 'granted', html: row.body || '', contentGen: getContentGen() },
      headers
    );
  }

  const ent = await loadEntitledSession(req);
  if (!ent?.entitled) {
    return sendJson(
      res,
      401,
      {
        error: ent?.session
          ? 'Abonnement requis ou expiré'
          : 'Authentification requise',
        access: 'subscribers',
        entitled: false,
      },
      headers
    );
  }
  return sendJson(
    res,
    200,
    { access: 'subscribers', html: row.body || '', contentGen: getContentGen() },
    headers
  );
}

async function handleRag(req, res, parts) {
  const endpoint = parts[2];
  if (endpoint === 'health' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, upstream: UPSTREAM });
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  if (endpoint !== 'askWeb' && endpoint !== 'simple') {
    return sendJson(res, 404, { error: 'Unknown RAG endpoint' });
  }

  // Même principe que /api/content et les outils abonnés : entitled requis.
  const ent = await loadEntitledSession(req);
  if (!ent?.entitled) {
    return sendJson(res, 403, {
      error: ent?.session
        ? 'Abonnement requis ou expiré.'
        : 'Accès réservé aux abonnés ElectronLibre.',
      entitled: false,
    });
  }

  let bodyBuf;
  try {
    bodyBuf = await readBody(req);
  } catch {
    return sendJson(res, 400, { error: 'Invalid body' });
  }
  let payload;
  try {
    payload = JSON.parse(bodyBuf.toString('utf8') || '{}');
  } catch {
    return sendJson(res, 400, { error: 'JSON invalide' });
  }
  if (!payload.question || typeof payload.question !== 'string') {
    return sendJson(res, 400, { error: 'question requise' });
  }

  if (endpoint === 'simple') {
    const ip = clientIp(req);
    const lim = rateLimit(`rag-simple:${ip}`, { windowMs: 60_000, max: 30 });
    if (!lim.ok) {
      return sendJson(res, 429, {
        error: 'Trop de requêtes définitions. Réessayez dans un instant.',
        retryAfterSec: lim.retryAfterSec,
      });
    }
    const mode = String(payload.mode || 'definition');
    if (mode !== 'definition') {
      return sendJson(res, 400, { error: 'mode non autorisé' });
    }
    const articleB64 =
      typeof payload.article_b64 === 'string' ? payload.article_b64.trim() : '';
    if (!articleB64) {
      return sendJson(res, 400, {
        error: 'Contexte article requis pour la définition',
      });
    }
    const forward = {
      question: payload.question.trim(),
      article_b64: articleB64,
      mode: 'definition',
    };
    let upstreamRes;
    let lastFetchErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        upstreamRes = await fetch(`${UPSTREAM}/simple`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': RAG_KEY,
            Accept: 'application/json',
          },
          body: JSON.stringify(forward),
          signal: AbortSignal.timeout(120_000),
        });
        lastFetchErr = null;
        break;
      } catch (err) {
        lastFetchErr = err;
        console.error('[api] rag simple fetch', err.message, `attempt=${attempt + 1}`);
        if (attempt < 2) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    if (!upstreamRes) {
      return sendJson(res, 502, {
        error: 'Connexion RAG impossible',
        detail: lastFetchErr?.message || '',
      });
    }
    const text = await upstreamRes.text().catch(() => '');
    if (!upstreamRes.ok) {
      let detail = '';
      try {
        detail = JSON.parse(text)?.data?.message || JSON.parse(text)?.error || '';
      } catch {
        detail = text.slice(0, 200);
      }
      console.error('[api] rag simple upstream', upstreamRes.status, detail);
      return sendJson(res, 502, {
        error: detail || 'Réponse RAG invalide',
        status: upstreamRes.status,
      });
    }
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    return res.end(text);
  }

  try {
    const upstreamRes = await fetchAskWeb({
      upstream: UPSTREAM,
      apiKey: RAG_KEY,
      question: payload.question,
      language: payload.language,
      client: payload.client || 'web',
      inline_citations: payload.inline_citations,
    });
    await pipeSseToResponse(res, upstreamRes);
  } catch (err) {
    console.error('[api] rag fetch', err.message);
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
}

const MEDIA_ROOT = resolveMediaRoot(
  process.env.EL_MEDIA_ROOT || fileEnv.EL_MEDIA_ROOT || ''
);

const deskCtx = {
  pool,
  readSession,
  resolveDeskSession,
  sendJson,
  readBody,
  clientIp,
  mediaRoot: MEDIA_ROOT,
  deskIngestApiKey: DESK_INGEST_API_KEY,
  deeplApiKey: DEEPL_API_KEY,
  siteUrl: SITE_URL,
  ragUpstream: UPSTREAM,
  ragApiKey: RAG_KEY,
  brand: {
    name: process.env.DESK_BRAND_NAME || fileEnv.DESK_BRAND_NAME || 'ElectronLibre',
    product:
      process.env.DESK_BRAND_PRODUCT ||
      fileEnv.DESK_BRAND_PRODUCT ||
      'ElectronLibre',
    shortName:
      process.env.DESK_BRAND_SHORT || fileEnv.DESK_BRAND_SHORT || 'Pupitre EL',
  },
  agentEditorial: {
    url: AGENT_EDITORIAL_URL,
    apiKey: AGENT_API_KEY,
    profile:
      process.env.DESK_ASSIST_PROFILE ||
      fileEnv.DESK_ASSIST_PROFILE ||
      'electronlibre',
  },
  onesignal: {
    appId: ONESIGNAL_APP_ID,
    apiKey: ONESIGNAL_REST_API_KEY,
    siteUrl: ONESIGNAL_SITE_URL,
    dryRun: ONESIGNAL_DRY_RUN,
    title:
      process.env.DESK_BRAND_NAME || fileEnv.DESK_BRAND_NAME || 'ElectronLibre',
  },
  brevo: {
    apiKey: BREVO_API_KEY,
    smtpUser: BREVO_SMTP_USER,
    smtpPass: BREVO_SMTP_PASS,
    dryRun: BREVO_DRY_RUN,
    fromEmail: BREVO_FROM_EMAIL,
    fromName: BREVO_FROM_NAME,
  },
  goatcounter: {
    site: GOATCOUNTER_SITE,
    apiKey: GOATCOUNTER_API_KEY,
  },
  x: {
    dryRun: X_DRY_RUN,
    env: X_ENV,
  },
};

const startedAt = Date.now();

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/api/health')) {
      let dbOk = false;
      let articles = null;
      let users = null;
      try {
        await pool.query('SELECT 1');
        dbOk = true;
        const [[{ a }]] = await pool.query(
          'SELECT COUNT(*) AS a FROM el_articles WHERE draft = 0'
        );
        const [[{ u }]] = await pool.query('SELECT COUNT(*) AS u FROM el_users');
        articles = Number(a);
        users = Number(u);
        await ensureAuditTable(pool);
        await ensureNewsletterSchema(pool);
        await ensureMediaSchema(pool);
        await ensurePasswordResetSchema(pool);
        await ensureXPostsSchema(pool);
        await ensureBillingSchema(pool);
      } catch (err) {
        console.error('[api] health db', err.message);
      }
      return sendJson(res, dbOk ? 200 : 503, {
        ok: dbOk,
        contentGen: getContentGen(),
        deepl: Boolean(DEEPL_API_KEY),
        onesignal: Boolean(ONESIGNAL_REST_API_KEY && ONESIGNAL_APP_ID),
        onesignalDryRun: ONESIGNAL_DRY_RUN,
        brevo: BREVO_CONFIGURED,
        brevoDryRun: BREVO_DRY_RUN,
        goatcounter: Boolean(GOATCOUNTER_SITE && GOATCOUNTER_API_KEY),
        deskIngest: Boolean(DESK_INGEST_API_KEY),
        xPost: anyXAccountConfigured(X_ENV),
        xPostDryRun: X_DRY_RUN,
        iosApi: Boolean(IOS_JWT_SECRET && IOS_JWT_SECRET.length >= 16),
        billing: Boolean(BILLING_CFG.enabled),
        cookieSecure: COOKIE_SECURE,
        db: dbOk,
        articles,
        users,
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      });
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);

    if (parts[0] !== 'api') {
      return sendJson(res, 404, { error: 'Not found' });
    }

    if (parts[1] === 'auth') return handleAuth(req, res, parts);
    if (parts[1] === 'billing') {
      return handleBilling(req, res, parts, {
        pool,
        sendJson,
        readBody,
        readSession,
        billingCfg: BILLING_CFG,
        brevo: BREVO_CTX,
        siteUrl: SITE_URL,
      });
    }
    if (parts[1] === 'content') return handleContent(req, res, parts);
    if (parts[1] === 'desk') return handleDesk(req, res, parts, deskCtx);
    if (parts[1] === 'newsletter') {
      return handlePublicNewsletter(req, res, parts, {
        pool,
        sendJson,
        readBody,
      });
    }
    if (parts[1] === 'ios') {
      return handleIos(req, res, parts, {
        pool,
        sendJson,
        readBody,
        siteUrl: SITE_URL,
        jwt: { secret: IOS_JWT_SECRET, ttlDays: IOS_JWT_TTL_DAYS },
        rag: { upstream: UPSTREAM, apiKey: RAG_KEY },
      });
    }
    if (parts[1] === 'rag') return handleRag(req, res, parts);
    if (parts[1] === 'ops' && parts[2] === 'follow') {
      return handleOpsFollow(req, res, parts, {
        pool,
        sendJson,
        goatcounter: deskCtx.goatcounter,
      });
    }

    return sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    if (err?.code === 'PAYLOAD_TOO_LARGE') {
      return sendJson(res, 413, { error: 'Payload trop volumineux' });
    }
    console.error('[api] error', err);
    return sendJson(res, 500, { error: 'Erreur serveur' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `[api] listening on 127.0.0.1:${PORT} (desk + content MySQL)` +
      ` onesignalDryRun=${ONESIGNAL_DRY_RUN} brevoDryRun=${BREVO_DRY_RUN}` +
      ` billing=${BILLING_CFG.enabled ? 'on' : 'off'} cookieSecure=${COOKIE_SECURE}`
  );
});

export { pool, rowToArticle };
