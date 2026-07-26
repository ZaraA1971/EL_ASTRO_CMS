/**
 * Ensure table el_media (idempotent).
 */

let ensured = false;

export async function ensureMediaSchema(pool) {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS el_media (
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
