/**
 * Rubriques — table el_categories (builtins seedés + créations pupitre).
 */
import {
  DEFAULT_CATEGORIES,
  slugifyCategoryName,
  categoryNameFromList,
} from '../../shared/categories.mjs';

export { DEFAULT_CATEGORIES, slugifyCategoryName, categoryNameFromList };

let ensured = false;

function rowToCategory(row) {
  return {
    slug: String(row.slug),
    name: String(row.name),
    sort_order: Number(row.sort_order) || 0,
    show_in_nav: Boolean(row.show_in_nav),
  };
}

export async function ensureCategoriesSchema(pool) {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS el_categories (
      slug VARCHAR(64) NOT NULL,
      name VARCHAR(120) NOT NULL,
      sort_order INT NOT NULL DEFAULT 100,
      show_in_nav TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (slug),
      KEY idx_sort (sort_order),
      KEY idx_nav_sort (show_in_nav, sort_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  for (const c of DEFAULT_CATEGORIES) {
    await pool.query(
      `INSERT IGNORE INTO el_categories (slug, name, sort_order, show_in_nav)
       VALUES (?, ?, ?, ?)`,
      [c.slug, c.name, c.sort_order, c.show_in_nav ? 1 : 0]
    );
  }
  ensured = true;
}

export async function listCategories(pool) {
  await ensureCategoriesSchema(pool);
  const [rows] = await pool.query(
    `SELECT slug, name, sort_order, show_in_nav
     FROM el_categories
     ORDER BY sort_order ASC, name ASC`
  );
  return rows.map(rowToCategory);
}

export async function getCategory(pool, slug) {
  await ensureCategoriesSchema(pool);
  const s = String(slug || '').trim();
  if (!s) return null;
  const [rows] = await pool.query(
    `SELECT slug, name, sort_order, show_in_nav
     FROM el_categories WHERE slug = ? LIMIT 1`,
    [s]
  );
  return rows[0] ? rowToCategory(rows[0]) : null;
}

export async function createCategory(pool, { name, slug: wantedSlug } = {}) {
  await ensureCategoriesSchema(pool);
  const label = String(name || '').trim().slice(0, 120);
  if (!label) {
    const err = new Error('Nom de rubrique requis');
    err.status = 400;
    throw err;
  }

  let slug = slugifyCategoryName(wantedSlug || label);
  if (!/^[a-z0-9_]+$/.test(slug)) {
    const err = new Error('Slug invalide');
    err.status = 400;
    throw err;
  }

  const existing = await getCategory(pool, slug);
  if (existing) {
    if (!wantedSlug) {
      let n = 2;
      while (await getCategory(pool, `${slug}_${n}`)) n += 1;
      slug = `${slug}_${n}`;
    } else {
      const err = new Error('Cette rubrique existe déjà');
      err.status = 409;
      throw err;
    }
  }

  const [maxRows] = await pool.query(
    `SELECT COALESCE(MAX(sort_order), 0) AS m FROM el_categories`
  );
  const sortOrder = Number(maxRows[0]?.m || 0) + 10;

  await pool.query(
    `INSERT INTO el_categories (slug, name, sort_order, show_in_nav)
     VALUES (?, ?, ?, 1)`,
    [slug, label, sortOrder]
  );

  return getCategory(pool, slug);
}
