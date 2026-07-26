/**
 * Résolution d’accès unifiée (cookie web OU Bearer iOS).
 * Les routes restent distinctes ; le cœur entitlement est partagé.
 */
import { canAccessPremium, STATUSES } from './roles.mjs';
import { findUserById } from './users-db.mjs';
import {
  bearerFromReq,
  iosJwtConfigured,
  userIdFromPayload,
  verifyIosJwt,
} from './ios/jwt.mjs';

export class AccessError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || (status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN');
  }
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {{ pool: any, readSession?: (req)=>any, jwtCfg?: { secret: string, ttlDays?: number, iss?: string } }} deps
 */
export async function resolveAccess(req, deps) {
  const { pool, readSession, jwtCfg } = deps;
  let bearerInvalid = false;

  const token = bearerFromReq(req);
  if (token) {
    if (!iosJwtConfigured(jwtCfg || {})) {
      bearerInvalid = true;
    } else {
      try {
        const payload = verifyIosJwt(token, jwtCfg);
        const user = await findUserById(pool, userIdFromPayload(payload));
        if (
          !user ||
          String(user.status || '').toLowerCase() === STATUSES.DISABLED
        ) {
          bearerInvalid = true;
        } else {
          return {
            auth: 'bearer',
            user,
            entitled: canAccessPremium(user),
            session: null,
            bearerInvalid: false,
          };
        }
      } catch {
        bearerInvalid = true;
      }
    }
  }

  if (typeof readSession === 'function') {
    const s = readSession(req);
    if (s?.uid) {
      const user = await findUserById(pool, s.uid);
      if (
        user &&
        String(user.status || '').toLowerCase() !== STATUSES.DISABLED
      ) {
        return {
          auth: 'cookie',
          user,
          entitled: canAccessPremium(user),
          session: s,
          bearerInvalid: false,
        };
      }
    }
  }

  return {
    auth: null,
    user: null,
    entitled: false,
    session: null,
    bearerInvalid,
  };
}

/** Exige un utilisateur authentifié (cookie ou Bearer valide). */
export function assertAuthenticated(access) {
  if (access?.bearerInvalid && !access?.user) {
    throw new AccessError(401, 'Invalid or expired token', 'JWT_INVALID');
  }
  if (!access?.user) {
    throw new AccessError(401, 'Authentification requise', 'UNAUTHORIZED');
  }
  return access;
}

/** Exige un abonnement / staff actif (canAccessPremium). */
export function assertEntitled(access) {
  assertAuthenticated(access);
  if (!access.entitled) {
    throw new AccessError(
      403,
      'Abonnement requis ou expiré.',
      'NOT_ENTITLED'
    );
  }
  return access;
}

/**
 * Compat web historique : { session, user, entitled } | null
 */
export function toEntitledSession(access) {
  if (!access?.user) return null;
  return {
    session: access.session || {
      uid: Number(access.user.id),
      login: access.user.login,
      name: access.user.display_name,
      role: access.user.role,
    },
    user: access.user,
    entitled: !!access.entitled,
  };
}
