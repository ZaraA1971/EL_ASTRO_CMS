<?php
/**
 * DEPRECATED — WordPress gelé. Ne plus exécuter (nécessitait wp-load.php).
 * SoT = MySQL el_articles / el_users. Voir README.md.
 */
if (PHP_SAPI === 'cli') {
    fwrite(STDERR, "deprecated: WP frozen — script disabled\n");
    exit(1);
}
http_response_code(410);
exit('deprecated');

/**
 * Map WordPress post ID → { fr, en } (IDs publiés uniquement).
 * Usage: php list-translations.php
 */
declare(strict_types=1);

require '/var/www/electronlibre.info/wp-load.php';

global $wpdb;
$rows = $wpdb->get_results(
    "SELECT p.ID AS id,
            MAX(CASE WHEN pm.meta_key = 'original_post_id' THEN pm.meta_value END) AS original_post_id,
            MAX(CASE WHEN pm.meta_key = 'translated_post_id_EN' THEN pm.meta_value END) AS translated_post_id_EN
     FROM {$wpdb->posts} p
     LEFT JOIN {$wpdb->postmeta} pm
       ON pm.post_id = p.ID
      AND pm.meta_key IN ('original_post_id', 'translated_post_id_EN')
     WHERE p.post_type = 'post' AND p.post_status = 'publish'
     GROUP BY p.ID",
    ARRAY_A
);

$published = [];
foreach ($rows as $row) {
    $published[(int) $row['id']] = true;
}

$out = [];
foreach ($rows as $row) {
    $id = (int) $row['id'];
    $orig = (int) ($row['original_post_id'] ?? 0);
    $en = (int) ($row['translated_post_id_EN'] ?? 0);

    if ($orig > 0) {
        $frId = $orig;
        $enId = $id;
    } else {
        $frId = $id;
        $enId = $en;
    }

    $pair = [];
    if ($frId > 0 && isset($published[$frId])) {
        $pair['fr'] = $frId;
    }
    if ($enId > 0 && isset($published[$enId])) {
        $pair['en'] = $enId;
    }
    if (count($pair) > 1) {
        $out[(string) $id] = $pair;
    }
}

echo json_encode($out, JSON_UNESCAPED_UNICODE);
