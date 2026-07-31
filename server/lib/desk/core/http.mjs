/** Helpers HTTP partagés par le CRUD core. */

/**
 * @returns {Promise<{ ok: true, value: object } | { ok: false }>}
 */
export async function parseJsonBody(req, readBody, { allowEmpty = false } = {}) {
  try {
    const raw = (await readBody(req)).toString('utf8');
    if (!raw.trim()) {
      if (allowEmpty) return { ok: true, value: {} };
      return { ok: true, value: {} };
    }
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

export function assertSafeSqlIdent(name, label = 'identifiant SQL') {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name || ''))) {
    throw new Error(`${label} invalide: ${name}`);
  }
  return String(name);
}
