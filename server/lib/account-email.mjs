/**
 * E-mails liés aux comptes :
 * - confirmation au titulaire (création)
 * - notification aux administrateurs (création / suppression)
 */
import { sendBrevoEmail, brevoConfigured } from './brevo.mjs';
import { ROLES, STATUSES, normalizeRole } from './roles.mjs';
import {
  CONTACT_EMAIL,
  EL_EMAIL_TOKENS,
  escapeHtml,
  renderElEmail,
} from './email/brand.mjs';

export { IOS_APP_STORE_URL, escapeHtml, renderElEmail } from './email/brand.mjs';

const ROLE_LABELS = Object.freeze({
  [ROLES.ADMIN]: 'administrateur',
  [ROLES.EDITOR]: 'éditeur',
  [ROLES.AUTHOR]: 'auteur',
  [ROLES.SUBSCRIBER]: 'abonné',
  [ROLES.OTHER]: 'compte',
});

const T = EL_EMAIL_TOKENS;

export function roleLabelFr(role) {
  return ROLE_LABELS[normalizeRole(role)] || ROLE_LABELS[ROLES.OTHER];
}

function sourceLabelFr(source) {
  return source === 'stripe' ? 'abonnement Stripe' : 'Pupitre';
}

function userFields(user) {
  return {
    name: user.display_name || user.name || user.login || '—',
    login: user.login || user.email || '—',
    email: user.email || '—',
    role: normalizeRole(user.role),
    roleFr: roleLabelFr(user.role),
  };
}

function detailsCard({ login, email, roleFr, heading = 'Compte' }) {
  const loginNorm = String(login || '')
    .trim()
    .toLowerCase();
  const emailNorm = String(email || '')
    .trim()
    .toLowerCase();
  const sameId = Boolean(emailNorm) && loginNorm === emailNorm;
  // Connexion = e-mail (Stripe) ; identifiant distinct seulement s’il diffère (Pupitre).
  const idLines = sameId
    ? `E-mail de connexion&nbsp;: <strong>${escapeHtml(email)}</strong><br>
<span style="color:${T.meta};font-size:13px;">Utilisez cet e-mail pour vous connecter (site et app).</span><br>`
    : `Identifiant&nbsp;: <strong>${escapeHtml(login)}</strong><br>
E-mail&nbsp;: <strong>${escapeHtml(email)}</strong><br>
<span style="color:${T.meta};font-size:13px;">Connexion possible avec l’identifiant ou l’e-mail.</span><br>`;

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 8px;background-color:${T.surfaceAlt};border:1px solid ${T.border};border-radius:14px;">
<tr><td style="padding:16px 18px;">
<p style="margin:0 0 8px;color:${T.meta};font-size:11px;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;font-family:${T.fontUi};">${escapeHtml(heading)}</p>
<p style="margin:0;color:${T.text};font-size:15px;line-height:1.7;font-family:${T.fontUi};">
${idLines}
Type&nbsp;: <strong>${escapeHtml(roleFr)}</strong>
</p>
</td></tr></table>`;
}

function brevoOpts(brevo, { toEmail, toName, subject, html, tags }) {
  return {
    apiKey: brevo?.apiKey,
    smtpUser: brevo?.smtpUser,
    smtpPass: brevo?.smtpPass,
    dryRun: brevo?.dryRun,
    fromEmail: brevo?.fromEmail,
    fromName: brevo?.fromName,
    toEmail,
    toName,
    subject,
    html,
    tags,
  };
}

/** Admins actifs avec e-mail valide (hors destinataire exclu). */
export async function listActiveAdminEmails(pool, { excludeEmail } = {}) {
  if (!pool?.query) return [];
  const [rows] = await pool.query(
    `SELECT email, display_name, login
     FROM el_users
     WHERE role IN ('admin', 'administrator')
       AND status = ?
       AND email IS NOT NULL
       AND email LIKE '%@%'`,
    [STATUSES.ACTIVE]
  );
  const skip = String(excludeEmail || '')
    .trim()
    .toLowerCase();
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const email = String(row.email || '')
      .trim()
      .toLowerCase();
    if (!email || email === skip || seen.has(email)) continue;
    seen.add(email);
    out.push({
      email,
      name: row.display_name || row.login || email,
    });
  }
  return out;
}

/**
 * Envoie un e-mail à tous les admins actifs (repli info@).
 */
export async function notifyAdmins({
  pool,
  brevo,
  excludeEmail = null,
  subject,
  html,
  tags = ['el-admin-notify'],
  logLabel = 'admin-notify',
}) {
  let recipients = [];
  try {
    recipients = await listActiveAdminEmails(pool, { excludeEmail });
  } catch (err) {
    console.error(`[account-email] list admins (${logLabel})`, err.message);
    return { ok: false, sent: 0, reason: 'admin_query_failed' };
  }

  if (!recipients.length) {
    recipients = [{ email: CONTACT_EMAIL, name: 'ElectronLibre' }];
  }

  let sent = 0;
  let anyDryRun = false;
  for (const dest of recipients) {
    try {
      const out = await sendBrevoEmail(
        brevoOpts(brevo, {
          toEmail: dest.email,
          toName: dest.name,
          subject,
          html,
          tags,
        })
      );
      if (out.dryRun) anyDryRun = true;
      if (out.ok) sent += 1;
      else {
        console.error(
          `[account-email] ${logLabel} failed to=${dest.email}`,
          out.error || 'unknown'
        );
      }
    } catch (err) {
      console.error(
        `[account-email] ${logLabel} error to=${dest.email}`,
        err.message
      );
    }
  }

  if (anyDryRun) {
    console.log(`[account-email] ${logLabel} dry-run count=${sent}`);
  }

  return {
    ok: sent > 0,
    sent,
    dryRun: anyDryRun,
    configured: brevoConfigured(brevo || {}),
  };
}

/**
 * HTML + sujet de l’e-mail titulaire (création).
 */
export function buildAccountCreatedEmail({
  user,
  siteUrl,
  resetToken = null,
  source = 'desk',
  newsletterOptIn = true,
}) {
  const base = String(siteUrl || '').replace(/\/+$/, '');
  const loginUrl = `${base}/login/`;
  const compteUrl = `${base}/compte/`;
  const deskUrl = `${base}/desk/`;
  const { name, login, email, role, roleFr } = userFields(user);
  const isStaff =
    role === ROLES.ADMIN || role === ROLES.EDITOR || role === ROLES.AUTHOR;
  const onNl = newsletterOptIn !== false;
  const nlPhrase = onNl
    ? ' Vous êtes inscrit·e à la <strong>newsletter quotidienne</strong>.'
    : '';

  let lead;
  let title;
  let kicker;
  let subject;
  if (source === 'stripe') {
    kicker = 'Bienvenue';
    title = 'Votre compte est prêt';
    lead =
      'Merci pour votre abonnement à <strong>ElectronLibre</strong>. Votre accès premium est déjà ouvert grâce à votre paiement.' +
      (onNl
        ? ' Vous êtes inscrit·e à la <strong>newsletter quotidienne</strong>.'
        : '');
    subject = 'ElectronLibre — Bienvenue, votre compte est prêt';
  } else {
    kicker = 'Compte créé';
    title = 'Bienvenue sur ElectronLibre';
    if (isStaff) {
      lead = `Votre compte <strong>${escapeHtml(roleFr)}</strong> a été créé et est déjà disponible.${nlPhrase}`;
    } else if (role === ROLES.SUBSCRIBER) {
      lead = `Votre compte <strong>abonné</strong> a été créé et est déjà disponible.${nlPhrase}`;
    } else {
      lead = `Votre compte ElectronLibre a été créé et est déjà disponible.${nlPhrase}`;
    }
    subject = 'ElectronLibre — Confirmation de création de compte';
  }

  let cta;
  let footerNote;
  let actionIntro;
  if (resetToken) {
    const resetUrl = `${base}/login/reset/?token=${encodeURIComponent(resetToken)}`;
    actionIntro =
      '<p style="margin:18px 0 0;">Pour vous connecter au site, choisissez un mot de passe&nbsp;:</p>';
    cta = { href: resetUrl, label: 'Choisir mon mot de passe' };
    footerNote =
      'Ce lien est valable 7&nbsp;jours. Ensuite, «&nbsp;Mot de passe oublié&nbsp;» sur la page de connexion. Le mot de passe sert à vous identifier&nbsp;; votre accès découle du paiement ou de la création du compte.';
  } else {
    // Filet de sécurité si le jeton n’a pas pu être créé
    actionIntro =
      '<p style="margin:18px 0 0;">Pour vous connecter au site, utilisez «&nbsp;Mot de passe oublié&nbsp;» avec l’e-mail ci-dessus.</p>';
    cta = { href: `${base}/login/forgot/`, label: 'Choisir un mot de passe' };
    footerNote =
      'Votre accès est déjà ouvert. Le mot de passe sert uniquement à vous identifier sur le site.';
  }

  const spaceLine = isStaff
    ? `<p style="margin:16px 0 0;">Pupitre&nbsp;: <a href="${escapeHtml(deskUrl)}" style="color:${T.accent};font-weight:600;text-decoration:none;">${escapeHtml(deskUrl)}</a></p>`
    : role === ROLES.SUBSCRIBER
      ? `<p style="margin:16px 0 0;">Espace abonné&nbsp;: <a href="${escapeHtml(compteUrl)}" style="color:${T.accent};font-weight:600;text-decoration:none;">${escapeHtml(compteUrl)}</a></p>`
      : `<p style="margin:16px 0 0;">Connexion&nbsp;: <a href="${escapeHtml(loginUrl)}" style="color:${T.accent};font-weight:600;text-decoration:none;">${escapeHtml(loginUrl)}</a></p>`;

  const bodyHtml = `<p style="margin:0 0 14px;">Bonjour <strong>${escapeHtml(name)}</strong>,</p>
${detailsCard({ login, email, roleFr, heading: 'Votre compte' })}
${actionIntro}
${spaceLine}`;

  const html = renderElEmail({
    siteUrl: base,
    kicker,
    title,
    lead,
    bodyHtml,
    cta,
    footerNote,
  });

  return { subject, html, name, email };
}

/**
 * Notification admin — création ou suppression.
 * @param {'created'|'deleted'} action
 */
export function buildAdminAccountEventEmail({
  action,
  user,
  siteUrl,
  source = 'desk',
  actorLogin = null,
}) {
  const base = String(siteUrl || '').replace(/\/+$/, '');
  const deskUsersUrl = `${base}/desk/?view=users`;
  const { name, login, email, roleFr } = userFields(user);
  const via = sourceLabelFr(source);
  const isDelete = action === 'deleted';

  const actorLine = actorLogin
    ? `<p style="margin:12px 0 0;">${
        isDelete ? 'Supprimé' : 'Créé'
      } par&nbsp;: <strong>${escapeHtml(actorLogin)}</strong></p>`
    : '';

  const intro = isDelete
    ? `Un compte vient d’être <strong>supprimé</strong> via <strong>${escapeHtml(via)}</strong>.`
    : `Un nouveau compte vient d’être <strong>créé</strong> via <strong>${escapeHtml(via)}</strong>.`;

  const bodyHtml = `<p style="margin:0 0 14px;">${intro}</p>
${detailsCard({
  login,
  email,
  roleFr,
  heading: isDelete ? 'Compte supprimé' : 'Nouveau compte',
})}
<p style="margin:14px 0 0;">Nom affiché&nbsp;: <strong>${escapeHtml(name)}</strong></p>
${actorLine}`;

  const html = renderElEmail({
    siteUrl: base,
    kicker: 'Administration',
    title: isDelete ? 'Compte supprimé' : 'Nouveau compte créé',
    lead: `Type&nbsp;: <strong>${escapeHtml(roleFr)}</strong> · ${escapeHtml(via)}.`,
    bodyHtml,
    cta: { href: deskUsersUrl, label: 'Voir les comptes' },
    footerNote: 'Notification automatique ElectronLibre.',
  });

  return {
    subject: isDelete
      ? `ElectronLibre — Compte supprimé (${roleFr})`
      : `ElectronLibre — Nouveau compte (${roleFr})`,
    html,
  };
}

export async function sendAccountCreatedEmail({
  user,
  brevo,
  siteUrl,
  resetToken = null,
  source = 'desk',
  newsletterOptIn = true,
}) {
  if (!user?.email) return { ok: false, reason: 'no_email' };

  const { subject, html, name } = buildAccountCreatedEmail({
    user,
    siteUrl,
    resetToken,
    source,
    newsletterOptIn:
      newsletterOptIn !== false &&
      Number(user.newsletter_opt_in) !== 0,
  });

  const out = await sendBrevoEmail(
    brevoOpts(brevo, {
      toEmail: user.email,
      toName: name,
      subject,
      html,
      tags: ['el-account-created', `el-account-${source}`],
    })
  );

  if (out.dryRun) {
    console.log(
      `[account-email] dry-run user=${user.login || user.email} role=${normalizeRole(user.role)} source=${source}`
    );
  }

  return {
    ok: Boolean(out.ok),
    dryRun: Boolean(out.dryRun),
    configured: brevoConfigured(brevo || {}),
  };
}

async function notifyAdminsAccountEvent({
  action,
  pool,
  user,
  brevo,
  siteUrl,
  source = 'desk',
  actorLogin = null,
}) {
  if (!user) return { ok: false, sent: 0, reason: 'no_user' };

  const { subject, html } = buildAdminAccountEventEmail({
    action,
    user,
    siteUrl,
    source,
    actorLogin,
  });

  return notifyAdmins({
    pool,
    brevo,
    excludeEmail: user.email,
    subject,
    html,
    tags: [
      action === 'deleted'
        ? 'el-account-deleted-admin'
        : 'el-account-created-admin',
      `el-account-${source}`,
    ],
    logLabel:
      action === 'deleted' ? 'admin-account-deleted' : 'admin-account-created',
  });
}

export async function notifyAdminsAccountCreated(opts) {
  return notifyAdminsAccountEvent({ ...opts, action: 'created' });
}

export async function notifyAdminsAccountDeleted(opts) {
  return notifyAdminsAccountEvent({ ...opts, action: 'deleted' });
}
