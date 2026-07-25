import type { APIRoute } from 'astro';
import {
  SITE,
  SITEMAP_PAGE_SIZE,
  buildSitemapIndex,
  countPublishedArticles,
  xmlResponse,
} from '../lib/sitemaps';

export const prerender = false;

/** Index compatible Google Search Console (ex-WP `/wp-sitemap.xml`). */
export const GET: APIRoute = async () => {
  const total = await countPublishedArticles();
  const pages = Math.max(1, Math.ceil(total / SITEMAP_PAGE_SIZE));
  const locs = [`${SITE}/wp-sitemap-pages.xml`];
  for (let i = 1; i <= pages; i += 1) {
    locs.push(`${SITE}/wp-sitemap-posts-${i}.xml`);
  }
  return xmlResponse(buildSitemapIndex(locs), { maxAge: 600 });
};
