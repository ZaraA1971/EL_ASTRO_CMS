<?php
/**
 * Sync WP → el_users — DÉSACTIVÉ.
 * WordPress n’est plus utilisé : source de vérité = el_users (pupitre /desk/).
 *
 * Historique : lecture SQL eaxgw_users (sans wp-load). Conservé pour référence.
 * Relancer un import one-shot : EL_SYNC_USERS_FORCE=1 php scripts/sync-el-users.php
 */
if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "CLI only\n");
    exit(1);
}

if (getenv('EL_SYNC_USERS_FORCE') !== '1') {
    echo json_encode([
        'ok' => true,
        'skipped' => true,
        'reason' => 'WP sync disabled — el_users is source of truth (desk)',
    ], JSON_UNESCAPED_UNICODE), "\n";
    exit(0);
}

require_once __DIR__ . '/lib/el-pdo.php';
require_once __DIR__ . '/migrate-el-users-model.php';

$pdo = el_pdo();
el_migrate_users_model($pdo);

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

function el_parse_wp_capabilities(?string $serialized): ?string
{
    if ($serialized === null || $serialized === '') {
        return null;
    }
    $caps = @unserialize($serialized, ['allowed_classes' => false]);
    if (!is_array($caps) || !$caps) {
        return null;
    }
    foreach (['administrator', 'editor', 'author', 'contributor', 'subscriber'] as $role) {
        if (!empty($caps[$role])) {
            return $role;
        }
    }
    return null;
}

$prefix = el_wp_prefix();
$usersTable = $prefix . 'users';
$metaTable = $prefix . 'usermeta';
$capsKey = $prefix . 'capabilities';

$st = $pdo->prepare(
    "SELECT u.ID, u.user_login, u.user_email, u.display_name, u.user_pass, u.user_registered,
            m.meta_value AS caps
     FROM `{$usersTable}` u
     INNER JOIN `{$metaTable}` m
       ON m.user_id = u.ID AND m.meta_key = ?
     ORDER BY u.ID ASC"
);
$st->execute([$capsKey]);

$selExisting = $pdo->prepare(
    'SELECT status, access_until, notes, source, role FROM el_users WHERE id = ?'
);
$ins = $pdo->prepare(
    'INSERT INTO el_users (
    id, login, email, display_name, password_hash,
    role, status, wp_role, source, registered, access_until, notes
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
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
    notes = VALUES(notes)'
);

$allowed = array_flip(['administrator', 'editor', 'author', 'contributor', 'subscriber']);
$upsert = 0;
$skipped = 0;
while ($u = $st->fetch()) {
    $wpRole = el_parse_wp_capabilities($u['caps'] ?? null);
    if ($wpRole === null || !isset($allowed[$wpRole])) {
        $skipped++;
        continue;
    }
    $elRole = el_map_wp_role($wpRole);
    $id = (int) $u['ID'];
    $selExisting->execute([$id]);
    $existing = $selExisting->fetch() ?: null;
    $status = $existing['status'] ?? 'active';
    $accessUntil = array_key_exists('access_until', (array) $existing)
        ? $existing['access_until']
        : null;
    $notes = array_key_exists('notes', (array) $existing) ? $existing['notes'] : null;
    $source = ($existing['source'] ?? 'wp') === 'desk' ? 'desk' : 'wp';
    $role = $source === 'desk' && !empty($existing['role'])
        ? $existing['role']
        : $elRole;
    $ins->execute([
        $id,
        $u['user_login'],
        $u['user_email'],
        $u['display_name'],
        $u['user_pass'],
        $role,
        $status,
        $wpRole,
        $source,
        $u['user_registered'],
        $accessUntil,
        $notes,
    ]);
    $upsert++;
}

$counts = $pdo
    ->query('SELECT role, status, COUNT(*) AS n FROM el_users GROUP BY role, status ORDER BY role, status')
    ->fetchAll();
$total = (int) $pdo->query('SELECT COUNT(*) FROM el_users')->fetchColumn();

echo json_encode([
    'synced' => $upsert,
    'skipped' => $skipped,
    'total' => $total,
    'counts' => $counts,
    'via' => 'pdo-force',
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), "\n";
