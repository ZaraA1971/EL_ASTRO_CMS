/** Catégories EL (slugs WP) */
export const CATEGORIES: { slug: string; name: string }[] = [
  { slug: 'web_1_2_3', name: 'Web 1,2,3' },
  { slug: 'so_cult', name: 'Culture' },
  { slug: 'peer2peer', name: 'Piratage' },
  { slug: 'old_fashion_media', name: 'Médias' },
  { slug: 'so_amazing', name: 'High-Tech' },
  { slug: 'robotic', name: 'Robotic' },
  { slug: 'gaming', name: 'Gaming' },
  { slug: 'le_flouze', name: 'Economie' },
  { slug: 'politique', name: 'Politique' },
  { slug: 'marketing_room', name: 'Marketing' },
  { slug: 'paper', name: 'Papers' },
];

export function categoryName(slug: string): string {
  return CATEGORIES.find((c) => c.slug === slug)?.name || slug;
}
