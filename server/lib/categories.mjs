/**
 * Rubriques EL — binding host sur le store Pupitre core.
 */
import {
  DEFAULT_CATEGORIES,
  slugifyCategoryName,
  categoryNameFromList,
} from '../../shared/categories.mjs';
import { createCategoriesStore } from './desk/core/categories/store.mjs';

export { DEFAULT_CATEGORIES, slugifyCategoryName, categoryNameFromList };

/** Store EL partagé (desk host + API contenu). */
export const elCategoriesStore = createCategoriesStore({
  tableName: 'el_categories',
  defaults: DEFAULT_CATEGORIES,
  slugify: slugifyCategoryName,
});

export async function ensureCategoriesSchema(pool) {
  return elCategoriesStore.ensureSchema(pool);
}

export async function listCategories(pool) {
  return elCategoriesStore.list(pool);
}

export async function getCategory(pool, slug) {
  return elCategoriesStore.get(pool, slug);
}

export async function createCategory(pool, opts) {
  return elCategoriesStore.create(pool, opts);
}
