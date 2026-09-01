/**
 * Pousse un événement pupitre vers le sas Vigie (localhost).
 * Échec réseau = silence (l’audit MySQL reste la source).
 */
const INGRESS = process.env.VIGIE_INGRESS_URL || 'http://127.0.0.1:8790/ingress';

const ACCOUNT_ACTIONS = new Set([
  'user.create',
  'user.update',
  'user.delete',
  'user.password_regenerate',
  'user.password_reset',
  'user.password_forgot_reset',
  'user.password_change',
]);

const LABELS = {
  'user.create': 'création de compte',
  'user.update': 'modification de compte',
  'user.delete': 'suppression de compte',
  'user.password_regenerate': 'mot de passe régénéré',
  'user.password_reset': 'mot de passe régénéré',
  'user.password_forgot_reset': 'mot de passe réinitialisé',
  'user.password_change': 'mot de passe changé',
};

const SECRET = /password|hash|token|secret|api_key/i;

function cleanMeta(meta) {
  if (!meta || typeof meta !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SECRET.test(k) || v == null || v === '') continue;
    if (typeof v === 'object') continue;
    out[k] = v;
  }
  return out;
}

export function accountPayload(evt, insertId) {
  const action = String(evt?.action || '');
  const meta = cleanMeta(evt?.meta);
  const login = meta.login || evt?.targetId || '?';
  const actor = evt?.actor?.login || 'système';
  const label = LABELS[action] || action;
  const kind = action === 'user.delete' ? 'alert' : 'watch';
  const role = meta.role || meta.newRole || '';
  const origin =
    meta.source === 'stripe' ? 'abonnement' : meta.source || 'pupitre';
  const lines = [
    `${label} : ${login}.`,
    `Par : ${actor}.`,
  ];
  if (role) lines.push(`Rôle : ${role}.`);
  if (meta.status) lines.push(`Statut : ${meta.status}.`);
  if (origin) lines.push(`Origine : ${origin}.`);
  if (meta.email) lines.push(`Email : ${meta.email}.`);
  const facts = {
    actor,
    login: String(login),
    action,
    role,
    status: meta.status || '',
    source: origin,
    target_id: evt?.targetId != null ? String(evt.targetId) : '',
    audit_id: insertId != null ? String(insertId) : '',
  };
  if (meta.email) facts.email = meta.email;
  return {
    source: 'pupitre',
    kind,
    title: `${label} — ${login}`.slice(0, 240),
    body: lines.join(' ').slice(0, 6000),
    facts,
    fingerprint: `pupitre:${action}:${insertId || evt?.targetId || Date.now()}`.slice(
      0,
      200
    ),
    drain: true,
  };
}

export function shouldPushAccount(action) {
  return ACCOUNT_ACTIONS.has(String(action || ''));
}

export function shouldPushNewsletter(action) {
  return String(action || '') === 'newsletter.send';
}

function boolish(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

export function newsletterPayload(evt, insertId) {
  const meta = cleanMeta(evt?.meta);
  const actor = evt?.actor?.login || 'système';
  const nid = evt?.targetId != null ? String(evt.targetId) : '';
  const subject = String(meta.subject || '').trim() || 'sans sujet';
  const sent = Number(meta.sent || 0);
  const skipped = Number(meta.skipped || 0);
  const errors = Number(meta.errors || 0);
  const total = Number(meta.total || sent + skipped + errors);
  const dry = boolish(meta.dryRun);
  const failed = errors > 0 && sent === 0 && skipped === 0 && !dry;
  const status = dry ? 'dry-run' : failed ? 'failed' : 'sent';
  const kind = failed ? 'alert' : 'watch';
  const date = String(meta.date || '').trim();
  const title = dry
    ? `Newsletter — essai (${total})`
    : failed
      ? `Newsletter — envoi échoué`
      : `Newsletter — envoyée (${sent}/${total})`;
  const body = [
    `« ${subject} ».`,
    `Destinataires : ${total}. Envoyés : ${sent}. Sautés : ${skipped}. Erreurs : ${errors}.`,
  ].join(' ');
  const facts = {
    actor,
    id: nid,
    status,
    theme: 'newsletter',
    label: subject.slice(0, 80),
    sent,
    skipped,
    errors,
    total,
  };
  if (date) facts.date = date;
  return {
    source: 'pupitre',
    kind,
    title: title.slice(0, 240),
    body: body.slice(0, 6000),
    facts,
    fingerprint: `pupitre:newsletter.send:${insertId || nid || Date.now()}`.slice(
      0,
      200
    ),
    drain: true,
  };
}

export async function pushVigieEvent(payload) {
  try {
    const res = await fetch(INGRESS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      console.error('[vigie-ingress]', res.status);
      return { ok: false, status: res.status };
    }
    return { ok: true };
  } catch (err) {
    console.error('[vigie-ingress]', err.message);
    return { ok: false, error: err.message };
  }
}

export async function pushVigieAccount(evt, insertId) {
  if (!shouldPushAccount(evt?.action)) return { skipped: true };
  return pushVigieEvent(accountPayload(evt, insertId));
}

export async function pushVigieFromAudit(evt, insertId) {
  if (shouldPushAccount(evt?.action)) {
    return pushVigieEvent(accountPayload(evt, insertId));
  }
  if (shouldPushNewsletter(evt?.action)) {
    return pushVigieEvent(newsletterPayload(evt, insertId));
  }
  return { skipped: true };
}

export function audiencePayload(data) {
  const k = data?.kpis || {};
  const ok = Boolean(data?.ok);
  const top = Array.isArray(data?.top) ? data.top.slice(0, 5) : [];
  const titles = top.map((r) => r.title || r.path || '?').filter(Boolean);
  const kind = ok ? 'watch' : 'alert';
  const title = ok
    ? `Audience — ${k.views7 ?? '?'} vues 7j · ${k.views30 ?? '?'} vues 30j`
    : 'Audience — échec GoatCounter';
  const body = ok
    ? `Vues 7 jours : ${k.views7 ?? '?'}. Vues 30 jours : ${k.views30 ?? '?'}. Concentration : ${k.concentrationPct ?? '?'} %. Top : ${titles.join(' · ') || '—'}.`
    : String(data?.error || 'Chiffres indisponibles.');
  return {
    source: 'audience',
    kind,
    title: title.slice(0, 240),
    body: body.slice(0, 6000),
    facts: {
      views7: k.views7,
      views30: k.views30,
      concentration: k.concentrationPct,
      top: titles.join(' | '),
      status: ok ? 'ok' : 'fail',
    },
    fingerprint: `audience:refresh:${data?.fetchedAt || Date.now()}`.slice(0, 200),
    drain: true,
  };
}
