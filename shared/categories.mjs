/**
 * Rubriques ElectronLibre — source unique des builtins + helpers slug.
 * Persistance runtime : table el_categories (server/lib/categories.mjs).
 */

export const DEFAULT_CATEGORIES = Object.freeze([
  { slug: 'web_1_2_3', name: 'Web 1,2,3', sort_order: 10, show_in_nav: true },
  { slug: 'so_cult', name: 'Culture', sort_order: 20, show_in_nav: true },
  { slug: 'peer2peer', name: 'Piratage', sort_order: 30, show_in_nav: true },
  { slug: 'old_fashion_media', name: 'Médias', sort_order: 40, show_in_nav: true },
  { slug: 'so_amazing', name: 'High-Tech', sort_order: 50, show_in_nav: true },
  { slug: 'robotic', name: 'Robotic', sort_order: 60, show_in_nav: true },
  { slug: 'gaming', name: 'Gaming', sort_order: 70, show_in_nav: true },
  { slug: 'le_flouze', name: 'Economie', sort_order: 80, show_in_nav: true },
  { slug: 'politique', name: 'Politique', sort_order: 90, show_in_nav: true },
  { slug: 'marketing_room', name: 'Marketing', sort_order: 100, show_in_nav: true },
  { slug: 'paper', name: 'Papers', sort_order: 110, show_in_nav: false },
]);

/** Slug WP-style : a-z 0-9 _ */
export function slugifyCategoryName(name) {
  const base = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return base || 'rubrique';
}

export function categoryNameFromList(list, slug) {
  const s = String(slug || '');
  const hit = (list || []).find((c) => c.slug === s);
  return hit?.name || s;
}
