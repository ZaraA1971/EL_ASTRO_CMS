/**
 * Envoi de notifications push OneSignal (REST).
 * Env : ONESIGNAL_APP_ID, ONESIGNAL_REST_API_KEY, ONESIGNAL_SITE_URL
 */

import { stripHtmlToText } from './excerpt.mjs';
import { absoluteArticleUrl } from './article-path.mjs';
import {
  mergeSegmentLists,
  parseSegmentsResponse,
  resolvePushSegments,
} from './onesignal-segments.mjs';

export {
  BUILTIN_PUSH_SEGMENTS,
  mergeSegmentLists,
  parseSegmentsResponse,
  resolvePushSegments,
  segmentLabel,
} from './onesignal-segments.mjs';

function authHeader(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) return null;
  // Clés riches OneSignal (os_v2_… / os_v…) → "Key …", sinon legacy Basic
  if (key.startsWith('os_v')) return `Key ${key}`;
  return `Basic ${key}`;
}

const SEGMENT_CACHE_MS = 5 * 60 * 1000;
let segmentCache = { at: 0, items: null };

/**
 * Groupes / segments OneSignal (API + repli builtins).
 * @param {{ appId?: string, apiKey?: string, bypassCache?: boolean }} opts
 */
export async function listPushSegments(opts = {}) {
  if (
    !opts.bypassCache &&
    segmentCache.items &&
    Date.now() - segmentCache.at < SEGMENT_CACHE_MS
  ) {
    return { segments: segmentCache.items, source: 'cache' };
  }
  const appId = String(opts.appId || '').trim();
  const apiKey = String(opts.apiKey || '').trim();
  if (!appId || !apiKey) {
    return { segments: mergeSegmentLists([]), source: 'builtin' };
  }
  try {
    const auth = authHeader(apiKey);
    const res = await fetch(
      `https://api.onesignal.com/apps/${encodeURIComponent(appId)}/segments?limit=300`,
      {
        headers: { Authorization: auth, Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      }
    );
    const raw = await res.text();
    let json = {};
    try {
      json = JSON.parse(raw);
    } catch {
      json = {};
    }
    if (!res.ok) {
      return {
        segments: mergeSegmentLists([]),
        source: 'builtin',
        error: 'Groupes OneSignal indisponibles',
      };
    }
    const segments = mergeSegmentLists(parseSegmentsResponse(json));
    segmentCache = { at: Date.now(), items: segments };
    return { segments, source: 'onesignal' };
  } catch {
    return {
      segments: mergeSegmentLists([]),
      source: 'builtin',
      error: 'Groupes OneSignal indisponibles',
    };
  }
}

/**
 * @param {object} articleRow — ligne MySQL el_articles
 * @param {object} opts
 * @param {string} opts.appId
 * @param {string} opts.apiKey
 * @param {string} opts.siteUrl — base URL publique (ex. https://electronlibre.info)
 * @param {string|string[]} [opts.segment]
 * @param {string[]} [opts.segments]
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
  const url = absoluteArticleUrl(siteUrl, articleId, slug);
  const segments = resolvePushSegments(opts.segments ?? opts.segment);

  if (dryRun) {
    console.info('[onesignal] DRY_RUN push skipped', {
      articleId,
      url,
      segments,
      heading,
    });
    return { id: 'dry-run', recipients: 0, url, segments, dryRun: true };
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
    included_segments: segments,
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
    segments,
  };
}
