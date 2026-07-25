<?php
/**
 * Migration modèle el_users → rôles EL + status + access_until.
 * CLI: php scripts/migrate-el-users-model.php
 * Ne touche PAS aux tables WP.
 */
if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "CLI only\n");
    exit(1);
}

require '/var/www/electronlibre.info/wp-load.php';
global $wpdb;

/**
 * @return array{altered:int, updated:int, counts:array}
 */
function el_migrate_users_model(wpdb $wpdb): array
{
    $table = 'el_users';
    $exists = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table));
    if (!$exists) {
        $sql = file_get_contents(__DIR__ . '/sql/el_users.sql');
        $wpdb->query($sql);
        return ['altered' => -1, 'updated' => 0, 'counts' => []];
    }

    $cols = $wpdb->get_col("SHOW COLUMNS FROM {$table}", 0);
    $have = array_flip($cols ?: []);

    $alters = [];
    if (!isset($have['status'])) {
        $alters[] = "ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'active' AFTER role";
    }
    if (!isset($have['access_until'])) {
        $alters[] = 'ADD COLUMN access_until DATETIME NULL AFTER status';
    }
    if (!isset($have['wp_role'])) {
        $alters[] = 'ADD COLUMN wp_role VARCHAR(32) NULL AFTER access_until';
    }
    if (!isset($have['source'])) {
        $alters[] = "ADD COLUMN source VARCHAR(16) NOT NULL DEFAULT 'wp' AFTER wp_role";
    }
    if (!isset($have['notes'])) {
        $alters[] = 'ADD COLUMN notes TEXT NULL AFTER source';
    }
    if (!isset($have['created_at'])) {
        $alters[] = 'ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP';
    }
    if (!isset($have['updated_at'])) {
        $alters[] = 'ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP';
    }

    if ($alters) {
        $wpdb->query('ALTER TABLE el_users ' . implode(', ', $alters));
    }

    $indexRows = $wpdb->get_results('SHOW INDEX FROM el_users', ARRAY_A) ?: [];
    $indexSet = [];
    foreach ($indexRows as $idx) {
        $indexSet[$idx['Key_name']] = true;
    }
    if (!isset($indexSet['idx_role_status'])) {
        $wpdb->query('ALTER TABLE el_users ADD INDEX idx_role_status (role, status)');
    }
    if (!isset($indexSet['idx_access_until'])) {
        $wpdb->query('ALTER TABLE el_users ADD INDEX idx_access_until (access_until)');
    }

    $map = [
        'administrator' => 'admin',
        'admin' => 'admin',
        'editor' => 'editor',
        'author' => 'author',
        'contributor' => 'other',
        'subscriber' => 'subscriber',
        'other' => 'other',
    ];
    $wpSlugs = ['administrator', 'editor', 'author', 'contributor', 'subscriber'];

    $rows = $wpdb->get_results('SELECT id, role, wp_role, status, source FROM el_users', ARRAY_A) ?: [];
    $updated = 0;
    foreach ($rows as $row) {
        $current = strtolower((string) $row['role']);
        $storeWp = $row['wp_role'] ?: null;
        if (!$storeWp && in_array($current, $wpSlugs, true)) {
            $storeWp = $current;
        }
        if (!$storeWp && $current === 'admin') {
            $storeWp = 'administrator';
        }

        $elRole = $map[$current] ?? 'other';
        $status = $row['status'] ?: 'active';
        $source = $row['source'] ?: 'wp';

        $wpdb->update(
            'el_users',
            [
                'role' => $elRole,
                'wp_role' => $storeWp,
                'status' => $status,
                'source' => $source,
            ],
            ['id' => (int) $row['id']]
        );
        $updated++;
    }

    $counts = $wpdb->get_results(
        'SELECT role, status, COUNT(*) AS n FROM el_users GROUP BY role, status',
        ARRAY_A
    ) ?: [];

    return [
        'altered' => count($alters),
        'updated' => $updated,
        'counts' => $counts,
    ];
}

// Exécution CLI directe
if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === realpath(__FILE__)) {
    echo json_encode(el_migrate_users_model($wpdb), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), "\n";
}
