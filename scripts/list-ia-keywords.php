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
 * Map WordPress post ID → mots-clés IA (_ia_keywords).
 * Usage: php list-ia-keywords.php
 */
declare(strict_types=1);

require '/var/www/electronlibre.info/wp-load.php';

global $wpdb;
$rows = $wpdb->get_results(
    "SELECT post_id, meta_value
     FROM {$wpdb->postmeta}
     WHERE meta_key = '_ia_keywords'",
    ARRAY_A
);

$out = [];
foreach ($rows as $row) {
    $id = (string) (int) $row['post_id'];
    $raw = maybe_unserialize($row['meta_value']);
    if (!is_array($raw)) {
        continue;
    }
    $keywords = array_values(array_filter(array_map('strval', $raw)));
    if ($keywords !== []) {
        $out[$id] = $keywords;
    }
}

echo json_encode($out, JSON_UNESCAPED_UNICODE);
