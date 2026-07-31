/**
 * Registry de plugins Pupitre (Phase 1–2).
 * Capabilities, routes /api/desk/*, hooks de cycle de vie (publish/draft/mutate).
 */

/**
 * @typedef {object} DeskPlugin
 * @property {string} id
 * @property {(ctx: object, session: object) => Record<string, unknown>} [caps]
 * @property {(parts: string[], req: import('http').IncomingMessage) => boolean} [match]
 * @property {(req: import('http').IncomingMessage, res: import('http').ServerResponse, parts: string[], ctx: object) => unknown | Promise<unknown>} [handle]
 * @property {(parts: string[], req: import('http').IncomingMessage, article: object) => boolean} [matchArticle]
 * @property {(req: import('http').IncomingMessage, res: import('http').ServerResponse, parts: string[], ctx: object, article: object) => unknown | Promise<unknown>} [handleArticle]
 * @property {(payload: object, ctx: object) => unknown | Promise<unknown>} [onPublish]
 * @property {(payload: object, ctx: object) => unknown | Promise<unknown>} [onDraft]
 * @property {(payload: object, ctx: object) => unknown | Promise<unknown>} [onMutate]
 * @property {(payload: object, ctx: object) => unknown | Promise<unknown>} [onCategoryChange]
 */

/**
 * @typedef {object} DeskPluginRegistry
 * @property {(plugin: DeskPlugin) => DeskPluginRegistry} register
 * @property {() => string[]} ids
 * @property {(base: object, ctx: object, session: object) => object} mergeCaps
 * @property {Function} tryHandle
 * @property {Function} tryHandleArticle
 * @property {(event: string, payload?: object, ctx?: object) => Promise<void>} runHooks
 * @property {DeskPlugin[]} plugins
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

  /**
   * Exécute un hook nommé sur tous les plugins qui l’exposent.
   * Les erreurs d’un plugin sont loguées sans bloquer les suivants.
   */
  async function runHooks(event, payload = {}, ctx = {}) {
    const name = String(event || '');
    if (!name) return;
    for (const p of list) {
      const fn = p[name];
      if (typeof fn !== 'function') continue;
      try {
        await fn.call(p, payload, ctx);
      } catch (err) {
        console.error(`[desk] plugin ${p.id}.${name}`, err?.message || err);
      }
    }
  }

  const api = {
    register,
    ids,
    mergeCaps,
    tryHandle,
    tryHandleArticle,
    runHooks,
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
