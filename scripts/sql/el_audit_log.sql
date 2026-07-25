-- Journal d’audit pupitre (créé aussi automatiquement au runtime)
CREATE TABLE IF NOT EXISTS el_audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  at DATETIME NOT NULL,
  actor_id BIGINT UNSIGNED NULL,
  actor_login VARCHAR(60) NULL,
  action VARCHAR(64) NOT NULL,
  target_type VARCHAR(32) NULL,
  target_id VARCHAR(64) NULL,
  meta JSON NULL,
  ip VARCHAR(64) NULL,
  PRIMARY KEY (id),
  KEY idx_at (at),
  KEY idx_action (action),
  KEY idx_actor (actor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
