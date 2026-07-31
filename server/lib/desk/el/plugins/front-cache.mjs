/**
 * Plugin host EL : purge cache nginx après mutations éditoriales.
 */
import { purgeFrontCache } from '../../../front-cache.mjs';

function purge() {
  purgeFrontCache();
}

/** @type {import('../../core/plugin-registry.mjs').DeskPlugin} */
export const frontCachePlugin = {
  id: 'front-cache',
  onPublish: purge,
  onDraft: purge,
  onMutate: purge,
  onCategoryChange: purge,
};
