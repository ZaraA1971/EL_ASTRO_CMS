/**
 * Publication X (Twitter) API v2 — POST /2/tweets (OAuth 1.0a user context).
 */

import crypto from 'node:crypto';
import { getXAccountCredentials, normalizeXAccount } from './x-accounts.mjs';

const TWEETS_URL = 'https://api.x.com/2/tweets';
export const X_MAX_LENGTH = 280;

/** @param {string} s */
export function percentEncode(s) {
  return encodeURIComponent(String(s)).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/**
 * En-tête Authorization OAuth 1.0a (corps JSON non signé — convention X API v2).
 * @param {{ method: string, url: string, apiKey: string, apiSecret: string, accessToken: string, accessSecret: string }} opts
 */
export function buildOAuth1Header(opts) {
  const oauth = {
    oauth_consumer_key: opts.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: opts.accessToken,
    oauth_version: '1.0',
  };
  const paramString = Object.keys(oauth)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(oauth[k])}`)
    .join('&');
  const baseString = [
    String(opts.method || 'POST').toUpperCase(),
    percentEncode(opts.url),
    percentEncode(paramString),
  ].join('&');
  const signingKey = `${percentEncode(opts.apiSecret)}&${percentEncode(opts.accessSecret)}`;
  oauth.oauth_signature = crypto
    .createHmac('sha1', signingKey)
    .update(baseString)
    .digest('base64');
  return (
    'OAuth ' +
    Object.keys(oauth)
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(oauth[k])}"`)
      .join(', ')
  );
}

/** Compte Twitter-weight approx. (URLs ≈ 23). */
export function xWeightedLength(text) {
  const s = String(text || '');
  const urlRe = /https?:\/\/[^\s]+/gi;
  let len = 0;
  let last = 0;
  let m;
  while ((m = urlRe.exec(s))) {
    len += [...s.slice(last, m.index)].length;
    len += 23;
    last = m.index + m[0].length;
  }
  len += [...s.slice(last)].length;
  return len;
}

export function assertXText(text) {
  const t = String(text || '').trim();
  if (!t) {
    const err = new Error('Texte du post requis');
    err.status = 400;
    err.code = 'X_TEXT_EMPTY';
    throw err;
  }
  if (xWeightedLength(t) > X_MAX_LENGTH) {
    const err = new Error(`Post trop long (max ${X_MAX_LENGTH})`);
    err.status = 400;
    err.code = 'X_TEXT_TOO_LONG';
    throw err;
  }
  return t;
}

/**
 * @param {{ account: string, text: string, env: Record<string,string>, dryRun?: boolean }} opts
 */
export async function createXPost(opts) {
  const accountId = normalizeXAccount(opts.account);
  if (!accountId) {
    const err = new Error('Compte X invalide (el|bulletin)');
    err.status = 400;
    err.code = 'X_ACCOUNT';
    throw err;
  }
  const text = assertXText(opts.text);
  const dryRun = Boolean(opts.dryRun);
  const creds = getXAccountCredentials(opts.env || {}, accountId);

  if (dryRun) {
    console.info('[x-post] DRY_RUN', { account: accountId, chars: xWeightedLength(text) });
    return {
      ok: true,
      dryRun: true,
      account: accountId,
      handle: creds.handle,
      tweetId: `dry-run-${Date.now()}`,
      text,
      url: null,
    };
  }

  if (!creds.configured) {
    const err = new Error(
      `X non configuré pour ${creds.handle} (secrets ${creds.envPrefix}_*)`
    );
    err.status = 503;
    err.code = 'X_CONFIG';
    throw err;
  }

  const auth = buildOAuth1Header({
    method: 'POST',
    url: TWEETS_URL,
    apiKey: creds.apiKey,
    apiSecret: creds.apiSecret,
    accessToken: creds.accessToken,
    accessSecret: creds.accessSecret,
  });

  const res = await fetch(TWEETS_URL, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(30_000),
  });

  const raw = await res.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    const err = new Error(`X API: réponse invalide (HTTP ${res.status})`);
    err.status = 502;
    err.code = 'X_BAD_RESPONSE';
    throw err;
  }

  if (!res.ok) {
    const detail =
      json?.detail ||
      json?.title ||
      (Array.isArray(json?.errors) && json.errors.map((e) => e.detail || e.message).join('; ')) ||
      `Erreur X API (HTTP ${res.status})`;
    const err = new Error(detail);
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
    err.code = 'X_HTTP';
    err.details = json;
    throw err;
  }

  const tweetId = json?.data?.id ? String(json.data.id) : null;
  if (!tweetId) {
    const err = new Error('X API: id de post manquant');
    err.status = 502;
    err.code = 'X_NO_ID';
    throw err;
  }

  return {
    ok: true,
    dryRun: false,
    account: accountId,
    handle: creds.handle,
    tweetId,
    text: json?.data?.text || text,
    url: `https://x.com/i/web/status/${tweetId}`,
  };
}
