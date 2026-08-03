-- Rubriques éditoriales (archives + nav + pupitre)
-- Source : shared/categories.mjs (DEFAULT_CATEGORIES + DDL)
CREATE TABLE IF NOT EXISTS `el_categories` (
slug VARCHAR(64) NOT NULL,
  name VARCHAR(120) NOT NULL,
  sort_order INT NOT NULL DEFAULT 100,
  show_in_nav TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (slug),
  KEY idx_sort (sort_order),
  KEY idx_nav_sort (show_in_nav, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO el_categories (slug, name, sort_order, show_in_nav) VALUES ('web_1_2_3', 'Web 1,2,3', 10, 1);
INSERT IGNORE INTO el_categories (slug, name, sort_order, show_in_nav) VALUES ('so_cult', 'Culture', 20, 1);
INSERT IGNORE INTO el_categories (slug, name, sort_order, show_in_nav) VALUES ('peer2peer', 'Piratage', 30, 1);
INSERT IGNORE INTO el_categories (slug, name, sort_order, show_in_nav) VALUES ('old_fashion_media', 'Médias', 40, 1);
INSERT IGNORE INTO el_categories (slug, name, sort_order, show_in_nav) VALUES ('so_amazing', 'High-Tech', 50, 1);
INSERT IGNORE INTO el_categories (slug, name, sort_order, show_in_nav) VALUES ('robotic', 'Robotic', 60, 1);
INSERT IGNORE INTO el_categories (slug, name, sort_order, show_in_nav) VALUES ('gaming', 'Gaming', 70, 1);
INSERT IGNORE INTO el_categories (slug, name, sort_order, show_in_nav) VALUES ('le_flouze', 'Economie', 80, 1);
INSERT IGNORE INTO el_categories (slug, name, sort_order, show_in_nav) VALUES ('politique', 'Politique', 90, 1);
INSERT IGNORE INTO el_categories (slug, name, sort_order, show_in_nav) VALUES ('marketing_room', 'Marketing', 100, 1);
INSERT IGNORE INTO el_categories (slug, name, sort_order, show_in_nav) VALUES ('paper', 'Papers', 110, 0);
