/**
 * JWT HS256 pour l’app iOS — payload compatible plugin WP
 * { iss, iat, nbf, exp, isSubscriber, data: { user: { id } } }
 *
 * isSubscriber = éligibilité lecture abonné au moment de l’émission / refresh
 * (recalculée depuis le statut Pupitre courant ; pas un snapshot figé).
 */
import crypto from 'node:crypto';

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

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(
    String(str).replace(/-/g, '+').replace(/_/g, '/') + pad,
    'base64'
  ).toString('utf8');
}

export function iosJwtConfigured(cfg = {}) {
  return Boolean(cfg.secret && String(cfg.secret).length >= 16);
}

/**
 * Claim isSubscriber toujours présent (true|false), jamais omis.
 * true = accès contenus abonnés + IA au moment de l’émission.
 *
 * @param {number|string} userId
 * @param {{ secret: string, ttlDays?: number, iss?: string }} cfg
 * @param {{ isSubscriber?: boolean }} [opts]
 */
export function issueIosJwt(userId, cfg, opts = {}) {
  const secret = cfg.secret;
  const ttlDays = Math.max(1, Number(cfg.ttlDays) || 30);
  const iss = String(cfg.iss || 'https://electronlibre.info').replace(/\/+$/, '');
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ttlDays * 86400;
  // Coercion stricte : toujours un booléen JSON (jamais undefined / null).
  const isSubscriber = opts.isSubscriber === true;
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const body = b64urlJson({
    iss,
    iat,
    nbf: iat,
    exp,
    isSubscriber,
    data: { user: { id: Number(userId) } },
  });
  const sig = b64url(
    crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest()
  );
  return `${header}.${body}.${sig}`;
}

/** Lit le claim isSubscriber (défaut false si absent — tokens legacy). */
export function isSubscriberFromPayload(payload) {
  return payload?.isSubscriber === true;
}

export function verifyIosJwt(token, cfg) {
  if (!iosJwtConfigured(cfg)) {
    const err = new Error('JWT iOS non configuré');
    err.code = 'JWT_CONFIG';
    err.status = 503;
    throw err;
  }
  const parts = String(token || '').split('.');
  if (parts.length !== 3) {
    const err = new Error('Malformed token');
    err.code = 'JWT_INVALID';
    err.status = 401;
    throw err;
  }
  const [headerB64, payloadB64, sigB64] = parts;
  const expected = b64url(
    crypto
      .createHmac('sha256', cfg.secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest()
  );
  const a = Buffer.from(expected);
  const b = Buffer.from(sigB64);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const err = new Error('Signature verification failed');
    err.code = 'JWT_INVALID';
    err.status = 401;
    throw err;
  }
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64));
  } catch {
    const err = new Error('Malformed token');
    err.code = 'JWT_INVALID';
    err.status = 401;
    throw err;
  }
  if (!payload || typeof payload !== 'object') {
    const err = new Error('Malformed token');
    err.code = 'JWT_INVALID';
    err.status = 401;
    throw err;
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.nbf != null && Number(payload.nbf) > now + 30) {
    const err = new Error('Token not yet valid');
    err.code = 'JWT_INVALID';
    err.status = 401;
    throw err;
  }
  if (payload.exp && Number(payload.exp) < now) {
    const err = new Error('Expired token');
    err.code = 'JWT_EXPIRED';
    err.status = 401;
    throw err;
  }
  const expectedIss = String(cfg.iss || 'https://electronlibre.info').replace(
    /\/+$/,
    ''
  );
  const tokenIss = String(payload.iss || '').replace(/\/+$/, '');
  if (!tokenIss || tokenIss !== expectedIss) {
    const err = new Error('Invalid token issuer');
    err.code = 'JWT_INVALID';
    err.status = 401;
    throw err;
  }
  return payload;
}

export function userIdFromPayload(payload) {
  const id = payload?.data?.user?.id ?? payload?.sub;
  return Number(id) || 0;
}

export function bearerFromReq(req) {
  const auth = String(req.headers.authorization || '');
  const m = auth.match(/^Bearer\s+(\S+)/i);
  return m ? m[1] : '';
}
