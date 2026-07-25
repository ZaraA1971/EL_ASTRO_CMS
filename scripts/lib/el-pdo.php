<?php
/**
 * PDO MySQL partagé pour scripts CLI Astro (sans WordPress).
 * Lit /etc/electronlibre/el-astro-api.env (même BDD que eaxgw_* / el_*).
 */

function el_load_env_file(string $file): array
{
    $out = [];
    if (!is_readable($file)) {
        return $out;
    }
    foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }
        if (!preg_match('/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/', $line, $m)) {
            continue;
        }
        $v = trim($m[2]);
        if (
            (str_starts_with($v, '"') && str_ends_with($v, '"')) ||
            (str_starts_with($v, "'") && str_ends_with($v, "'"))
        ) {
            $v = substr($v, 1, -1);
        }
        $out[$m[1]] = $v;
    }
    return $out;
}

function el_pdo(?string $envFile = null): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $envFile = $envFile
        ?: (getenv('EL_API_ENV_FILE') ?: '/etc/electronlibre/el-astro-api.env');
    $fileEnv = el_load_env_file($envFile);

    $host = getenv('EL_DB_HOST') ?: ($fileEnv['EL_DB_HOST'] ?? 'localhost');
    $user = getenv('EL_DB_USER') ?: ($fileEnv['EL_DB_USER'] ?? '');
    $pass = getenv('EL_DB_PASSWORD') ?: ($fileEnv['EL_DB_PASSWORD'] ?? '');
    $name = getenv('EL_DB_NAME') ?: ($fileEnv['EL_DB_NAME'] ?? 'electronlibre');

    if ($user === '') {
        throw new RuntimeException("DB user manquant ({$envFile})");
    }

    $dsn = "mysql:host={$host};dbname={$name};charset=utf8mb4";
    $pdo = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    return $pdo;
}

/** Préfixe tables WordPress legacy (lecture seule côté sync). */
function el_wp_prefix(): string
{
    return getenv('EL_WP_TABLE_PREFIX') ?: 'eaxgw_';
}
