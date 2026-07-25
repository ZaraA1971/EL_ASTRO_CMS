import crypto from 'node:crypto';
import wordpressHash from 'wordpress-hash-node';
import {
  ROLES,
  STATUSES,
  canEditAll,
  normalizeRole,
  publicUser,
  effectiveStatus,
} from './roles.mjs';
import { auditLog } from './audit.mjs';

const hashPassword =
  wordpressHash.HashPassword || wordpressHash.hashPassword;

const STAFF_ROLES = new Set([ROLES.ADMIN, ROLES.EDITOR]);

const USER_SELECT = `id, login, email, display_name, role, status, access_until,
            wp_role, source, notes, newsletter_opt_in, registered, updated_at`;

/** Mot de passe lisible one-shot (jamais stocké en clair). */
export function generateTempPassword(length = 14) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function canManageUsers(role) {
  return canEditAll(role);
}

export function isAdmin(role) {
  return normalizeRole(role) === ROLES.ADMIN;
}

/** Qui peut modifier la cible selon le rôle de l’opérateur. */
export function canMutateUser(actorRole, targetRole) {
  if (!canManageUsers(actorRole)) return false;
  const target = normalizeRole(targetRole);
  if (STAFF_ROLES.has(target) && !isAdmin(actorRole)) return false;
  return true;
}

export function allowedRolesForActor(actorRole) {
  if (isAdmin(actorRole)) {
    return [ROLES.ADMIN, ROLES.EDITOR, ROLES.AUTHOR, ROLES.SUBSCRIBER, ROLES.OTHER];
  }
  // Éditeur : abonnés + autres (+ author si besoin rédactionnel)
  return [ROLES.AUTHOR, ROLES.SUBSCRIBER, ROLES.OTHER];
}

export function rowToDeskUser(row) {
  if (!row) return null;
  const pub = publicUser(row);
  return {
    ...pub,
    notes: row.notes || '',
    wp_role: row.wp_role || null,
    source: row.source || 'wp',
    newsletter_opt_in: Number(row.newsletter_opt_in) !== 0,
    registered: row.registered || null,
    updated_at: row.updated_at || null,
  };
}

export function hashUserPassword(plain) {
  if (!plain || String(plain).length < 8) {
    const err = new Error('Mot de passe : 8 caractères minimum');
    err.code = 'PASSWORD_WEAK';
    throw err;
  }
  if (typeof hashPassword !== 'function') {
    const err = new Error('Hash password indisponible');
    err.code = 'PASSWORD_HASH';
    throw err;
  }
  return hashPassword(String(plain));
}

function toMysqlDate(v) {
  if (v === null || v === '') return null;
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function nowMysql() {
  return toMysqlDate(new Date());
}

async function nextUserId(pool) {
  const [[row]] = await pool.query(
    'SELECT COALESCE(MAX(id), 900000) + 1 AS next_id FROM el_users'
  );
  return Math.max(900001, Number(row.next_id));
}

function sanitizeRole(role, actorRole) {
  const r = normalizeRole(role);
  const allowed = new Set(allowedRolesForActor(actorRole));
  if (!allowed.has(r)) {
    const err = new Error('Rôle non autorisé pour votre compte');
    err.code = 'ROLE_FORBIDDEN';
    throw err;
  }
  return r;
}

function sanitizeStatus(status) {
  const s = String(status || STATUSES.ACTIVE).toLowerCase();
  if (![STATUSES.ACTIVE, STATUSES.DISABLED, STATUSES.EXPIRED].includes(s)) {
    return STATUSES.ACTIVE;
  }
  return s;
}

/**
 * Routes /api/desk/users[/:id]
 */
export async function handleDeskUsers(req, res, parts, ctx) {
  const { pool, sendJson, readBody, session, actor, ip } = ctx;

  if (!canManageUsers(session.role)) {
    return sendJson(res, 403, { error: 'Gestion des comptes réservée éditeur/admin' });
  }

  // GET /api/desk/users
  if (!parts[3] && req.method === 'GET') {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const q = String(url.searchParams.get('q') || '').trim();
    const role = String(url.searchParams.get('role') || '').trim();
    const status = String(url.searchParams.get('status') || '').trim();
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 30)));
    const offset = (page - 1) * limit;

    const where = [];
    const params = [];
    if (q) {
      where.push('(login LIKE ? OR email LIKE ? OR display_name LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    if (role === 'redacteurs' || role === 'redaction') {
      where.push("role IN ('editor','author')");
    } else if (role) {
      where.push('role = ?');
      params.push(normalizeRole(role));
    }
    if (status === 'inactive') {
      where.push("status IN ('disabled','expired')");
    } else if (status) {
      where.push('status = ?');
      params.push(sanitizeStatus(status));
    }
    // Éditeur : ne voit pas les admin (évite la confusion)
    if (!isAdmin(session.role)) {
      where.push("role NOT IN ('admin','administrator')");
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM el_users ${whereSql}`,
      params
    );
    const [rows] = await pool.query(
      `SELECT ${USER_SELECT}
       FROM el_users ${whereSql}
       ORDER BY COALESCE(updated_at, registered) DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return sendJson(res, 200, {
      total: Number(total),
      page,
      limit,
      users: rows.map(rowToDeskUser),
      meta: {
        roles: allowedRolesForActor(session.role),
        statuses: [STATUSES.ACTIVE, STATUSES.DISABLED, STATUSES.EXPIRED],
      },
    });
  }

  // POST /api/desk/users — créer
  if (!parts[3] && req.method === 'POST') {
    let payload;
    try {
      payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    } catch {
      return sendJson(res, 400, { error: 'JSON invalide' });
    }

    const login = String(payload.login || '').trim().toLowerCase();
    const email = String(payload.email || '').trim().toLowerCase();
    const displayName = String(payload.display_name || login).trim() || login;
    if (!/^[a-z0-9._-]{3,60}$/.test(login)) {
      return sendJson(res, 400, {
        error: 'Identifiant : 3–60 chars (a-z, 0-9, . _ -)',
      });
    }
    if (!email || !email.includes('@')) {
      return sendJson(res, 400, { error: 'Email invalide' });
    }

    let role;
    try {
      role = sanitizeRole(payload.role || ROLES.SUBSCRIBER, session.role);
    } catch (err) {
      return sendJson(res, 403, { error: err.message });
    }
    const status = sanitizeStatus(payload.status);
    let passwordHash;
    try {
      passwordHash = hashUserPassword(payload.password);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }

    const [[dup]] = await pool.query(
      'SELECT id FROM el_users WHERE login = ? OR email = ? LIMIT 1',
      [login, email]
    );
    if (dup) {
      return sendJson(res, 409, { error: 'Identifiant ou email déjà utilisé' });
    }

    const id = await nextUserId(pool);
    const accessUntil = toMysqlDate(payload.access_until);
    const newsletterOptIn =
      payload.newsletter_opt_in === undefined || payload.newsletter_opt_in === null
        ? 1
        : payload.newsletter_opt_in ? 1 : 0;
    await pool.query(
      `INSERT INTO el_users (
        id, login, email, display_name, password_hash,
        role, status, access_until, wp_role, source, notes,
        newsletter_opt_in, registered
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        login,
        email,
        displayName,
        passwordHash,
        role,
        status,
        accessUntil,
        null,
        'desk',
        payload.notes != null ? String(payload.notes).slice(0, 2000) : null,
        newsletterOptIn,
        nowMysql(),
      ]
    );
    const [rows] = await pool.query(
      `SELECT ${USER_SELECT} FROM el_users WHERE id = ?`,
      [id]
    );
    await auditLog(pool, {
      actor: actor || { uid: session.uid, login: session.login },
      action: 'user.create',
      targetType: 'user',
      targetId: id,
      meta: { role, status },
      ip,
    });
    return sendJson(res, 201, { user: rowToDeskUser(rows[0]) });
  }

  const userId = Number(parts[3]);
  if (!userId) return sendJson(res, 400, { error: 'id invalide' });

  const [existingRows] = await pool.query(
    `SELECT ${USER_SELECT}, password_hash
     FROM el_users WHERE id = ? LIMIT 1`,
    [userId]
  );
  const existing = existingRows[0];
  if (!existing) return sendJson(res, 404, { error: 'Compte inconnu' });

  if (!canMutateUser(session.role, existing.role)) {
    return sendJson(res, 403, { error: 'Pas le droit de modifier ce compte' });
  }

  // GET /api/desk/users/:id
  if (req.method === 'GET' && !parts[4]) {
    return sendJson(res, 200, { user: rowToDeskUser(existing) });
  }

  // POST /api/desk/users/:id/password — régénérer (one-shot, clair dans la réponse)
  if (parts[4] === 'password' && req.method === 'POST') {
    const plain = generateTempPassword(14);
    let passwordHash;
    try {
      passwordHash = hashUserPassword(plain);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
    await pool.query(`UPDATE el_users SET password_hash = ? WHERE id = ?`, [
      passwordHash,
      userId,
    ]);
    await auditLog(pool, {
      actor: actor || { uid: session.uid, login: session.login },
      action: 'user.password_reset',
      targetType: 'user',
      targetId: userId,
      meta: { login: existing.login },
      ip,
    });
    const [rows] = await pool.query(
      `SELECT ${USER_SELECT} FROM el_users WHERE id = ?`,
      [userId]
    );
    return sendJson(res, 200, {
      user: rowToDeskUser(rows[0]),
      password: plain,
      message: 'Mot de passe régénéré — communiquez-le une seule fois à l’utilisateur',
    });
  }

  // DELETE /api/desk/users/:id
  if (req.method === 'DELETE' && !parts[4]) {
    if (Number(session.uid) === userId) {
      return sendJson(res, 400, { error: 'Vous ne pouvez pas supprimer votre propre compte' });
    }
    if (normalizeRole(existing.role) === ROLES.ADMIN) {
      const [[{ n }]] = await pool.query(
        `SELECT COUNT(*) AS n FROM el_users
         WHERE role IN ('admin','administrator') AND status = 'active'`
      );
      if (Number(n) <= 1) {
        return sendJson(res, 400, {
          error: 'Impossible de supprimer le dernier administrateur actif',
        });
      }
    }
    await pool.query('DELETE FROM el_users WHERE id = ?', [userId]);
    await auditLog(pool, {
      actor: actor || { uid: session.uid, login: session.login },
      action: 'user.delete',
      targetType: 'user',
      targetId: userId,
      meta: {
        login: existing.login,
        email: existing.email,
        role: normalizeRole(existing.role),
        source: existing.source || null,
      },
      ip,
    });
    return sendJson(res, 200, { ok: true, deleted: userId });
  }

  // PUT /api/desk/users/:id
  if (req.method === 'PUT' && !parts[4]) {
    let payload;
    try {
      payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    } catch {
      return sendJson(res, 400, { error: 'JSON invalide' });
    }

    // Empêcher de se retirer les droits admin soi-même par erreur
    if (
      Number(session.uid) === userId &&
      payload.role != null &&
      normalizeRole(payload.role) !== ROLES.ADMIN &&
      isAdmin(session.role)
    ) {
      return sendJson(res, 400, {
        error: 'Vous ne pouvez pas retirer votre propre rôle admin',
      });
    }

    let role = normalizeRole(existing.role);
    if (payload.role != null) {
      try {
        role = sanitizeRole(payload.role, session.role);
      } catch (err) {
        return sendJson(res, 403, { error: err.message });
      }
    }

    let login = existing.login;
    if (payload.login != null) {
      const nextLogin = String(payload.login || '').trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,60}$/.test(nextLogin)) {
        return sendJson(res, 400, {
          error: 'Identifiant : 3–60 chars (a-z, 0-9, . _ -)',
        });
      }
      login = nextLogin;
    }

    const email =
      payload.email != null
        ? String(payload.email).trim().toLowerCase()
        : existing.email;
    const displayName =
      payload.display_name != null
        ? String(payload.display_name).trim() || existing.display_name
        : existing.display_name;
    const status =
      payload.status != null
        ? sanitizeStatus(payload.status)
        : sanitizeStatus(existing.status);
    const accessUntil =
      payload.access_until !== undefined
        ? toMysqlDate(payload.access_until)
        : existing.access_until;
    const notes =
      payload.notes !== undefined
        ? payload.notes == null
          ? null
          : String(payload.notes).slice(0, 2000)
        : existing.notes;
    const newsletterOptIn =
      payload.newsletter_opt_in !== undefined
        ? payload.newsletter_opt_in ? 1 : 0
        : Number(existing.newsletter_opt_in) !== 0
          ? 1
          : 0;

    if (!email || !email.includes('@')) {
      return sendJson(res, 400, { error: 'Email invalide' });
    }

    const [[dup]] = await pool.query(
      'SELECT id FROM el_users WHERE (email = ? OR login = ?) AND id != ? LIMIT 1',
      [email, login, userId]
    );
    if (dup) {
      return sendJson(res, 409, { error: 'Identifiant ou email déjà utilisé' });
    }

    let passwordHash = existing.password_hash;
    if (payload.password) {
      try {
        passwordHash = hashUserPassword(payload.password);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    await pool.query(
      `UPDATE el_users SET
        login=?, email=?, display_name=?, password_hash=?,
        role=?, status=?, access_until=?, notes=?, newsletter_opt_in=?
       WHERE id=?`,
      [
        login,
        email,
        displayName,
        passwordHash,
        role,
        status,
        accessUntil,
        notes,
        newsletterOptIn,
        userId,
      ]
    );

    const [rows] = await pool.query(
      `SELECT ${USER_SELECT} FROM el_users WHERE id = ?`,
      [userId]
    );
    await auditLog(pool, {
      actor: actor || { uid: session.uid, login: session.login },
      action: 'user.update',
      targetType: 'user',
      targetId: userId,
      meta: {
        role,
        status,
        passwordChanged: Boolean(payload.password),
        loginChanged: login !== existing.login,
        prevRole: normalizeRole(existing.role),
        prevStatus: existing.status,
        newsletter_opt_in: newsletterOptIn,
      },
      ip,
    });
    return sendJson(res, 200, {
      user: rowToDeskUser(rows[0]),
      effective_status: effectiveStatus(rows[0]),
    });
  }

  return sendJson(res, 405, { error: 'Method not allowed' });
}
