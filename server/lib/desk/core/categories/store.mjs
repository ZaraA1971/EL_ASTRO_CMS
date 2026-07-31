/**
 * Store rubriques portable — table + defaults injectés par le host.
 */
import { assertSafeSqlIdent } from '../http.mjs';

function defaultSlugify(name) {
  const base = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return base || 'rubrique';
}

function rowToCategory(row) {
  return {
    slug: String(row.slug),
    name: String(row.name),
    sort_order: Number(row.sort_order) || 0,
    show_in_nav: Boolean(row.show_in_nav),
  };
}

/**
 * @param {object} opts
 * @param {string} [opts.tableName='categories']
 * @param {Array<{slug:string,name:string,sort_order?:number,show_in_nav?:boolean}>} [opts.defaults]
 * @param {(name: string) => string} [opts.slugify]
 */
export function createCategoriesStore({
  tableName = 'categories',
  defaults = [],
  slugify = defaultSlugify,
} = {}) {
  const table = assertSafeSqlIdent(tableName, 'table catégories');
  let ensured = false;

  async function ensureSchema(pool) {
    if (ensured) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`${table}\` (
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
    for (const c of defaults) {
      await pool.query(
        `INSERT IGNORE INTO \`${table}\` (slug, name, sort_order, show_in_nav)
         VALUES (?, ?, ?, ?)`,
        [c.slug, c.name, c.sort_order ?? 100, c.show_in_nav ? 1 : 0]
      );
    }
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
