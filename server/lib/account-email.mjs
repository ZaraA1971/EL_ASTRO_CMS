/**
 * E-mail de confirmation à la création d’un compte (tous rôles).
 */
import { sendBrevoEmail, brevoConfigured } from './brevo.mjs';
import { ROLES, normalizeRole } from './roles.mjs';

const ROLE_LABELS = Object.freeze({
  [ROLES.ADMIN]: 'administrateur',
  [ROLES.EDITOR]: 'éditeur',
  [ROLES.AUTHOR]: 'auteur',
  [ROLES.SUBSCRIBER]: 'abonné',
  [ROLES.OTHER]: 'compte',
});

export function roleLabelFr(role) {
  return ROLE_LABELS[normalizeRole(role)] || ROLE_LABELS[ROLES.OTHER];
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {object} opts
 * @param {object} opts.user
 * @param {object} opts.brevo
 * @param {string} opts.siteUrl
 * @param {string|null} [opts.resetToken] — si présent : CTA « choisir mon mot de passe »
 * @param {'stripe'|'desk'} [opts.source]
 */
export async function sendAccountCreatedEmail({
  user,
  brevo,
  siteUrl,
  resetToken = null,
  source = 'desk',
}) {
  if (!user?.email) return { ok: false, reason: 'no_email' };

  const base = String(siteUrl || '').replace(/\/+$/, '');
  const loginUrl = `${base}/login/`;
  const compteUrl = `${base}/compte/`;
  const deskUrl = `${base}/desk/`;
  const name = user.display_name || user.login;
  const login = user.login || user.email;
  const email = user.email || user.login;
  const role = normalizeRole(user.role);
  const roleFr = roleLabelFr(role);
  const isStaff =
    role === ROLES.ADMIN || role === ROLES.EDITOR || role === ROLES.AUTHOR;

  let intro;
  if (source === 'stripe') {
    intro =
      'Merci pour votre abonnement à <strong>ElectronLibre</strong>. Votre compte vient d’être créé.';
  } else if (isStaff) {
    intro = `Votre compte <strong>${escapeHtml(roleFr)}</strong> ElectronLibre vient d’être créé.`;
  } else if (role === ROLES.SUBSCRIBER) {
    intro =
      'Votre compte <strong>abonné</strong> ElectronLibre vient d’être créé.';
  } else {
    intro = 'Votre compte ElectronLibre vient d’être créé.';
  }

  let actionBlock;
  if (resetToken) {
    const resetUrl = `${base}/login/reset/?token=${encodeURIComponent(resetToken)}`;
    actionBlock = `<p>Choisissez votre mot de passe pour vous connecter&nbsp;:</p>
<p><a href="${resetUrl}" style="display:inline-block;padding:12px 18px;background:#2f6dfb;color:#fff;text-decoration:none;border-radius:8px">Choisir mon mot de passe</a></p>
<p style="font-size:14px;color:#64748b">Ce lien est valable 7 jours. Ensuite, utilisez « Mot de passe oublié » sur la page de connexion.</p>`;
  } else {
    actionBlock = `<p>Connectez-vous avec l’identifiant ci-dessus et le mot de passe qui vous a été communiqué&nbsp;:</p>
<p><a href="${loginUrl}" style="display:inline-block;padding:12px 18px;background:#2f6dfb;color:#fff;text-decoration:none;border-radius:8px">Se connecter</a></p>
<p style="font-size:14px;color:#64748b">Si vous n’avez pas encore de mot de passe, utilisez « Mot de passe oublié » sur la page de connexion.</p>`;
  }

  const spaceLine = isStaff
    ? `<p>Pupitre&nbsp;: <a href="${deskUrl}">${escapeHtml(deskUrl)}</a></p>`
    : role === ROLES.SUBSCRIBER
      ? `<p>Espace abonné&nbsp;: <a href="${compteUrl}">${escapeHtml(compteUrl)}</a></p>`
      : `<p>Connexion&nbsp;: <a href="${loginUrl}">${escapeHtml(loginUrl)}</a></p>`;

  const html = `<!DOCTYPE html><html lang="fr"><body style="font-family:Georgia,serif;color:#111;line-height:1.5">
<p>Bonjour ${escapeHtml(name)},</p>
<p>${intro}</p>
<p>Identifiant&nbsp;: <strong>${escapeHtml(login)}</strong><br>
E-mail&nbsp;: <strong>${escapeHtml(email)}</strong><br>
Type de compte&nbsp;: <strong>${escapeHtml(roleFr)}</strong></p>
${actionBlock}
${spaceLine}
<p>— ElectronLibre</p>
</body></html>`;

  const subject =
    source === 'stripe'
      ? 'ElectronLibre — Bienvenue, activez votre compte'
      : 'ElectronLibre — Confirmation de création de compte';

  const out = await sendBrevoEmail({
    apiKey: brevo?.apiKey,
    smtpUser: brevo?.smtpUser,
    smtpPass: brevo?.smtpPass,
    dryRun: brevo?.dryRun,
    fromEmail: brevo?.fromEmail,
    fromName: brevo?.fromName,
    toEmail: user.email,
    toName: name,
    subject,
    html,
    tags: ['el-account-created', `el-account-${source}`],
  });

  if (out.dryRun) {
    console.log(
      `[account-email] dry-run user=${login} role=${role} source=${source}`
    );
  }

  return {
    ok: Boolean(out.ok),
    dryRun: Boolean(out.dryRun),
    configured: brevoConfigured(brevo || {}),
  };
}
