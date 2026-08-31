import type { APIRoute } from 'astro';

export const prerender = false;

/** URL historique WP — Google la crawlait déjà avec succès. */
const BODY = `User-agent: *
Allow: /

Disallow: /desk/
Disallow: /api/
Disallow: /login/

Sitemap: https://electronlibre.info/wp-sitemap.xml
Sitemap: https://electronlibre.info/news-sitemap.xml
`;

export const GET: APIRoute = async () =>
  new Response(BODY, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=60, must-revalidate',
    },
  });
