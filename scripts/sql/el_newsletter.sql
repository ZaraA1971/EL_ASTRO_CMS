-- Newsletter EL (indépendante WP / ALO)
-- Colonnes opt-in sur el_users + campagnes + destinataires

ALTER TABLE el_users
  ADD COLUMN IF NOT EXISTS newsletter_opt_in TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS newsletter_unsub_token CHAR(32) NULL;

CREATE TABLE IF NOT EXISTS el_newsletters (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  editorial_date DATE NOT NULL,
  lang VARCHAR(8) NOT NULL DEFAULT 'fr',
  subject VARCHAR(500) NOT NULL,
  html LONGTEXT NOT NULL,
  groups_json JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  article_ids_json JSON NULL,
  created_by BIGINT UNSIGNED NULL,
  sent_at DATETIME NULL,
  stats_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_status_date (status, editorial_date),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS el_newsletter_recipients (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  newsletter_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  email VARCHAR(190) NOT NULL,
  result VARCHAR(16) NOT NULL DEFAULT 'pending',
  brevo_message_id VARCHAR(120) NULL,
  error VARCHAR(500) NULL,
  sent_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_nl (newsletter_id),
  KEY idx_nl_result (newsletter_id, result),
  KEY idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
