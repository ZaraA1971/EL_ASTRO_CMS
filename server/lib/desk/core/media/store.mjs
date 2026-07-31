/**
 * Store médias portable — table injectée par le host.
 */
import { assertSafeSqlIdent } from '../http.mjs';

/**
 * @param {object} opts
 * @param {string} [opts.tableName='media']
 */
export function createMediaStore({ tableName = 'media' } = {}) {
  const table = assertSafeSqlIdent(tableName, 'table médias');
  let ensured = false;

  async function ensureSchema(pool) {
    if (ensured) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`${table}\` (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        path VARCHAR(500) NOT NULL,
        url VARCHAR(600) NOT NULL,
        filename VARCHAR(255) NOT NULL,
        mime VARCHAR(120) NOT NULL DEFAULT '',
        bytes INT UNSIGNED NOT NULL DEFAULT 0,
        width INT UNSIGNED NULL,
        height INT UNSIGNED NULL,
        thumb_path VARCHAR(500) NULL,
        thumb_url VARCHAR(600) NULL,
        alt TEXT NULL,
        source ENUM('legacy','upload') NOT NULL DEFAULT 'upload',
        uploaded_by BIGINT UNSIGNED NULL,
        deleted_at DATETIME NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_path (path),
        KEY idx_created (created_at),
        KEY idx_filename (filename(191)),
        KEY idx_deleted_created (deleted_at, created_at),
        KEY idx_source (source)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    ensured = true;
  }

  async function load(pool, id) {
    await ensureSchema(pool);
    const [rows] = await pool.query(
      `SELECT * FROM \`${table}\` WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  async function list(pool, { q = '', page = 1, perPage = 24 } = {}) {
    await ensureSchema(pool);
    const params = [];
    let where = 'deleted_at IS NULL';
    if (q) {
      where += ' AND (filename LIKE ? OR alt LIKE ? OR path LIKE ?)';
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM \`${table}\` WHERE ${where}`,
      params
    );
    const offset = (page - 1) * perPage;
    // Plus récents en page 1 : date éditoriale (YYYY/MM du path WP/upload), puis created_at, puis id.
    const [rows] = await pool.query(
      `SELECT * FROM \`${table}\` WHERE ${where}
       ORDER BY
         CASE
           WHEN path REGEXP '^[0-9]{4}/[0-9]{2}/'
           THEN CONCAT(SUBSTRING(path, 1, 7), '-01')
           ELSE DATE_FORMAT(created_at, '%Y-%m-%d')
         END DESC,
         created_at DESC,
         id DESC
       LIMIT ? OFFSET ?`,
      [...params, perPage, offset]
    );
    return { rows, total: Number(total) || 0 };
  }

  async function insert(pool, row) {
    await ensureSchema(pool);
    const [result] = await pool.query(
      `INSERT INTO \`${table}\`
        (path, url, filename, mime, bytes, width, height, thumb_path, thumb_url, alt, source, uploaded_by)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'upload', ?)`,
      [
        row.path,
        row.url,
        row.filename,
        row.mime,
        row.bytes,
        row.width,
        row.height,
        row.thumbPath,
        row.thumbUrl,
        row.alt || null,
        row.uploadedBy,
      ]
    );
    return load(pool, result.insertId);
  }

  async function patchAlt(pool, id, alt) {
    await ensureSchema(pool);
    await pool.query(`UPDATE \`${table}\` SET alt = ? WHERE id = ?`, [
      alt || null,
      id,
    ]);
    return load(pool, id);
  }

  async function softDelete(pool, id) {
    await ensureSchema(pool);
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await pool.query(
      `UPDATE \`${table}\` SET deleted_at = ? WHERE id = ?`,
      [now, id]
    );
  }

  return {
    tableName: table,
    ensureSchema,
    load,
    list,
    insert,
    patchAlt,
    softDelete,
  };
}
