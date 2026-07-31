/**
 * Cycle de vie desk : bump contentGen + hooks plugins host.
 * Événements : onPublish | onDraft | onMutate | onCategoryChange
 */
import { bumpContentGen } from './content-gen.mjs';

/**
 * @param {import('./plugin-registry.mjs').DeskPluginRegistry | null | undefined} plugins
 * @param {'onPublish'|'onDraft'|'onMutate'|'onCategoryChange'} event
 * @param {object} [payload]
 * @param {object} [ctx]
 */
export async function emitDeskLifecycle(plugins, event, payload = {}, ctx = {}) {
  const contentGen = bumpContentGen();
  if (plugins && typeof plugins.runHooks === 'function') {
    await plugins.runHooks(event, payload, ctx);
  }
  return contentGen;
}
