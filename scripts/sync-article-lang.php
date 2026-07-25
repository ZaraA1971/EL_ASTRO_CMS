<?php
/**
 * Met à jour le champ `lang:` des markdown Astro depuis les meta WP
 * (original_post_id présent = EN, sinon FR).
 *
 * Important: ne pas utiliser preg_replace avec une chaîne de remplacement
 * contenant le frontmatter (les $ du texte seraient des backrefs).
 */
declare(strict_types=1);

$wpLoad = '/var/www/electronlibre.info/wp-load.php';
$dir = '/var/www/el-astro/src/content/articles';

if (!is_file($wpLoad)) {
    fwrite(STDERR, "wp-load.php introuvable\n");
    exit(1);
}

require $wpLoad;

$files = glob($dir . '/*.md') ?: [];
$updated = 0;
$fr = 0;
$en = 0;

foreach ($files as $file) {
    $base = basename($file);
    if (!preg_match('/^(\d+)-/', $base, $m)) {
        continue;
    }
    $wpId = (int) $m[1];
    $orig = get_post_meta($wpId, 'original_post_id', true);
    $lang = $orig ? 'en' : 'fr';
    if ($lang === 'en') {
        $en++;
    } else {
        $fr++;
    }

    $raw = file_get_contents($file);
    if ($raw === false) {
        continue;
    }

    if (!preg_match('/\A---\r?\n(.*?)\r?\n---\r?\n(.*)\z/s', $raw, $parts)) {
        continue;
    }

    $front = $parts[1];
    $body = $parts[2];

    if (preg_match('/^lang:\s*.+$/m', $front)) {
        $newFront = preg_replace('/^lang:\s*.+$/m', 'lang: ' . $lang, $front, 1);
    } else {
        $newFront = rtrim($front) . "\nlang: " . $lang . "\n";
    }

    if ($newFront === $front) {
        continue;
    }

    // Concaténation seule — pas de preg_replace sur le contenu (évite $75 → backref)
    $newRaw = "---\n" . $newFront . "\n---\n" . $body;
    file_put_contents($file, $newRaw);
    $updated++;
}

echo "[sync-lang] files=" . count($files) . " updated={$updated} fr={$fr} en={$en}\n";
