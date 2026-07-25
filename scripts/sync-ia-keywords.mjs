#!/usr/bin/env node
/**
 * DEPRECATED — ne plus synchroniser le cache WP `_ia_keywords`.
 *
 * Ces mots-clés étaient générés automatiquement à la visite (single-ia.js → RAG)
 * et ne doivent PAS être traités comme des tags éditoriaux.
 *
 * Règle produit :
 * - textes importés → tags WP uniquement (ou rien)
 * - ia_keywords → uniquement quand générés/sauvés depuis le desk
 *
 * Pour générer des mots-clés : desk → Générer (RAG) → Enregistrer.
 */
console.error(
  '[sync-ia-keywords] disabled: WP _ia_keywords cache must not overwrite desk/display keywords.'
);
process.exit(1);
