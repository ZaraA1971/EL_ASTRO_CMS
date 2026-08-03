/**
 * Identité e-mail ElectronLibre (partagée newsletter / comptes).
 */

import { escapeHtml } from '../escape-html.mjs';

export { escapeHtml };

export const CONTACT_EMAIL = 'info@electronlibre.info';

/** Lien App Store iOS — même URL partout (newsletter, bienvenue…). */
export const IOS_APP_STORE_URL =
  'https://apps.apple.com/fr/app/electronlibre-ia/id6743965549';

/** Jetons visuels e-mail. */
export const EL_EMAIL_TOKENS = Object.freeze({
  accent: '#2f6dfb',
  text: '#0f172a',
  body: '#334155',
  meta: '#64748b',
  surfaceAlt: '#f6f7f9',
  border: '#e2e8f0',
  dark: '#0b1220',
  onDarkMuted: '#cbd5e1',
  brandLibre: '#7a7a7a',
  fontUi: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
  fontEditorial: 'Georgia, Times New Roman, serif',
});

/**
 * Pastille « Installer l’app » (style newsletter).
 */
export function renderAppInstallPill(tokens = EL_EMAIL_TOKENS) {
  const t = tokens;
  return `<a href="${escapeHtml(IOS_APP_STORE_URL)}" target="_blank" style="display:inline-block;background-color:${t.accent};color:#ffffff !important;padding:11px 14px;border-radius:999px;font-size:13px;font-weight:700;text-decoration:none;font-family:${t.fontUi};">Installer l’app</a>`;
}

/**
 * Enveloppe HTML ElectronLibre (hero marque + carte + pied).
 */
export function renderElEmail({
  siteUrl,
  kicker,
  title,
  lead = '',
  bodyHtml,
  cta = null,
  showAppLink = false,
  footerNote = '',
  tokens = EL_EMAIL_TOKENS,
}) {
  const t = tokens;
  const base = String(siteUrl || 'https://electronlibre.info').replace(
    /\/+$/,
    ''
  );
  const container =
    'width:100%;max-width:560px;margin-left:auto;margin-right:auto;';
  const ctaHtml = cta?.href
    ? `<p style="margin:28px 0 0;text-align:left;">
<a href="${escapeHtml(cta.href)}" style="display:inline-block;padding:13px 22px;background-color:${t.accent};color:#ffffff !important;text-decoration:none;border-radius:10px;font-size:15px;font-weight:700;font-family:${t.fontUi};letter-spacing:-0.01em;">${escapeHtml(cta.label || 'Continuer')}</a>
</p>`
    : '';
  const appHtml = showAppLink
    ? `<p style="margin:18px 0 0;">${renderAppInstallPill(t)}</p>
<p style="margin:10px 0 0;color:${t.meta};font-size:13px;line-height:1.45;font-family:${t.fontUi};">Application iOS ElectronLibre — actualité et alertes en mobilité.</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ElectronLibre</title></head>
<body style="margin:0;padding:0;background-color:${t.surfaceAlt};">
<div style="width:100%;box-sizing:border-box;background-color:${t.surfaceAlt};padding:28px 14px 40px;font-family:${t.fontUi};">
  <div style="${container}">
    <div style="background-color:${t.dark};border-radius:22px 22px 0 0;overflow:hidden;color:#ffffff;">
      <div style="padding:22px 28px 20px;text-align:center;">
        <a href="${escapeHtml(base)}" style="display:inline-block;font-family:${t.fontEditorial};font-size:28px;line-height:1;letter-spacing:-0.01em;font-weight:700;color:#ffffff;text-decoration:none;">Electron<span style="color:${t.brandLibre};font-weight:500;">Libre</span></a>
        <p style="margin:14px 0 0;color:${t.accent};font-size:11px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;font-family:${t.fontUi};">${escapeHtml(kicker)}</p>
      </div>
    </div>
    <div style="background-color:#ffffff;border:1px solid ${t.border};border-top:none;border-radius:0 0 22px 22px;padding:28px 28px 32px;">
      <h1 style="margin:0 0 12px;color:${t.text};font-size:26px;line-height:1.2;letter-spacing:-0.02em;font-weight:700;font-family:${t.fontEditorial};">${escapeHtml(title)}</h1>
      ${
        lead
          ? `<p style="margin:0 0 20px;color:${t.body};font-size:16px;line-height:1.55;font-family:${t.fontUi};">${lead}</p>`
          : ''
      }
      <div style="color:${t.body};font-size:15px;line-height:1.6;font-family:${t.fontUi};">
        ${bodyHtml}
      </div>
      ${ctaHtml}
      ${appHtml}
      ${
        footerNote
          ? `<p style="margin:22px 0 0;color:${t.meta};font-size:13px;line-height:1.5;font-family:${t.fontUi};">${footerNote}</p>`
          : ''
      }
    </div>
    <p style="margin:22px 0 0;text-align:center;color:${t.meta};font-size:12px;line-height:1.5;font-family:${t.fontUi};">
      <a href="${escapeHtml(base)}" style="color:${t.meta};text-decoration:none;">electronlibre.info</a>
      ·
      <a href="mailto:${CONTACT_EMAIL}" style="color:${t.meta};text-decoration:none;">${CONTACT_EMAIL}</a>
    </p>
  </div>
</div>
</body>
</html>`;
}
