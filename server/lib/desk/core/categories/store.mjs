/**
 * Store rubriques portable — table + defaults injectés par le host.
 */
import { assertSafeSqlIdent } from '../http.mjs';
import { slugifyCategoryName } from '../../../slugify.mjs';
import {
  ensureCategoriesSchema as ensureSharedSchema,
  rowToCategory,
} from '../../../../../shared/categories.mjs';

/**
 * @param {object} opts
 * @param {string} [opts.tableName='categories']
 * @param {Array<{slug:string,name:string,sort_order?:number,show_in_nav?:boolean}>} [opts.defaults]
 * @param {(name: string) => string} [opts.slugify]
 */
export function createCategoriesStore({
  tableName = 'categories',
  defaults = [],
  slugify = slugifyCategoryName,
} = {}) {
  const table = assertSafeSqlIdent(tableName, 'table catégories');
  let ensured = false;

  async function ensureSchema(pool) {
    if (ensured) return;
    await ensureSharedSchema(pool, table, defaults);
    ensured = true;
  }

  async function list(pool) {
    await ensureSchema(pool);
    const [rows] = await pool.query(
      `SELECT slug, name, sort_order, show_in_nav
       FROM \`${table}\`
       ORDER BY sort_order ASC, name ASC`
    );
    return rows.map(rowToCategory);
  }

  async function get(pool, slug) {
    await ensureSchema(pool);
    const s = String(slug || '').trim();
    if (!s) return null;
    const [rows] = await pool.query(
      `SELECT slug, name, sort_order, show_in_nav
       FROM \`${table}\` WHERE slug = ? LIMIT 1`,
      [s]
    );
    return rows[0] ? rowToCategory(rows[0]) : null;
  }

  async function create(pool, { name, slug: wantedSlug } = {}) {
    await ensureSchema(pool);
    const label = String(name || '').trim().slice(0, 120);
    if (!label) {
      const err = new Error('Nom de rubrique requis');
      err.status = 400;
      throw err;
    }

    let slug = slugify(wantedSlug || label);
    if (!/^[a-z0-9_]+$/.test(slug)) {
      const err = new Error('Slug invalide');
      err.status = 400;
      throw err;
    }

    const existing = await get(pool, slug);
    if (existing) {
      if (!wantedSlug) {
        let n = 2;
        while (await get(pool, `${slug}_${n}`)) n += 1;
        slug = `${slug}_${n}`;
      } else {
        const err = new Error('Cette rubrique existe déjà');
        err.status = 409;
        throw err;
      }
    }

    const [maxRows] = await pool.query(
      `SELECT COALESCE(MAX(sort_order), 0) AS m FROM \`${table}\``
    );
    const sortOrder = Number(maxRows[0]?.m || 0) + 10;

    await pool.query(
      `INSERT INTO \`${table}\` (slug, name, sort_order, show_in_nav)
       VALUES (?, ?, ?, 1)`,
      [slug, label, sortOrder]
    );

    return get(pool, slug);
  }

  return { tableName: table, ensureSchema, list, get, create };
}
