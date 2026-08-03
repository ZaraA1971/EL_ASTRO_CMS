/**
 * Envoi de notifications push OneSignal (REST).
 * Env : ONESIGNAL_APP_ID, ONESIGNAL_REST_API_KEY, ONESIGNAL_SITE_URL
 */

import { stripHtmlToText } from './excerpt.mjs';

function authHeader(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) return null;
  // Clés riches OneSignal (os_v2_… / os_v…) → "Key …", sinon legacy Basic
  if (key.startsWith('os_v')) return `Key ${key}`;
  return `Basic ${key}`;
}

/**
 * @param {object} articleRow — ligne MySQL el_articles
 * @param {object} opts
 * @param {string} opts.appId
 * @param {string} opts.apiKey
 * @param {string} opts.siteUrl — base URL publique (ex. https://electronlibre.info)
 * @param {string} [opts.segment]
 * @param {string} [opts.title] — heading (défaut nom du site)
 * @param {boolean} [opts.sendToMobile]
 */
export async function sendArticlePush(articleRow, opts) {
  const appId = String(opts.appId || '').trim();
  const apiKey = String(opts.apiKey || '').trim();
  const siteUrl = String(opts.siteUrl || '').replace(/\/+$/, '');
  const dryRun = Boolean(opts.dryRun);

  const articleId = Number(articleRow.article_id);
  const slug = String(articleRow.slug || 'article');
  const articleTitle = String(articleRow.title || 'Nouvel article').trim();
  const heading = String(opts.title || 'ElectronLibre').trim() || 'ElectronLibre';
  const content =
    stripHtmlToText(articleRow.excerpt).slice(0, 220) ||
    articleTitle.slice(0, 220);
  const url = siteUrl
    ? `${siteUrl}/articles/${articleId}-${slug}/`
    : `/articles/${articleId}-${slug}/`;
  const segment = String(opts.segment || 'All');

  if (dryRun) {
    console.info('[onesignal] DRY_RUN push skipped', { articleId, url, segment, heading });
    return { id: 'dry-run', recipients: 0, url, dryRun: true };
  }

  if (!appId || !apiKey) {
    const err = new Error('OneSignal non configuré (APP_ID / REST_API_KEY)');
    err.code = 'ONESIGNAL_CONFIG';
    throw err;
  }
  if (!siteUrl) {
    const err = new Error('ONESIGNAL_SITE_URL manquant');
    err.code = 'ONESIGNAL_CONFIG';
    throw err;
  }

  const fields = {
    app_id: appId,
    headings: { en: heading, fr: heading },
    contents: { en: content, fr: content },
    included_segments: [segment],
    web_push_topic: `post-${articleId}`,
    isAnyWeb: true,
    url,
  };

  if (opts.sendToMobile !== false) {
    fields.isIos = true;
    fields.isAndroid = true;
    fields.isHuawei = true;
    fields.isWP_WNS = true;
  }

  const auth = authHeader(apiKey);
  const res = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: {
      Authorization: auth,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(fields),
    signal: AbortSignal.timeout(30_000),
  });

  const raw = await res.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    const err = new Error(`OneSignal: réponse invalide (HTTP ${res.status})`);
    err.code = 'ONESIGNAL_BAD_RESPONSE';
    throw err;
  }

  if (!res.ok || json.errors) {
    const msg =
      (Array.isArray(json.errors) && json.errors.join(', ')) ||
      json.error ||
      `Erreur OneSignal (HTTP ${res.status})`;
    const err = new Error(msg);
    err.code = 'ONESIGNAL_HTTP';
    err.status = res.status;
    err.details = json;
    throw err;
  }

  return {
    id: json.id || null,
    recipients: json.recipients != null ? Number(json.recipients) : null,
    url,
  };
}
