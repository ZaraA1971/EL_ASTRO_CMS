/**
 * Réinitialisation mot de passe (token e-mail via Brevo).
 */
import crypto from 'node:crypto';
import { sendBrevoEmail, brevoConfigured } from './brevo.mjs';
import { hashUserPassword } from './users.mjs';
import { STATUSES } from './roles.mjs';

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 h

async function addColumnIfMissing(pool, column, ddl) {
  await pool
    .query(`ALTER TABLE el_users ADD COLUMN IF NOT EXISTS ${ddl}`)
    .catch(async () => {
      const [cols] = await pool.query(
        `SHOW COLUMNS FROM el_users LIKE ?`,
        [column]
      );
      if (!cols.length) {
        await pool.query(`ALTER TABLE el_users ADD COLUMN ${ddl}`);
      }
    });
}

export async function ensurePasswordResetSchema(pool) {
  await addColumnIfMissing(
    pool,
    'password_reset_token',
    'password_reset_token CHAR(64) NULL'
  );
  await addColumnIfMissing(
    pool,
    'password_reset_expires',
    'password_reset_expires DATETIME NULL'
  );
  try {
    await pool.query(
      `CREATE INDEX idx_password_reset_token ON el_users (password_reset_token)`
    );
  } catch {
    // index exists
  }
}

function toMysqlDate(d) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export function normalizeLoginId(raw) {
  return String(raw || '').trim().toLowerCase();
}

/**
 * Crée un token et envoie l’e-mail. Ne révèle pas si le compte existe.
 * @returns {{ ok: true, sent: boolean, dryRun?: boolean }}
 */
export async function requestPasswordReset(pool, loginOrEmail, brevo, siteUrl) {
  await ensurePasswordResetSchema(pool);
  const id = normalizeLoginId(loginOrEmail);
  if (!id || id.length < 3) {
    const err = new Error('Indiquez votre identifiant ou e-mail');
    err.code = 'INVALID_ID';
    throw err;
  }

  const [rows] = await pool.query(
    `SELECT id, login, email, display_name, status
     FROM el_users
     WHERE login = ? OR email = ?
     LIMIT 1`,
    [id, id]
  );
  const user = rows[0];

  // Réponse uniforme (anti-énumération)
  const generic = { ok: true, sent: false };

  if (!user || String(user.status || '').toLowerCase() === STATUSES.DISABLED) {
    return generic;
  }
  if (!user.email || !String(user.email).includes('@')) {
    return generic;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + TOKEN_TTL_MS);
  await pool.query(
    `UPDATE el_users
     SET password_reset_token = ?, password_reset_expires = ?
     WHERE id = ?`,
    [token, toMysqlDate(expires), user.id]
  );

  const base = String(siteUrl || '').replace(/\/+$/, '');
  const resetUrl = `${base}/login/reset/?token=${encodeURIComponent(token)}`;
  // (page auth sans header Compagnon — détection gestionnaires de MDP)
  const name = user.display_name || user.login;
  const html = `<!DOCTYPE html><html lang="fr"><body style="font-family:Georgia,serif;color:#111;line-height:1.5">
<p>Bonjour ${escapeHtml(name)},</p>
<p>Une demande de réinitialisation de mot de passe a été faite pour votre compte ElectronLibre (<strong>${escapeHtml(user.login)}</strong>).</p>
<p><a href="${resetUrl}" style="display:inline-block;padding:12px 18px;background:#2f6dfb;color:#fff;text-decoration:none;border-radius:8px">Choisir un nouveau mot de passe</a></p>
<p style="font-size:14px;color:#64748b">Ce lien expire dans une heure. Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail.</p>
<p style="font-size:13px;word-break:break-all">${escapeHtml(resetUrl)}</p>
<p>— ElectronLibre</p>
</body></html>`;

  const out = await sendBrevoEmail({
    apiKey: brevo?.apiKey,
    smtpUser: brevo?.smtpUser,
    smtpPass: brevo?.smtpPass,
    dryRun: brevo?.dryRun,
    fromEmail: brevo?.fromEmail,
    fromName: brevo?.fromName,
    toEmail: user.email,
    toName: name,
    subject: 'ElectronLibre — Réinitialisation du mot de passe',
    html,
    tags: ['el-password-reset'],
  });

  if (out.dryRun) {
    console.log(`[auth] password-reset dry-run user=${user.login} url=${resetUrl}`);
  }

  return {
    ok: true,
    sent: Boolean(out.ok),
    dryRun: Boolean(out.dryRun),
    configured: brevoConfigured(brevo || {}),
  };
}

export async function validateResetToken(pool, token) {
  await ensurePasswordResetSchema(pool);
  const t = String(token || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(t)) return null;
  const [rows] = await pool.query(
    `SELECT id, login, email, display_name, status, password_reset_expires
     FROM el_users
     WHERE password_reset_token = ?
     LIMIT 1`,
    [t]
  );
  const user = rows[0];
  if (!user) return null;
  if (String(user.status || '').toLowerCase() === STATUSES.DISABLED) return null;
  const exp = user.password_reset_expires
    ? new Date(user.password_reset_expires)
    : null;
  if (!exp || Number.isNaN(exp.getTime()) || exp.getTime() < Date.now()) {
    return null;
  }
  return user;
}

export async function resetPasswordWithToken(pool, token, newPassword) {
  const user = await validateResetToken(pool, token);
  if (!user) {
    const err = new Error('Lien invalide ou expiré');
    err.code = 'TOKEN_INVALID';
    throw err;
  }
  let hash;
  try {
    hash = hashUserPassword(newPassword);
  } catch (err) {
    err.code = err.code || 'PASSWORD_WEAK';
    throw err;
  }
  await pool.query(
    `UPDATE el_users
     SET password_hash = ?,
         password_reset_token = NULL,
         password_reset_expires = NULL
     WHERE id = ?`,
    [hash, user.id]
  );
  return { id: Number(user.id), login: user.login };
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
