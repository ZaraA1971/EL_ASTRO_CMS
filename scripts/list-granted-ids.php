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
 * Liste les post IDs avec access_control=granted (CLI only).
 * Usage: php scripts/list-granted-ids.php
 */
if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "CLI only\n");
    exit(1);
}

require '/var/www/electronlibre.info/wp-load.php';

$q = new WP_Query([
    'post_type' => 'post',
    'post_status' => 'publish',
    'posts_per_page' => -1,
    'fields' => 'ids',
    'tax_query' => [[
        'taxonomy' => 'access_control',
        'field' => 'slug',
        'terms' => ['granted'],
    ]],
    'no_found_rows' => true,
]);

echo json_encode(array_map('intval', $q->posts), JSON_UNESCAPED_SLASHES), "\n";
