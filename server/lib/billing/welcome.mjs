/**
 * E-mail de bienvenue après abonnement Stripe.
 */
import { sendBrevoEmail, brevoConfigured } from '../brevo.mjs';

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendWelcomeEmail({ user, resetToken, brevo, siteUrl }) {
  if (!user?.email) return { ok: false, reason: 'no_email' };
  const base = String(siteUrl || '').replace(/\/+$/, '');
  const resetUrl = `${base}/login/reset/?token=${encodeURIComponent(resetToken)}`;
  const compteUrl = `${base}/compte/`;
  const name = user.display_name || user.login;
  const html = `<!DOCTYPE html><html lang="fr"><body style="font-family:Georgia,serif;color:#111;line-height:1.5">
<p>Bonjour ${escapeHtml(name)},</p>
<p>Merci pour votre abonnement à <strong>ElectronLibre</strong>.</p>
<p>Votre compte est prêt. Pour vous connecter, utilisez votre e-mail
<strong>${escapeHtml(user.email || user.login)}</strong>
(ou votre identifiant s’il diffère).</p>
<p>Choisissez votre mot de passe pour vous connecter&nbsp;:</p>
<p><a href="${resetUrl}" style="display:inline-block;padding:12px 18px;background:#2f6dfb;color:#fff;text-decoration:none;border-radius:8px">Choisir mon mot de passe</a></p>
<p style="font-size:14px;color:#64748b">Ce lien est valable 7 jours. Ensuite, utilisez « Mot de passe oublié » sur la page de connexion.</p>
<p>Espace abonné&nbsp;: <a href="${compteUrl}">${escapeHtml(compteUrl)}</a></p>
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
    subject: 'ElectronLibre — Bienvenue, activez votre compte',
    html,
    tags: ['el-billing-welcome'],
  });

  if (out.dryRun) {
    console.log(
      `[billing] welcome dry-run user=${user.login} url=${resetUrl}`
    );
  }

  return {
    ok: Boolean(out.ok),
    dryRun: Boolean(out.dryRun),
    configured: brevoConfigured(brevo || {}),
  };
}
