/**
 * Collections Astro — volontairement vides.
 * Source de vérité articles = MySQL `el_articles` (`src/lib/articles.ts`).
 * Les MD sous `src/content/articles/` ne sont qu’une archive d’import
 * (`npm run import:articles:db`) et ne doivent pas être indexés au build.
 */
export const collections = {};
