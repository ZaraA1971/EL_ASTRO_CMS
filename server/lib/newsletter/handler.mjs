/**
 * Desk + public API newsletter.
 */
import {
  composeDailyNewsletter,
  injectUnsubscribe,
  todayYmdParis,
} from './daily.mjs';
import {
  DEFAULT_GROUPS,
  ensureUnsubToken,
  normalizeGroups,
  requireGroups,
  resolveNewsletterRecipients,
} from './recipients.mjs';
import { ensureNewsletterSchema } from './schema.mjs';
import { brevoConfigured, sendBrevoEmail } from '../brevo.mjs';
import { auditLog } from '../audit.mjs';
import { canPublish } from '../roles.mjs';
import { rateLimit, clientIp } from '../rate-limit.mjs';

function parseJson(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

/** readBody() renvoie un Buffer — toujours parser le JSON ici. */
async function parseRequestBody(readBody, req) {
  const raw = await readBody(req);
  if (raw == null) return {};
  if (typeof raw === 'object' && !Buffer.isBuffer(raw) && !Array.isArray(raw)) {
    return raw;
  }
  const text = Buffer.isBuffer(raw)
    ? raw.toString('utf8')
    : String(raw || '');
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    const err = new Error('JSON invalide');
    err.code = 'INVALID_JSON';
    throw err;
  }
}

function rowToCampaign(row) {
  return {
    id: Number(row.id),
    date: row.editorial_date
      ? String(row.editorial_date).slice(0, 10)
      : null,
    lang: row.lang,
    subject: row.subject,
    groups: parseJson(row.groups_json, []),
    status: row.status,
    articleIds: parseJson(row.article_ids_json, []),
    createdBy: row.created_by != null ? Number(row.created_by) : null,
    sentAt: row.sent_at,
    stats: parseJson(row.stats_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Routes desk : /api/desk/newsletter/*
 */
export async function handleDeskNewsletter(req, res, parts, ctx) {
  const { pool, sendJson, readBody, session, actor, ip, brevo, siteUrl } = ctx;

  if (!canPublish(session.role)) {
    return sendJson(res, 403, { error: 'Publication / newsletter réservée admin/editor' });
  }

  await ensureNewsletterSchema(pool);

  // GET /api/desk/newsletter
  if (!parts[3] && req.method === 'GET') {
    const [rows] = await pool.query(
      `SELECT id, editorial_date, lang, subject, groups_json, status,
              article_ids_json, created_by, sent_at, stats_json, created_at, updated_at
       FROM el_newsletters
       ORDER BY id DESC
       LIMIT 50`
    );
    return sendJson(res, 200, {
      newsletters: rows.map(rowToCampaign),
      defaultGroups: DEFAULT_GROUPS,
      brevoDryRun: Boolean(brevo?.dryRun),
      brevoConfigured: brevoConfigured(brevo || {}),
    });
  }

  // GET /api/desk/newsletter/preview?date=
  if (parts[3] === 'preview' && req.method === 'GET') {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const date = String(url.searchParams.get('date') || todayYmdParis()).trim();
    try {
      const composed = await composeDailyNewsletter(pool, { date, siteUrl });
      const groups = requireGroups(url.searchParams.get('groups'));
      const { counts, total } = await resolveNewsletterRecipients(pool, groups, {
        includeUsers: false,
      });
      return sendJson(res, 200, {
        ...composed,
        groups,
        recipientCounts: counts,
        recipientTotal: total,
        brevoDryRun: Boolean(brevo?.dryRun),
      });
    } catch (err) {
      return sendJson(res, 400, { error: err.message || 'preview_failed' });
    }
  }

  // GET /api/desk/newsletter/recipients?groups=
  if (parts[3] === 'recipients' && req.method === 'GET') {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    let groups;
    try {
      groups = requireGroups(url.searchParams.get('groups'));
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
    const { counts, total, users } = await resolveNewsletterRecipients(
      pool,
      groups,
      { includeUsers: true }
    );
    return sendJson(res, 200, {
      groups,
      counts,
      total,
      sample: users.slice(0, 8).map((u) => ({
        id: Number(u.id),
        email: u.email,
        name: u.display_name || u.login,
        role: u.role,
      })),
    });
  }

  // POST /api/desk/newsletter/draft
  if (parts[3] === 'draft' && req.method === 'POST') {
    let body;
    try {
      body = await parseRequestBody(readBody, req);
    } catch {
      return sendJson(res, 400, { error: 'JSON invalide' });
    }
    const date = String(body.date || todayYmdParis()).trim();
    let groups;
    try {
      groups = requireGroups(body.groups);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
    const composed = await composeDailyNewsletter(pool, { date, siteUrl });
    const [result] = await pool.query(
      `INSERT INTO el_newsletters
        (editorial_date, lang, subject, html, groups_json, status, article_ids_json, created_by)
       VALUES (?, 'fr', ?, ?, ?, 'draft', ?, ?)`,
      [
        composed.date,
        composed.subject,
        composed.html,
        JSON.stringify(groups),
        JSON.stringify(composed.articleIds),
        session.uid,
      ]
    );
    const id = Number(result.insertId);
    await auditLog(pool, {
      actor,
      action: 'newsletter.draft',
      targetType: 'newsletter',
      targetId: id,
      meta: { date: composed.date, groups },
      ip,
    });
    return sendJson(res, 201, {
      id,
      newsletter: {
        id,
        date: composed.date,
        subject: composed.subject,
        groups,
        status: 'draft',
        articleIds: composed.articleIds,
        counts: composed.counts,
      },
    });
  }

  const id = Number(parts[3]);
  if (!Number.isFinite(id) || id < 1) {
    return sendJson(res, 404, { error: 'Not found' });
  }

  // GET /api/desk/newsletter/:id
  if (!parts[4] && req.method === 'GET') {
    const [rows] = await pool.query(
      `SELECT * FROM el_newsletters WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!rows.length) return sendJson(res, 404, { error: 'Introuvable' });
    const camp = rowToCampaign(rows[0]);
    const [[{ n }]] = await pool.query(
      `SELECT COUNT(*) AS n FROM el_newsletter_recipients WHERE newsletter_id = ?`,
      [id]
    );
    return sendJson(res, 200, {
      newsletter: { ...camp, html: rows[0].html },
      recipientRows: Number(n),
    });
  }

  // POST /api/desk/newsletter/:id/send
  if (parts[4] === 'send' && req.method === 'POST') {
    const [rows] = await pool.query(
      `SELECT * FROM el_newsletters WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!rows.length) return sendJson(res, 404, { error: 'Introuvable' });
    const camp = rows[0];
    if (camp.status === 'sending') {
      return sendJson(res, 409, { error: 'Envoi déjà en cours' });
    }
    if (camp.status === 'sent') {
      return sendJson(res, 409, { error: 'Déjà envoyée' });
    }

    let body = {};
    try {
      body = await parseRequestBody(readBody, req);
    } catch {
      body = {};
    }
    let groups;
    try {
      // Corps explicite prioritaire ; sinon groupes enregistrés au draft — jamais DEFAULT_GROUPS.
      groups = requireGroups(
        body.groups != null &&
          !(Array.isArray(body.groups) && body.groups.length === 0)
          ? body.groups
          : parseJson(camp.groups_json, [])
      );
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }

    await pool.query(
      `UPDATE el_newsletters SET status = 'sending', groups_json = ? WHERE id = ?`,
      [JSON.stringify(groups), id]
    );

    const { users } = await resolveNewsletterRecipients(pool, groups, {
      includeUsers: true,
    });

    // Garde-fou : le total UI doit matcher le calcul serveur (évite envoi « tout le monde » par état obsolète)
    if (
      body.confirmTotal != null &&
      Number(body.confirmTotal) !== users.length
    ) {
      await pool.query(
        `UPDATE el_newsletters SET status = 'draft' WHERE id = ? AND status = 'sending'`,
        [id]
      );
      return sendJson(res, 409, {
        error: `Nombre de destinataires incohérent (UI ${body.confirmTotal} ≠ serveur ${users.length}). Régénérez l’aperçu puis renvoyez.`,
        expected: users.length,
        groups,
      });
    }

    // Purge previous pending rows if re-send after failed
    await pool.query(
      `DELETE FROM el_newsletter_recipients WHERE newsletter_id = ?`,
      [id]
    );

    let sent = 0;
    let skipped = 0;
    let errors = 0;

    for (const u of users) {
      const token = await ensureUnsubToken(pool, u);
      const unsubUrl = `${String(siteUrl).replace(/\/+$/, '')}/newsletter/unsubscribe/?token=${encodeURIComponent(token)}`;
      const html = injectUnsubscribe(camp.html, unsubUrl);

      const [ins] = await pool.query(
        `INSERT INTO el_newsletter_recipients
          (newsletter_id, user_id, email, result)
         VALUES (?, ?, ?, 'pending')`,
        [id, u.id, u.email]
      );
      const rid = Number(ins.insertId);

      const out = await sendBrevoEmail({
        apiKey: brevo?.apiKey,
        smtpUser: brevo?.smtpUser,
        smtpPass: brevo?.smtpPass,
        dryRun: brevo?.dryRun,
        fromEmail: brevo?.fromEmail,
        fromName: brevo?.fromName,
        toEmail: u.email,
        toName: u.display_name || u.login,
        subject: camp.subject,
        html,
        tags: ['el-newsletter', `nl-${id}`],
      });

      if (out.ok) {
        const result = out.dryRun ? 'skipped' : 'sent';
        if (out.dryRun) skipped += 1;
        else sent += 1;
        await pool.query(
          `UPDATE el_newsletter_recipients
           SET result = ?, brevo_message_id = ?, sent_at = NOW()
           WHERE id = ?`,
          [result, out.messageId || null, rid]
        );
      } else {
        errors += 1;
        await pool.query(
          `UPDATE el_newsletter_recipients
           SET result = 'error', error = ?
           WHERE id = ?`,
          [String(out.error || 'error').slice(0, 500), rid]
        );
      }

      // cadence légère
      await new Promise((r) => setTimeout(r, brevo?.dryRun ? 0 : 80));
    }

    const stats = {
      total: users.length,
      sent,
      skipped,
      errors,
      dryRun: Boolean(brevo?.dryRun),
      groups,
    };
    const finalStatus = errors && !sent && !skipped ? 'failed' : 'sent';
    await pool.query(
      `UPDATE el_newsletters
       SET status = ?, sent_at = NOW(), stats_json = ?
       WHERE id = ?`,
      [finalStatus, JSON.stringify(stats), id]
    );

    await auditLog(pool, {
      actor,
      action: 'newsletter.send',
      targetType: 'newsletter',
      targetId: id,
      meta: stats,
      ip,
    });

    return sendJson(res, 200, {
      ok: true,
      status: finalStatus,
      stats,
      brevoDryRun: Boolean(brevo?.dryRun),
    });
  }

  return sendJson(res, 405, { error: 'Method not allowed' });
}

/**
 * Public : POST /api/newsletter/unsubscribe { token }
 */
export async function handlePublicNewsletter(req, res, parts, ctx) {
  const { pool, sendJson, readBody } = ctx;
  await ensureNewsletterSchema(pool);

  if (parts[2] === 'unsubscribe' && req.method === 'POST') {
    const ip = clientIp(req);
    const lim = rateLimit(`nl-unsub:${ip}`, { windowMs: 15 * 60_000, max: 30 });
    if (!lim.ok) {
      return sendJson(res, 429, {
        error: 'Trop de requêtes',
        retryAfterSec: lim.retryAfterSec,
      });
    }
    let body;
    try {
      body = await parseRequestBody(readBody, req);
    } catch {
      return sendJson(res, 400, { error: 'JSON invalide' });
    }
    const token = String(body.token || '').trim();
    if (!/^[a-f0-9]{32}$/i.test(token)) {
      return sendJson(res, 400, { error: 'Jeton invalide' });
    }
    const [rows] = await pool.query(
      `SELECT id, email, newsletter_opt_in FROM el_users WHERE newsletter_unsub_token = ? LIMIT 1`,
      [token]
    );
    if (!rows.length) {
      return sendJson(res, 404, { error: 'Jeton inconnu' });
    }
    const user = rows[0];
    if (Number(user.newsletter_opt_in) === 1) {
      await pool.query(
        `UPDATE el_users SET newsletter_opt_in = 0 WHERE id = ?`,
        [user.id]
      );
      await auditLog(pool, {
        actor: { uid: user.id, login: user.email },
        action: 'newsletter.unsubscribe',
        targetType: 'user',
        targetId: user.id,
        ip,
      });
    }
    return sendJson(res, 200, { ok: true, unsubscribed: true });
  }

  if (parts[2] === 'unsubscribe' && req.method === 'GET') {
    // Convenience for smoke : validate token
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const token = String(url.searchParams.get('token') || '').trim();
    if (!/^[a-f0-9]{32}$/i.test(token)) {
      return sendJson(res, 400, { error: 'Jeton invalide' });
    }
    const [rows] = await pool.query(
      `SELECT id, newsletter_opt_in FROM el_users WHERE newsletter_unsub_token = ? LIMIT 1`,
      [token]
    );
    if (!rows.length) return sendJson(res, 404, { error: 'Jeton inconnu' });
    return sendJson(res, 200, {
      ok: true,
      optedIn: Number(rows[0].newsletter_opt_in) === 1,
    });
  }

  return sendJson(res, 404, { error: 'Not found' });
}
