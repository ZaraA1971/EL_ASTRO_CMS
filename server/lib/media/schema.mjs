/**
 * Schéma médias EL — binding sur le store Pupitre core.
 */
import { createMediaStore } from '../desk/core/media/store.mjs';

export const elMediaStore = createMediaStore({ tableName: 'el_media' });

export async function ensureMediaSchema(pool) {
  return elMediaStore.ensureSchema(pool);
}
