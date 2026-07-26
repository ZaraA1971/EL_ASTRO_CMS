/**
 * Rate-limit mémoire simple (process local).
 * Suffisant pour staging / single-node API.
 */

const buckets = new Map();

/**
 * @param {string} key
 * @param {{ windowMs: number, max: number }} opts
 * @returns {{ ok: boolean, remaining: number, retryAfterSec: number }}
 */
export function rateLimit(key, opts) {
  const windowMs = Math.max(1000, Number(opts.windowMs) || 60_000);
  const max = Math.max(1, Number(opts.max) || 10);
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start >= windowMs) {
    b = { start: now, count: 0 };
    buckets.set(key, b);
  }
  b.count += 1;
  const ok = b.count <= max;
  const retryAfterSec = ok
    ? 0
    : Math.max(1, Math.ceil((b.start + windowMs - now) / 1000));
  return {
    ok,
    remaining: Math.max(0, max - b.count),
    retryAfterSec,
  };
}

/**
 * IP client pour rate-limit.
 * Préfère X-Real-IP (posé par nginx = $remote_addr) — ne jamais faire confiance
 * au premier hop X-Forwarded-For (spoofable par le client).
 */
export function clientIp(req) {
  const real = String(req.headers['x-real-ip'] || '').trim();
  if (real) return real;
  const socket =
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    '';
  if (socket) return socket;
  return 'unknown';
}

/** Nettoyage opportuniste des buckets expirés */
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now - b.start > 3600_000) buckets.delete(k);
  }
}, 600_000).unref?.();
