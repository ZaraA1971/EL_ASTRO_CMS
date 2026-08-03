/**
 * Rubriques ElectronLibre — builtins, DDL/seed, mapping ligne.
 * Persistance runtime : table el_categories (via store / Astro).
 *
 * `tableName` doit être un identifiant SQL déjà validé par l’appelant.
 */

import { slugifyCategoryName } from './slugify.mjs';

export { slugifyCategoryName };

export const DEFAULT_CATEGORIES = Object.freeze([
  { slug: 'web_1_2_3', name: 'Web 1,2,3', sort_order: 10, show_in_nav: true },
  { slug: 'so_cult', name: 'Culture', sort_order: 20, show_in_nav: true },
  { slug: 'peer2peer', name: 'Piratage', sort_order: 30, show_in_nav: true },
  { slug: 'old_fashion_media', name: 'Médias', sort_order: 40, show_in_nav: true },
  { slug: 'so_amazing', name: 'High-Tech', sort_order: 50, show_in_nav: true },
  { slug: 'robotic', name: 'Robotic', sort_order: 60, show_in_nav: true },
  { slug: 'gaming', name: 'Gaming', sort_order: 70, show_in_nav: true },
  { slug: 'le_flouze', name: 'Economie', sort_order: 80, show_in_nav: true },
  { slug: 'politique', name: 'Politique', sort_order: 90, show_in_nav: true },
  { slug: 'marketing_room', name: 'Marketing', sort_order: 100, show_in_nav: true },
  { slug: 'paper', name: 'Papers', sort_order: 110, show_in_nav: false },
]);

/** Corps CREATE TABLE (sans nom de table). */
export const CATEGORIES_TABLE_COLUMNS_SQL = `
  slug VARCHAR(64) NOT NULL,
  name VARCHAR(120) NOT NULL,
  sort_order INT NOT NULL DEFAULT 100,
  show_in_nav TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (slug),
  KEY idx_sort (sort_order),
  KEY idx_nav_sort (show_in_nav, sort_order)
`.trim();

export function categoriesCreateTableSql(tableName) {
  return `CREATE TABLE IF NOT EXISTS \`${tableName}\` (
${CATEGORIES_TABLE_COLUMNS_SQL}
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
}

export function categoryNameFromList(list, slug) {
  const s = String(slug || '');
  const hit = (list || []).find((c) => c.slug === s);
  return hit?.name || s;
}

export function rowToCategory(row) {
  return {
    slug: String(row.slug),
    name: String(row.name),
    sort_order: Number(row.sort_order) || 0,
    show_in_nav: Boolean(row.show_in_nav),
  };
}

/**
 * CREATE TABLE + INSERT IGNORE des defaults.
 * @param {{ query: Function }} pool
 * @param {string} tableName identifiant SQL sûr
 * @param {ReadonlyArray<{slug:string,name:string,sort_order?:number,show_in_nav?:boolean}>} [defaults]
 */
export async function ensureCategoriesSchema(
  pool,
  tableName,
  defaults = DEFAULT_CATEGORIES
) {
  await pool.query(categoriesCreateTableSql(tableName));
  for (const c of defaults) {
    await pool.query(
      `INSERT IGNORE INTO \`${tableName}\` (slug, name, sort_order, show_in_nav)
       VALUES (?, ?, ?, ?)`,
      [c.slug, c.name, c.sort_order ?? 100, c.show_in_nav ? 1 : 0]
    );
  }
}
