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
 * Map wp_id → lang (fr|en) via meta original_post_id.
 * Usage: php list-post-langs.php
 */
declare(strict_types=1);

require '/var/www/electronlibre.info/wp-load.php';

global $wpdb;
$rows = $wpdb->get_results(
    "SELECT p.ID AS id, pm.meta_value AS original_post_id
     FROM {$wpdb->posts} p
     LEFT JOIN {$wpdb->postmeta} pm
       ON pm.post_id = p.ID AND pm.meta_key = 'original_post_id'
     WHERE p.post_type = 'post' AND p.post_status = 'publish'",
    ARRAY_A
);

$out = [];
foreach ($rows as $row) {
    $id = (int) $row['id'];
    $out[(string) $id] = !empty($row['original_post_id']) ? 'en' : 'fr';
}

echo json_encode($out, JSON_UNESCAPED_UNICODE);
