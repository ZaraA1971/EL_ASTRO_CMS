/**
 * Brevo — envoi newsletter.
 * Préférence : Transactional API (BREVO_API_KEY).
 * Fallback : SMTP Brevo (BREVO_SMTP_USER / BREVO_SMTP_PASS).
 * Dry-run : aucun envoi réel.
 */

import nodemailer from 'nodemailer';

const BREVO_API = 'https://api.brevo.com/v3/smtp/email';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let smtpTransport = null;

function getSmtpTransport(opts) {
  const user = String(opts.smtpUser || '').trim();
  const pass = String(opts.smtpPass || '').trim();
  if (!user || !pass) return null;
  if (
    smtpTransport &&
    smtpTransport.__user === user &&
    smtpTransport.__pass === pass
  ) {
    return smtpTransport;
  }
  smtpTransport = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    auth: { user, pass },
  });
  smtpTransport.__user = user;
  smtpTransport.__pass = pass;
  return smtpTransport;
}

export function brevoConfigured(opts) {
  return Boolean(
    String(opts?.apiKey || '').trim() ||
      (String(opts?.smtpUser || '').trim() &&
        String(opts?.smtpPass || '').trim())
  );
}

/**
 * @param {object} opts
 */
export async function sendBrevoEmail(opts) {
  const apiKey = String(opts.apiKey || '').trim();
  const dryRun = Boolean(opts.dryRun);
  const fromEmail = String(opts.fromEmail || 'info@electronlibre.info').trim();
  const fromName = String(opts.fromName || 'ElectronLibre').trim();
  const toEmail = String(opts.toEmail || '').trim();
  const subject = String(opts.subject || '').trim();
  const html = String(opts.html || '');
  const configured = brevoConfigured(opts);

  if (!toEmail || !subject || !html) {
    return { ok: false, error: 'missing_fields' };
  }

  if (dryRun || !configured) {
    console.log(
      `[brevo] dry-run to=${toEmail} subject=${subject.slice(0, 60)} configured=${configured}`
    );
    return {
      ok: true,
      dryRun: true,
      messageId: `dry-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
  }

  // 1) API Transactional
  if (apiKey) {
    const body = {
      sender: { name: fromName, email: fromEmail },
      to: [{ email: toEmail, name: opts.toName || undefined }],
      subject,
      htmlContent: html,
      tags: opts.tags || ['el-newsletter'],
    };
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(BREVO_API, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'api-key': apiKey,
          },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 429) {
          lastErr = 'rate_limited';
          await sleep(800 * (attempt + 1));
          continue;
        }
        if (!res.ok) {
          return {
            ok: false,
            error: data?.message || `http_${res.status}`,
            status: res.status,
          };
        }
        return { ok: true, messageId: data?.messageId || null, via: 'api' };
      } catch (err) {
        lastErr = err.message || 'fetch_error';
        await sleep(400 * (attempt + 1));
      }
    }
    return { ok: false, error: lastErr || 'unknown' };
  }

  // 2) SMTP fallback
  const transport = getSmtpTransport(opts);
  if (!transport) return { ok: false, error: 'brevo_not_configured' };
  try {
    const info = await transport.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: opts.toName ? `"${opts.toName}" <${toEmail}>` : toEmail,
      subject,
      html,
    });
    return {
      ok: true,
      messageId: info.messageId || null,
      via: 'smtp',
    };
  } catch (err) {
    return { ok: false, error: err.message || 'smtp_error' };
  }
}
