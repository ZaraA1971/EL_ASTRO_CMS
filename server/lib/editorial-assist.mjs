/**
 * Proxy vers agent_editorial POST /editorial/assist
 * (corriger | reformuler | chapo — profil electronlibre).
 */

const ASSIST_TYPES = new Set(['corriger', 'reformuler', 'chapo']);

export function normalizeAssistType(raw) {
  const t = String(raw || '')
    .trim()
    .toLowerCase();
  return ASSIST_TYPES.has(t) ? t : null;
}

/**
 * @param {{ upstream: string, apiKey: string, type: string, text: string, prompt?: string, profile?: string, timeoutMs?: number }} opts
 */
export async function callEditorialAssist(opts) {
  const type = normalizeAssistType(opts.type);
  if (!type) {
    const err = new Error('type invalide (corriger|reformuler|chapo)');
    err.status = 400;
    throw err;
  }
  const text = String(opts.text || '').trim();
  if (!text) {
    const err = new Error('texte requis');
    err.status = 400;
    throw err;
  }
  const upstream = String(opts.upstream || '').replace(/\/+$/, '');
  if (!upstream) {
    const err = new Error('AGENT_EDITORIAL_URL manquant');
    err.status = 503;
    throw err;
  }
  if (!opts.apiKey) {
    const err = new Error('AGENT_API_KEY manquant');
    err.status = 503;
    throw err;
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(10_000, Number(opts.timeoutMs) || 120_000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(upstream, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Agent-Key': opts.apiKey,
      },
      body: JSON.stringify({
        type,
        text,
        prompt: String(opts.prompt || ''),
        profile: opts.profile || 'electronlibre',
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      const err = new Error(
        data.error || `agent_editorial HTTP ${res.status}`
      );
      err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
      throw err;
    }
    const out = String(data.text || '').trim();
    if (!out) {
      const err = new Error('Réponse IA vide');
      err.status = 502;
      throw err;
    }
    return { text: out, type, model: data.model || null };
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error('Délai dépassé (agent_editorial)');
      e.status = 504;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
