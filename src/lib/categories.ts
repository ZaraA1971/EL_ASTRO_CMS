/**
 * Rubriques — lecture BDD (el_categories), fallback builtins.
 */
import { getPool } from './db';
import {
  DEFAULT_CATEGORIES,
  categoryNameFromList,
} from '@el/categories';

export type Category = {
  slug: string;
  name: string;
  sort_order: number;
  show_in_nav: boolean;
};

/** @deprecated Préférer listCategories() — conservé pour imports sync rares. */
export const CATEGORIES: { slug: string; name: string }[] = DEFAULT_CATEGORIES.map(
  (c) => ({ slug: c.slug, name: c.name })
);

function rowToCategory(row: Record<string, unknown>): Category {
  return {
    slug: String(row.slug),
    name: String(row.name),
    sort_order: Number(row.sort_order) || 0,
    show_in_nav: Boolean(row.show_in_nav),
  };
}

async function ensureSeeded(pool: ReturnType<typeof getPool>): Promise<void> {
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
}

export async function listCategories(): Promise<Category[]> {
  try {
    const pool = getPool();
    await ensureSeeded(pool);
    const [rows] = await pool.query(
      `SELECT slug, name, sort_order, show_in_nav
       FROM el_categories
       ORDER BY sort_order ASC, name ASC`
    );
    return (rows as Record<string, unknown>[]).map(rowToCategory);
  } catch {
    return DEFAULT_CATEGORIES.map((c) => ({
      slug: c.slug,
      name: c.name,
      sort_order: c.sort_order,
      show_in_nav: c.show_in_nav,
    }));
  }
}

export async function listNavCategories(): Promise<Category[]> {
  const all = await listCategories();
  return all.filter((c) => c.show_in_nav);
}

export async function getCategory(slug: string): Promise<Category | null> {
  const s = String(slug || '').trim();
  if (!s) return null;
  try {
    const pool = getPool();
    await ensureSeeded(pool);
    const [rows] = await pool.query(
      `SELECT slug, name, sort_order, show_in_nav
       FROM el_categories WHERE slug = ? LIMIT 1`,
      [s]
    );
    const row = (rows as Record<string, unknown>[])[0];
    return row ? rowToCategory(row) : null;
  } catch {
    const hit = DEFAULT_CATEGORIES.find((c) => c.slug === s);
    return hit
      ? {
          slug: hit.slug,
          name: hit.name,
          sort_order: hit.sort_order,
          show_in_nav: hit.show_in_nav,
        }
      : null;
  }
}

export async function categoryName(slug: string): Promise<string> {
  const cat = await getCategory(slug);
  return cat?.name || categoryNameFromList(DEFAULT_CATEGORIES, slug);
}
