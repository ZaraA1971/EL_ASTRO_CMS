/**
 * Table el_x_posts — brouillons et publications X depuis le Pupitre.
 */

let ensured = false;

export async function ensureXPostsSchema(pool) {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS el_x_posts (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      article_id BIGINT UNSIGNED NOT NULL,
      account VARCHAR(32) NOT NULL,
      text MEDIUMTEXT NOT NULL,
      variants_json JSON NULL,
      tweet_id VARCHAR(64) NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'draft',
      error VARCHAR(500) NULL,
      actor_id BIGINT UNSIGNED NULL,
      actor_login VARCHAR(60) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      posted_at DATETIME NULL,
      PRIMARY KEY (id),
      KEY idx_article (article_id),
      KEY idx_article_account (article_id, account),
      KEY idx_status (status),
      KEY idx_tweet (tweet_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  ensured = true;
}
