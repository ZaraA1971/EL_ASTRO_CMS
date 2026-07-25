<?php
/**
 * Synchronise comptes WP → el_users (hashes préservés).
 * Mappe les rôles WP vers le modèle EL (admin/editor/author/subscriber/other).
 * CLI: php scripts/sync-el-users.php
 * Ne modifie PAS les tables WP.
 */
if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "CLI only\n");
    exit(1);
}

require '/var/www/electronlibre.info/wp-load.php';
require_once __DIR__ . '/migrate-el-users-model.php';
global $wpdb;

el_migrate_users_model($wpdb);

function el_map_wp_role(string $wpRole): string
{
    $map = [
        'administrator' => 'admin',
        'editor' => 'editor',
        'author' => 'author',
        'contributor' => 'other',
        'subscriber' => 'subscriber',
    ];
    return $map[strtolower($wpRole)] ?? 'other';
}

function el_sql_nullable($value): string
{
    global $wpdb;
    if ($value === null || $value === '') {
        return 'NULL';
    }
    return $wpdb->prepare('%s', $value);
}

$users = get_users([
    'fields' => 'all',
    'role__in' => ['subscriber', 'author', 'editor', 'administrator', 'contributor'],
]);

$upsert = 0;
foreach ($users as $u) {
    $roles = (array) $u->roles;
    $wpRole = $roles[0] ?? 'subscriber';
    $elRole = el_map_wp_role($wpRole);
    $id = (int) $u->ID;

    $existing = $wpdb->get_row(
        $wpdb->prepare(
            'SELECT status, access_until, notes, source, role FROM el_users WHERE id = %d',
            $id
        ),
        ARRAY_A
    );

    $status = $existing['status'] ?? 'active';
    $accessUntil = array_key_exists('access_until', (array) $existing)
        ? $existing['access_until']
        : null;
    $notes = array_key_exists('notes', (array) $existing) ? $existing['notes'] : null;
    $source = ($existing['source'] ?? 'wp') === 'desk' ? 'desk' : 'wp';
    $role = $source === 'desk' && !empty($existing['role'])
        ? $existing['role']
        : $elRole;

    $sql = $wpdb->prepare(
        'INSERT INTO el_users (
            id, login, email, display_name, password_hash,
            role, status, wp_role, source, registered, access_until, notes
        ) VALUES (
            %d, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, ',
        $id,
        $u->user_login,
        $u->user_email,
        $u->display_name,
        $u->user_pass,
        $role,
        $status,
        $wpRole,
        $source,
        $u->user_registered
    );
    $sql .= el_sql_nullable($accessUntil) . ', ' . el_sql_nullable($notes) . ')
        ON DUPLICATE KEY UPDATE
          login = VALUES(login),
          email = VALUES(email),
          display_name = VALUES(display_name),
          password_hash = VALUES(password_hash),
          role = VALUES(role),
          status = VALUES(status),
          wp_role = VALUES(wp_role),
          source = VALUES(source),
          registered = VALUES(registered),
          access_until = VALUES(access_until),
          notes = VALUES(notes)';

    $wpdb->query($sql);
    $upsert++;
}

$counts = $wpdb->get_results(
    'SELECT role, status, COUNT(*) AS n FROM el_users GROUP BY role, status ORDER BY role, status',
    ARRAY_A
);
$total = (int) $wpdb->get_var('SELECT COUNT(*) FROM el_users');

echo json_encode([
    'synced' => $upsert,
    'total' => $total,
    'counts' => $counts,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), "\n";
