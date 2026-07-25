<?php
/**
 * Map wp_id → mots-clés IA (_ia_keywords).
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
