-- Modèle comptes ElectronLibre (Astro)
-- 4 niveaux : admin · rédacteurs (editor/author) · abonnés (subscriber) · autres (other / anonyme)
-- Ne touche PAS aux tables WP eaxgw_*.

CREATE TABLE IF NOT EXISTS el_users (
  id BIGINT UNSIGNED NOT NULL,
  login VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL,
  display_name VARCHAR(250) NOT NULL DEFAULT '',
  password_hash VARCHAR(255) NOT NULL,
  -- Rôle métier EL (pas le slug WP brut)
  role VARCHAR(32) NOT NULL DEFAULT 'subscriber',
  -- active = droits selon role · disabled = compte bloqué · expired = abo terminé
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  -- NULL = pas de limite (staff + abonnés legacy) · sinon fin d’accès premium
  access_until DATETIME NULL,
  wp_role VARCHAR(32) NULL,
  source VARCHAR(16) NOT NULL DEFAULT 'wp',
  notes TEXT NULL,
  -- Newsletter (opt-in email, indépendant du paywall)
  newsletter_opt_in TINYINT(1) NOT NULL DEFAULT 1,
  newsletter_unsub_token CHAR(32) NULL,
  password_reset_token CHAR(64) NULL,
  password_reset_expires DATETIME NULL,
  registered DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY login (login),
  KEY email (email),
  KEY idx_role_status (role, status),
  KEY idx_access_until (access_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
