/**
 * Suivi ops pour Vigie (incident-hub) — localhost only.
 * GET /api/ops/follow/audience
 * GET /api/ops/follow/accounts
 * POST /api/ops/follow/audience/refresh
 */
import { buildAudiencePayload } from '../audience/handler.mjs';
import { flushAudienceCache, goatcounterConfigured } from '../goatcounter.mjs';
import { ensureAuditTable } from '../audit.mjs';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

function clientAddr(req) {
  const raw =
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    '';
  return String(raw).replace(/^::ffff:/, '');
}

function assertLoopback(req, res, sendJson) {
  const addr = clientAddr(req);
  if (LOOPBACK.has(addr) || addr === '127.0.0.1' || addr === '::1') {
    return true;
  }
  sendJson(res, 403, { ok: false, error: 'ops follow: localhost only' });
  return false;
}

function summarizeAudience(payload) {
  if (!payload) {
    return { ok: false, error: 'payload vide' };
  }
  const k = payload.kpis || {};
  const top = Array.isArray(payload.top) ? payload.top.slice(0, 8) : [];
  const refs = Array.isArray(payload.referrers)
    ? payload.referrers.slice(0, 6)
    : [];
  return {
    ok: Boolean(payload.ok),
    configured: Boolean(payload.configured),
    error: payload.error || null,
    start: payload.start || null,
    fetchedAt: payload.fetchedAt || null,
    kpis: {
      views7: k.views7 ?? null,
      views30: k.views30 ?? null,
      concentrationPct: k.concentrationPct ?? null,
    },
    top: top.map((r) => ({
      title: r.title || '(sans titre)',
      views: r.views ?? 0,
      href: r.href || null,
      draft: r.draft,
    })),
    referrers: refs.map((r) => ({
      name: r.label || r.name || r.ref || '?',
      views: r.count ?? r.views ?? 0,
      pct: r.pct ?? null,
    })),
  };
}

const ACCOUNT_ACTIONS = [
  'user.create',
  'user.update',
  'user.delete',
  'user.password_regenerate',
  'user.password_forgot_reset',
];

function actionLabelFr(action) {
  const map = {
    'user.create': 'création de compte',
    'user.update': 'modification de compte',
    'user.delete': 'suppression de compte',
    'user.password_regenerate': 'mot de passe régénéré (pupitre)',
    'user.password_forgot_reset': 'mot de passe réinitialisé',
  };
  return map[action] || action;
}

async function buildAccountsPayload(pool, { days = 14, limit = 40 } = {}) {
  await ensureAuditTable(pool);
  const d = Math.max(1, Math.min(90, Number(days) || 14));
  const lim = Math.max(1, Math.min(100, Number(limit) || 40));
  const [rows] = await pool.query(
    `SELECT id, at, actor_login, action, target_type, target_id, meta
     FROM el_audit_log
     WHERE action IN (?)
       AND at >= (NOW() - INTERVAL ? DAY)
     ORDER BY at DESC
     LIMIT ?`,
    [ACCOUNT_ACTIONS, d, lim]
  );

  const events = (rows || []).map((r) => {
    let meta = r.meta;
    if (typeof meta === 'string') {
      try {
        meta = JSON.parse(meta);
      } catch {
        meta = null;
      }
    }
    const role =
      meta && typeof meta === 'object' ? meta.role || meta.newRole || null : null;
    const status =
      meta && typeof meta === 'object' ? meta.status || null : null;
    const source =
      meta && typeof meta === 'object'
        ? meta.source === 'stripe'
          ? 'abonnement'
          : meta.source || null
        : null;
    return {
      at: r.at instanceof Date ? r.at.toISOString() : String(r.at || ''),
      action: r.action,
      actionLabel: actionLabelFr(r.action),
      actor: r.actor_login || 'système',
      targetType: r.target_type || null,
      targetId: r.target_id != null ? String(r.target_id) : null,
      role: role || null,
      status: status || null,
      source: source || (r.action.startsWith('user.') ? 'pupitre' : null),
    };
  });

  const counts = {};
  for (const e of events) {
    counts[e.action] = (counts[e.action] || 0) + 1;
  }

  return {
    ok: true,
    days: d,
    fetchedAt: new Date().toISOString(),
    count: events.length,
    counts,
    events,
  };
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string[]} parts — ['api','ops','follow', ...]
 */
export async function handleOpsFollow(req, res, parts, ctx) {
  const { pool, sendJson, goatcounter } = ctx;

  if (!assertLoopback(req, res, sendJson)) return true;

  // parts: api ops follow [audience|accounts] [refresh]
  const resource = parts[3];
  const sub = parts[4];

  if (resource === 'audience') {
    if (!goatcounterConfigured(goatcounter || {})) {
      sendJson(res, 503, {
        ok: false,
        configured: false,
        error: 'GoatCounter non configuré',
      });
      return true;
    }
    if (sub === 'refresh' && req.method === 'POST') {
      flushAudienceCache();
      const payload = await buildAudiencePayload(pool, goatcounter);
      sendJson(res, payload.ok ? 200 : 502, summarizeAudience(payload));
      return true;
    }
    if (!sub && req.method === 'GET') {
      const payload = await buildAudiencePayload(pool, goatcounter);
      sendJson(res, payload.ok ? 200 : 502, summarizeAudience(payload));
      return true;
    }
  }

  if (resource === 'accounts' && !sub && req.method === 'GET') {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const days = Number(url.searchParams.get('days') || 14);
    const limit = Number(url.searchParams.get('limit') || 40);
    const payload = await buildAccountsPayload(pool, { days, limit });
    sendJson(res, 200, payload);
    return true;
  }

  sendJson(res, 404, { ok: false, error: 'Not found' });
  return true;
}
