<?php
/**
 * Migration modèle el_users → rôles EL + status + access_until.
 * CLI: php scripts/migrate-el-users-model.php
 * Sans WordPress (PDO direct).
 */
if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "CLI only\n");
    exit(1);
}

require_once __DIR__ . '/lib/el-pdo.php';

/**
 * @return array{altered:int, updated:int, counts:array}
 */
function el_migrate_users_model(PDO $pdo): array
{
    $exists = $pdo->query("SHOW TABLES LIKE 'el_users'")->fetchColumn();
    if (!$exists) {
        $sql = file_get_contents(__DIR__ . '/sql/el_users.sql');
        $pdo->exec($sql);
        return ['altered' => -1, 'updated' => 0, 'counts' => []];
    }

    $cols = $pdo->query('SHOW COLUMNS FROM el_users')->fetchAll(PDO::FETCH_COLUMN, 0);
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
        $pdo->exec('ALTER TABLE el_users ' . implode(', ', $alters));
    }

    $indexRows = $pdo->query('SHOW INDEX FROM el_users')->fetchAll() ?: [];
    $indexSet = [];
    foreach ($indexRows as $idx) {
        $indexSet[$idx['Key_name']] = true;
    }
    if (!isset($indexSet['idx_role_status'])) {
        $pdo->exec('ALTER TABLE el_users ADD INDEX idx_role_status (role, status)');
    }
    if (!isset($indexSet['idx_access_until'])) {
        $pdo->exec('ALTER TABLE el_users ADD INDEX idx_access_until (access_until)');
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

    $rows = $pdo->query('SELECT id, role, wp_role, status, source FROM el_users')->fetchAll() ?: [];
    $updated = 0;
    $upd = $pdo->prepare(
        'UPDATE el_users SET role = ?, wp_role = ?, status = ?, source = ? WHERE id = ?'
    );
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

        $upd->execute([$elRole, $storeWp, $status, $source, (int) $row['id']]);
        $updated++;
    }

    $counts = $pdo
        ->query('SELECT role, status, COUNT(*) AS n FROM el_users GROUP BY role, status')
        ->fetchAll() ?: [];

    return [
        'altered' => count($alters),
        'updated' => $updated,
        'counts' => $counts,
    ];
}

// Exécution CLI directe
if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === realpath(__FILE__)) {
    echo json_encode(
        el_migrate_users_model(el_pdo()),
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    ), "\n";
}
