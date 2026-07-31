/**
 * Store comptes desk — table + plancher d’ids injectés.
 * Pas de hash / mails / newsletter ici.
 *
 * Schéma opinionné (CMS éditorial) : colonnes `wp_role` et `newsletter_opt_in`
 * sont des champs produit courants ; le host peut les ignorer. Pas d’import WP.
 */
import { assertSafeSqlIdent } from '../http.mjs';

const DEFAULT_SELECT = `id, login, email, display_name, role, status, access_until,
            wp_role, source, notes, newsletter_opt_in, registered, updated_at`;

/**
 * @param {object} opts
 * @param {string} [opts.tableName='users']
 * @param {number} [opts.idFloor=900000] — plancher MAX(id)+1
 * @param {string} [opts.selectColumns]
 */
export function createUsersStore({
  tableName = 'users',
  idFloor = 900000,
  selectColumns = DEFAULT_SELECT,
} = {}) {
  const table = assertSafeSqlIdent(tableName, 'table users');
  const select = String(selectColumns || DEFAULT_SELECT);

  async function nextId(pool) {
    const [[row]] = await pool.query(
      `SELECT COALESCE(MAX(id), ?) + 1 AS next_id FROM \`${table}\``,
      [idFloor]
    );
    return Math.max(idFloor + 1, Number(row.next_id));
  }

  async function count(pool, whereSql, params) {
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM \`${table}\` ${whereSql}`,
      params
    );
    return Number(total) || 0;
  }

  async function list(pool, whereSql, params, { limit, offset }) {
    const [rows] = await pool.query(
      `SELECT ${select}
       FROM \`${table}\` ${whereSql}
       ORDER BY COALESCE(updated_at, registered) DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return rows;
  }

  async function findById(pool, id, { withPassword = false } = {}) {
    const cols = withPassword ? `${select}, password_hash` : select;
    const [rows] = await pool.query(
      `SELECT ${cols} FROM \`${table}\` WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  async function findDupLoginOrEmail(pool, login, email, excludeId = null) {
    if (excludeId != null) {
      const [[dup]] = await pool.query(
        `SELECT id FROM \`${table}\` WHERE (email = ? OR login = ?) AND id != ? LIMIT 1`,
        [email, login, excludeId]
      );
      return dup || null;
    }
    const [[dup]] = await pool.query(
      `SELECT id FROM \`${table}\` WHERE login = ? OR email = ? LIMIT 1`,
      [login, email]
    );
    return dup || null;
  }

  async function insert(pool, row) {
    await pool.query(
      `INSERT INTO \`${table}\` (
        id, login, email, display_name, password_hash,
        role, status, access_until, wp_role, source, notes,
        newsletter_opt_in, registered
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        row.id,
        row.login,
        row.email,
        row.displayName,
        row.passwordHash,
        row.role,
        row.status,
        row.accessUntil,
        row.wpRole ?? null,
        row.source ?? 'desk',
        row.notes ?? null,
        row.newsletterOptIn,
        row.registered,
      ]
    );
    return findById(pool, row.id);
  }

  async function update(pool, id, row) {
    await pool.query(
      `UPDATE \`${table}\` SET
        login=?, email=?, display_name=?, password_hash=?,
        role=?, status=?, access_until=?, notes=?, newsletter_opt_in=?
       WHERE id=?`,
      [
        row.login,
        row.email,
        row.displayName,
        row.passwordHash,
        row.role,
        row.status,
        row.accessUntil,
        row.notes,
        row.newsletterOptIn,
        id,
      ]
    );
    return findById(pool, id);
  }

  async function updatePassword(pool, id, passwordHash) {
    await pool.query(
      `UPDATE \`${table}\` SET password_hash = ? WHERE id = ?`,
      [passwordHash, id]
    );
    return findById(pool, id);
  }

  async function remove(pool, id) {
    await pool.query(`DELETE FROM \`${table}\` WHERE id = ?`, [id]);
  }

  async function countActiveAdmins(pool, adminRoles = ['admin', 'administrator']) {
    for (const r of adminRoles) {
      if (!/^[a-z0-9_]+$/i.test(r)) {
        throw new Error('adminRoles invalides');
      }
    }
    const placeholders = adminRoles.map(() => '?').join(', ');
    const [[{ n }]] = await pool.query(
      `SELECT COUNT(*) AS n FROM \`${table}\`
       WHERE role IN (${placeholders}) AND status = 'active'`,
      adminRoles
    );
    return Number(n) || 0;
  }

  return {
    tableName: table,
    selectColumns: select,
    nextId,
    count,
    list,
    findById,
    findDupLoginOrEmail,
    insert,
    update,
    updatePassword,
    remove,
    countActiveAdmins,
  };
}
