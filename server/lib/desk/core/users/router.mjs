/**
 * CRUD comptes desk portable.
 *
 * Sécurité : le hash mot de passe, le modèle de rôles et les side-effects
 * (newsletter, mails, tokens reset) restent injectés par le host.
 *
 * ctx requis :
 *   pool, sendJson, readBody, session, actor, ip
 *   usersStore (createUsersStore)
 *   userPolicy : {
 *     canManageUsers, canMutateUser, allowedRolesForActor, isAdmin,
 *     normalizeRole, isStaffRole, sanitizeRole?, sanitizeStatus?,
 *     hashPassword, generateTempPassword, rowToDeskUser, effectiveStatus?,
 *     ROLES, STATUSES, adminRoles?,
 *     roleGroupFilters?,      // ex. { redacteurs: ['editor','author'] }
 *     hideFromNonAdminRoles?  // ex. ['admin','administrator']
 *   }
 *
 * ctx optionnel :
 *   auditLog
 *   afterUserCreate({ id, created, newsletterOptIn, payload }, ctx)
 *     → { emailSent?, adminEmailSent? }
 *   afterUserDelete({ userId, existing }, ctx)
 *     → { adminEmailSent? }
 */
import { parseJsonBody } from '../http.mjs';
import { nowMysql, toMysqlDate } from '../article-helpers.mjs';

function requirePolicy(policy) {
  const need = [
    'canManageUsers',
    'canMutateUser',
    'allowedRolesForActor',
    'isAdmin',
    'normalizeRole',
    'isStaffRole',
    'hashPassword',
    'generateTempPassword',
    'rowToDeskUser',
    'ROLES',
    'STATUSES',
  ];
  for (const k of need) {
    if (policy?.[k] == null) {
      throw new Error(`userPolicy.${k} requis`);
    }
  }
  return policy;
}

function defaultSanitizeStatus(status, STATUSES) {
  const s = String(status || STATUSES.ACTIVE).toLowerCase();
  if (![STATUSES.ACTIVE, STATUSES.DISABLED, STATUSES.EXPIRED].includes(s)) {
    return STATUSES.ACTIVE;
  }
  return s;
}

function defaultSanitizeRole(role, actorRole, policy) {
  const r = policy.normalizeRole(role);
  const allowed = new Set(policy.allowedRolesForActor(actorRole));
  if (!allowed.has(r)) {
    const err = new Error('Rôle non autorisé pour votre compte');
    err.code = 'ROLE_FORBIDDEN';
    throw err;
  }
  return r;
}

/**
 * @returns {Promise<boolean>}
 */
export async function handleCoreUsers(req, res, parts, ctx) {
  if (parts[2] !== 'users') return false;

  const {
    pool,
    sendJson,
    readBody,
    session,
    actor,
    ip,
    usersStore,
    auditLog,
    afterUserCreate,
    afterUserDelete,
  } = ctx;

  if (!usersStore?.list) {
    sendJson(res, 500, { error: 'Store users manquant' });
    return true;
  }

  let policy;
  try {
    policy = requirePolicy(ctx.userPolicy);
  } catch (err) {
    sendJson(res, 500, { error: err.message });
    return true;
  }

  const sanitizeStatus =
    policy.sanitizeStatus ||
    ((s) => defaultSanitizeStatus(s, policy.STATUSES));
  const sanitizeRole =
    policy.sanitizeRole ||
    ((role, actorRole) => defaultSanitizeRole(role, actorRole, policy));
  const { ROLES, STATUSES } = policy;

  if (!policy.canManageUsers(session.role)) {
    sendJson(res, 403, {
      error: 'Gestion des comptes réservée éditeur/admin',
    });
    return true;
  }

  // GET /api/desk/users
  if (!parts[3] && req.method === 'GET') {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const q = String(url.searchParams.get('q') || '').trim();
    const role = String(url.searchParams.get('role') || '').trim();
    const status = String(url.searchParams.get('status') || '').trim();
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit = Math.min(
      100,
      Math.max(1, Number(url.searchParams.get('limit') || 30))
    );

    const where = [];
    const params = [];
    if (q) {
      where.push('(login LIKE ? OR email LIKE ? OR display_name LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    const groupFilters = policy.roleGroupFilters || {
      redacteurs: ['editor', 'author'],
      redaction: ['editor', 'author'],
    };
    if (role && groupFilters[role]) {
      const roles = groupFilters[role];
      where.push(`role IN (${roles.map(() => '?').join(', ')})`);
      params.push(...roles);
    } else if (role) {
      where.push('role = ?');
      params.push(policy.normalizeRole(role));
    }
    if (status === 'inactive') {
      where.push("status IN ('disabled','expired')");
    } else if (status) {
      where.push('status = ?');
      params.push(sanitizeStatus(status));
    }
    if (!policy.isAdmin(session.role)) {
      const hide = policy.hideFromNonAdminRoles || [
        'admin',
        'administrator',
      ];
      where.push(`role NOT IN (${hide.map(() => '?').join(', ')})`);
      params.push(...hide);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = await usersStore.count(pool, whereSql, params);
    const pages = Math.max(1, Math.ceil(total / limit) || 1);
    const pageClamped = Math.min(page, pages);
    const offsetClamped = (pageClamped - 1) * limit;
    const rows = await usersStore.list(pool, whereSql, params, {
      limit,
      offset: offsetClamped,
    });

    sendJson(res, 200, {
      total,
      page: pageClamped,
      limit,
      pages,
      users: rows.map(policy.rowToDeskUser),
      meta: {
        roles: policy.allowedRolesForActor(session.role),
        statuses: [STATUSES.ACTIVE, STATUSES.DISABLED, STATUSES.EXPIRED],
      },
    });
    return true;
  }

  // POST /api/desk/users
  if (!parts[3] && req.method === 'POST') {
    const parsed = await parseJsonBody(req, readBody);
    if (!parsed.ok) {
      sendJson(res, 400, { error: 'JSON invalide' });
      return true;
    }
    const payload = parsed.value;

    const login = String(payload.login || '').trim().toLowerCase();
    const email = String(payload.email || '').trim().toLowerCase();
    const displayName = String(payload.display_name || login).trim() || login;
    if (!/^[a-z0-9._-]{3,60}$/.test(login)) {
      sendJson(res, 400, {
        error: 'Identifiant : 3–60 chars (a-z, 0-9, . _ -)',
      });
      return true;
    }
    if (!email || !email.includes('@')) {
      sendJson(res, 400, { error: 'Email invalide' });
      return true;
    }

    let role;
    try {
      role = sanitizeRole(payload.role || ROLES.SUBSCRIBER, session.role);
    } catch (err) {
      sendJson(res, 403, { error: err.message });
      return true;
    }
    const status = sanitizeStatus(payload.status);
    let passwordHash;
    try {
      passwordHash = policy.hashPassword(payload.password);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
      return true;
    }

    const dup = await usersStore.findDupLoginOrEmail(pool, login, email);
    if (dup) {
      sendJson(res, 409, { error: 'Identifiant ou email déjà utilisé' });
      return true;
    }

    const id = await usersStore.nextId(pool);
    const accessUntil = policy.isStaffRole(role)
      ? null
      : toMysqlDate(payload.access_until);
    const newsletterOptIn =
      payload.newsletter_opt_in === undefined ||
      payload.newsletter_opt_in === null
        ? 1
        : payload.newsletter_opt_in
          ? 1
          : 0;

    const created = await usersStore.insert(pool, {
      id,
      login,
      email,
      displayName,
      passwordHash,
      role,
      status,
      accessUntil,
      wpRole: null,
      source: 'desk',
      notes:
        payload.notes != null ? String(payload.notes).slice(0, 2000) : null,
      newsletterOptIn,
      registered: nowMysql(),
    });

    let emailSent = false;
    let adminEmailSent = false;
    if (typeof afterUserCreate === 'function') {
      try {
        const out = await afterUserCreate(
          { id, created, newsletterOptIn, payload },
          ctx
        );
        emailSent = Boolean(out?.emailSent);
        adminEmailSent = Boolean(out?.adminEmailSent);
      } catch (err) {
        console.error('[desk] afterUserCreate', err.message);
      }
    }

    if (typeof auditLog === 'function') {
      await auditLog(pool, {
        actor: actor || { uid: session.uid, login: session.login },
        action: 'user.create',
        targetType: 'user',
        targetId: id,
        meta: {
          login: created?.login || payload?.login,
          email: created?.email || payload?.email,
          role,
          status,
          emailSent,
          adminEmailSent,
        },
        ip,
      });
    }
    sendJson(res, 201, {
      user: policy.rowToDeskUser(created),
      emailSent,
      adminEmailSent,
    });
    return true;
  }

  const userId = Number(parts[3]);
  if (!userId) {
    sendJson(res, 400, { error: 'id invalide' });
    return true;
  }

  const existing = await usersStore.findById(pool, userId, {
    withPassword: true,
  });
  if (!existing) {
    sendJson(res, 404, { error: 'Compte inconnu' });
    return true;
  }

  if (!policy.canMutateUser(session.role, existing.role)) {
    sendJson(res, 403, { error: 'Pas le droit de modifier ce compte' });
    return true;
  }

  if (req.method === 'GET' && !parts[4]) {
    sendJson(res, 200, { user: policy.rowToDeskUser(existing) });
    return true;
  }

  // POST …/password — régénération one-shot (clair uniquement dans la réponse)
  if (parts[4] === 'password' && req.method === 'POST') {
    const plain = policy.generateTempPassword(14);
    let passwordHash;
    try {
      passwordHash = policy.hashPassword(plain);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
      return true;
    }
    const updated = await usersStore.updatePassword(pool, userId, passwordHash);
    if (typeof auditLog === 'function') {
      await auditLog(pool, {
        actor: actor || { uid: session.uid, login: session.login },
        action: 'user.password_reset',
        targetType: 'user',
        targetId: userId,
        meta: { login: existing.login },
        ip,
      });
    }
    sendJson(res, 200, {
      user: policy.rowToDeskUser(updated),
      password: plain,
      message:
        'Mot de passe régénéré — communiquez-le une seule fois à l’utilisateur',
    });
    return true;
  }

  if (req.method === 'DELETE' && !parts[4]) {
    if (Number(session.uid) === userId) {
      sendJson(res, 400, {
        error: 'Vous ne pouvez pas supprimer votre propre compte',
      });
      return true;
    }
    if (policy.normalizeRole(existing.role) === ROLES.ADMIN) {
      const n = await usersStore.countActiveAdmins(
        pool,
        policy.adminRoles || ['admin', 'administrator']
      );
      if (n <= 1) {
        sendJson(res, 400, {
          error: 'Impossible de supprimer le dernier administrateur actif',
        });
        return true;
      }
    }
    await usersStore.remove(pool, userId);

    let adminEmailSent = false;
    if (typeof afterUserDelete === 'function') {
      try {
        const out = await afterUserDelete({ userId, existing }, ctx);
        adminEmailSent = Boolean(out?.adminEmailSent);
      } catch (err) {
        console.error('[desk] afterUserDelete', err.message);
      }
    }

    if (typeof auditLog === 'function') {
      await auditLog(pool, {
        actor: actor || { uid: session.uid, login: session.login },
        action: 'user.delete',
        targetType: 'user',
        targetId: userId,
        meta: {
          login: existing.login,
          email: existing.email,
          role: policy.normalizeRole(existing.role),
          source: existing.source || null,
          adminEmailSent,
        },
        ip,
      });
    }
    sendJson(res, 200, {
      ok: true,
      deleted: userId,
      adminEmailSent,
    });
    return true;
  }

  if (req.method === 'PUT' && !parts[4]) {
    const parsed = await parseJsonBody(req, readBody);
    if (!parsed.ok) {
      sendJson(res, 400, { error: 'JSON invalide' });
      return true;
    }
    const payload = parsed.value;

    if (
      Number(session.uid) === userId &&
      payload.role != null &&
      policy.normalizeRole(payload.role) !== ROLES.ADMIN &&
      policy.isAdmin(session.role)
    ) {
      sendJson(res, 400, {
        error: 'Vous ne pouvez pas retirer votre propre rôle admin',
      });
      return true;
    }

    let role = policy.normalizeRole(existing.role);
    if (payload.role != null) {
      try {
        role = sanitizeRole(payload.role, session.role);
      } catch (err) {
        sendJson(res, 403, { error: err.message });
        return true;
      }
    }

    let login = existing.login;
    if (payload.login != null) {
      const nextLogin = String(payload.login || '').trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,60}$/.test(nextLogin)) {
        sendJson(res, 400, {
          error: 'Identifiant : 3–60 chars (a-z, 0-9, . _ -)',
        });
        return true;
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
    let accessUntil =
      payload.access_until !== undefined
        ? toMysqlDate(payload.access_until)
        : existing.access_until;
    if (policy.isStaffRole(role)) accessUntil = null;
    const notes =
      payload.notes !== undefined
        ? payload.notes == null
          ? null
          : String(payload.notes).slice(0, 2000)
        : existing.notes;
    const newsletterOptIn =
      payload.newsletter_opt_in !== undefined
        ? payload.newsletter_opt_in
          ? 1
          : 0
        : Number(existing.newsletter_opt_in) !== 0
          ? 1
          : 0;

    if (!email || !email.includes('@')) {
      sendJson(res, 400, { error: 'Email invalide' });
      return true;
    }

    const dup = await usersStore.findDupLoginOrEmail(
      pool,
      login,
      email,
      userId
    );
    if (dup) {
      sendJson(res, 409, { error: 'Identifiant ou email déjà utilisé' });
      return true;
    }

    let passwordHash = existing.password_hash;
    if (payload.password) {
      try {
        passwordHash = policy.hashPassword(payload.password);
      } catch (err) {
        sendJson(res, 400, { error: err.message });
        return true;
      }
    }

    const updated = await usersStore.update(pool, userId, {
      login,
      email,
      displayName,
      passwordHash,
      role,
      status,
      accessUntil,
      notes,
      newsletterOptIn,
    });

    if (typeof auditLog === 'function') {
      await auditLog(pool, {
        actor: actor || { uid: session.uid, login: session.login },
        action: 'user.update',
        targetType: 'user',
        targetId: userId,
        meta: {
          login,
          email,
          role,
          status,
          passwordChanged: Boolean(payload.password),
          loginChanged: login !== existing.login,
          prevRole: policy.normalizeRole(existing.role),
          prevStatus: existing.status,
          newsletter_opt_in: newsletterOptIn,
        },
        ip,
      });
    }
    sendJson(res, 200, {
      user: policy.rowToDeskUser(updated),
      effective_status: policy.effectiveStatus
        ? policy.effectiveStatus(updated)
        : updated.status,
    });
    return true;
  }

  sendJson(res, 405, { error: 'Méthode non autorisée' });
  return true;
}
