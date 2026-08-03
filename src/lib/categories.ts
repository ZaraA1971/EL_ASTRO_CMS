/**
 * Rubriques — lecture BDD (el_categories), fallback builtins.
 */
import { getPool } from './db';
import {
  DEFAULT_CATEGORIES,
  categoryNameFromList,
  ensureCategoriesSchema,
  rowToCategory as sharedRowToCategory,
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
  return sharedRowToCategory(row) as Category;
}

async function ensureSeeded(pool: ReturnType<typeof getPool>): Promise<void> {
  await ensureCategoriesSchema(pool, 'el_categories', DEFAULT_CATEGORIES);
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
