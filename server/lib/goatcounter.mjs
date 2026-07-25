/**
 * Client GoatCounter API v0 + cache mémoire (fresh / stale / lock).
 * Même logique que le plugin WP electronlibre-audience-patch.
 */

const FRESH_TTL_MS = 600_000; // 10 min
const STALE_TTL_MS = 86_400_000; // 24 h
const LOCK_TTL_MS = 30_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 400;

/** @type {Map<string, { value: any, freshUntil: number, staleUntil: number }>} */
const cache = new Map();
/** @type {Map<string, number>} */
const locks = new Map();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(status) {
  return status === 0 || status === 429 || status >= 500;
}

function isValidResponse(decoded, status) {
  if (!decoded || typeof decoded !== 'object') return false;
  if (status >= 400) return false;
  if ('error' in decoded || 'errors' in decoded) return false;
  return true;
}

export function goatcounterConfigured(cfg = {}) {
  return Boolean(cfg.site && cfg.apiKey);
}

export function utcYmdDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function gcRequest(cfg, method, endpoint, params = {}) {
  if (!goatcounterConfigured(cfg)) return null;

  const base = `https://${cfg.site}.goatcounter.com/api/v0`;
  let url = `${base}/${String(endpoint).replace(/^\//, '')}`;

  const headers = {
    Authorization: `Bearer ${cfg.apiKey}`,
    Accept: 'application/json',
  };

  let body;
  if (method === 'GET' && params && Object.keys(params).length) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v == null || v === '') continue;
      qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  } else if (method !== 'GET' && params && Object.keys(params).length) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(params);
  }

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(20_000),
      });
      const status = res.status;
      let decoded = null;
      try {
        decoded = await res.json();
      } catch {
        decoded = null;
      }
      if (isValidResponse(decoded, status)) return decoded;
      lastError = `HTTP ${status}`;
      if (!isRetryable(status) || attempt >= MAX_RETRIES) break;
    } catch (err) {
      lastError = err?.message || String(err);
      if (attempt >= MAX_RETRIES) break;
    }
    await sleep(RETRY_DELAY_MS * attempt);
  }

  if (lastError) {
    console.error(`[goatcounter] ${endpoint}: ${lastError}`);
  }
  return null;
}

function acquireLock(key) {
  const now = Date.now();
  const until = locks.get(key) || 0;
  if (until > now) return false;
  locks.set(key, now + LOCK_TTL_MS);
  return true;
}

function releaseLock(key) {
  locks.delete(key);
}

/**
 * Cache fresh → stale fallback → lock, comme le transient WP.
 */
export async function withAudienceCache(key, callback, ttlMs = FRESH_TTL_MS) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.freshUntil > now) return hit.value;

  const stale = hit && hit.staleUntil > now ? hit.value : null;

  if (acquireLock(key)) {
    try {
      const data = await callback();
      if (data != null) {
        cache.set(key, {
          value: data,
          freshUntil: now + ttlMs,
          staleUntil: now + STALE_TTL_MS,
        });
        return data;
      }
      if (stale != null) return stale;
      return data;
    } finally {
      releaseLock(key);
    }
  }

  if (stale != null) return stale;

  await sleep(250);
  const again = cache.get(key);
  if (again && again.freshUntil > Date.now()) return again.value;
  if (again && again.staleUntil > Date.now()) return again.value;

  return callback();
}

export function flushAudienceCache() {
  cache.clear();
  locks.clear();
}

export async function getTotal(cfg, params = {}) {
  return gcRequest(cfg, 'GET', 'stats/total', params);
}

export async function getHits(cfg, params = {}) {
  return gcRequest(cfg, 'GET', 'stats/hits', params);
}

export async function getTopReferrers(cfg, params = {}) {
  return gcRequest(cfg, 'GET', 'stats/toprefs', params);
}

export function sumViewsFromStats(summary, days) {
  if (!summary || !Array.isArray(summary.stats) || days <= 0) return null;
  const cutoff = utcYmdDaysAgo(days);
  let sum = 0;
  let found = false;
  for (const row of summary.stats) {
    const day = String(row?.day || '');
    if (!day || day < cutoff) continue;
    sum += Number(row?.daily ?? 0) || 0;
    found = true;
  }
  return found ? sum : null;
}

export function extractGraphData(summary) {
  if (!summary || !Array.isArray(summary.stats)) return [];
  return summary.stats
    .filter((row) => row?.day)
    .map((row) => ({
      day: String(row.day),
      views: Number(row.daily ?? 0) || 0,
    }));
}

export function hitCount(row) {
  if (!row || typeof row !== 'object') return 0;
  if (row.hits != null) return Number(row.hits) || 0;
  if (row.count != null) return Number(row.count) || 0;
  if (row.total != null) return Number(row.total) || 0;
  return 0;
}

export function normalizeHits(raw) {
  if (!raw) return [];
  if (Array.isArray(raw.hits)) return raw.hits;
  if (Array.isArray(raw) && raw.every((x) => x && typeof x === 'object')) {
    return raw;
  }
  return [];
}

const SCHEME_LABELS = {
  h: 'Référent',
  g: 'Moteur',
  c: 'Campagne',
  o: 'Direct',
};

function referrerLabel(row) {
  const name = String(row?.name || '').trim();
  const id = String(row?.id || '').trim();
  const scheme = String(row?.ref_scheme || '');
  if (name) return name;
  if (id) return id;
  if (scheme === 'o') return 'Accès direct / sans référent';
  return 'Inconnu';
}

function referrerUrl(row) {
  const scheme = String(row?.ref_scheme || '');
  const id = String(row?.id || row?.name || '').trim();
  if (scheme !== 'h' || !id) return '';
  if (id.startsWith('http://') || id.startsWith('https://')) return id;
  return `https://${id.replace(/^\//, '')}`;
}

export function normalizeReferrers(refs, totalViews) {
  const list = Array.isArray(refs) ? refs : [];
  let totalRefViews = 0;
  for (const row of list) totalRefViews += Number(row?.count ?? 0) || 0;
  const denominator = totalViews > 0 ? totalViews : totalRefViews;

  return list.map((row) => {
    const count = Number(row?.count ?? 0) || 0;
    const scheme = String(row?.ref_scheme || '');
    return {
      label: referrerLabel(row),
      scheme,
      schemeLabel: SCHEME_LABELS[scheme] || 'Autre',
      count,
      pct: denominator > 0 ? Math.round((count / denominator) * 1000) / 10 : null,
      url: referrerUrl(row),
    };
  });
}

/**
 * Chemins GoatCounter : "electronlibre.info/articles/123-slug/" ou "/slug/".
 * Retourne des clés de jointure possibles (wp_id, slug, path).
 */
export function parseGoatPath(rawPath) {
  let p = String(rawPath || '').trim();
  if (!p) return { path: '', wpId: null, slug: null, pathname: '' };

  // Host + path (nouveau compteur multi-sous-domaines)
  if (!p.startsWith('/') && p.includes('/')) {
    const slash = p.indexOf('/');
    p = p.slice(slash);
  }
  if (!p.startsWith('/')) p = `/${p}`;

  const pathname = p.replace(/\/+/g, '/');
  const clean = pathname.replace(/\/+$/, '') || '/';

  let wpId = null;
  let slug = null;

  const mArticle = clean.match(/^\/articles\/(\d+)-([^/]+)$/i);
  if (mArticle) {
    wpId = Number(mArticle[1]);
    slug = mArticle[2];
  } else {
    // Anciens permaliens WP : /titre-slug,123
    const mWp = clean.match(/^\/([^/]+),(\d+)$/);
    if (mWp) {
      slug = mWp[1];
      wpId = Number(mWp[2]);
    } else {
      const mLegacy = clean.match(/^\/([^/]+)$/);
      if (
        mLegacy &&
        !['articles', 'desk', 'api', 'abonnement', 'login'].includes(mLegacy[1])
      ) {
        slug = mLegacy[1];
      }
    }
  }

  return { path: String(rawPath || ''), pathname: clean + '/', wpId, slug };
}
