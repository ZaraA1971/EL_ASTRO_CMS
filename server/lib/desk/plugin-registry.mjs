/**
 * Registry de plugins Pupitre (Phase 1).
 * Chaque plugin peut enrichir les capabilities et consommer des routes /api/desk/*.
 */

/**
 * @typedef {object} DeskPlugin
 * @property {string} id
 * @property {(ctx: object, session: object) => Record<string, unknown>} [caps]
 * @property {(parts: string[], req: import('http').IncomingMessage) => boolean} [match]
 * @property {(req: import('http').IncomingMessage, res: import('http').ServerResponse, parts: string[], ctx: object) => unknown | Promise<unknown>} [handle]
 * @property {(parts: string[], req: import('http').IncomingMessage, article: object) => boolean} [matchArticle]
 * @property {(req: import('http').IncomingMessage, res: import('http').ServerResponse, parts: string[], ctx: object, article: object) => unknown | Promise<unknown>} [handleArticle]
 */

export function createPluginRegistry(plugins = []) {
  /** @type {DeskPlugin[]} */
  const list = [];

  function register(plugin) {
    if (!plugin?.id) throw new Error('DeskPlugin.id requis');
    if (list.some((p) => p.id === plugin.id)) {
      throw new Error(`DeskPlugin déjà enregistré: ${plugin.id}`);
    }
    list.push(plugin);
    return api;
  }

  function ids() {
    return list.map((p) => p.id);
  }

  function mergeCaps(base, ctx, session) {
    const out = { ...base };
    for (const p of list) {
      if (typeof p.caps !== 'function') continue;
      Object.assign(out, p.caps(ctx, session) || {});
    }
    return out;
  }

  async function tryHandle(req, res, parts, ctx) {
    for (const p of list) {
      if (typeof p.match !== 'function' || typeof p.handle !== 'function') continue;
      if (!p.match(parts, req)) continue;
      await p.handle(req, res, parts, ctx);
      return true;
    }
    return false;
  }

  async function tryHandleArticle(req, res, parts, ctx, article) {
    for (const p of list) {
      if (
        typeof p.matchArticle !== 'function' ||
        typeof p.handleArticle !== 'function'
      ) {
        continue;
      }
      if (!p.matchArticle(parts, req, article)) continue;
      await p.handleArticle(req, res, parts, ctx, article);
      return true;
    }
    return false;
  }

  const api = {
    register,
    ids,
    mergeCaps,
    tryHandle,
    tryHandleArticle,
    get plugins() {
      return list.slice();
    },
  };
  for (const p of plugins) register(p);
  return api;
}

/**
 * Parse DESK_PLUGINS env (csv). Undefined/null → tous les ids fournis.
 * Chaîne vide → aucun plugin.
 */
export function resolveEnabledPluginIds(envValue, allIds) {
  if (envValue == null) return allIds.slice();
  const raw = String(envValue).trim();
  if (!raw) return [];
  const wanted = new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return allIds.filter((id) => wanted.has(id));
}
