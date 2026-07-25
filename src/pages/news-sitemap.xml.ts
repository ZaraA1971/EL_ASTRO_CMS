import type { APIRoute } from 'astro';
import {
  buildNewsSitemap,
  listNewsArticles,
  xmlResponse,
} from '../lib/sitemaps';

export const prerender = false;

/** Google News — articles des 2 derniers jours. */
export const GET: APIRoute = async () => {
  const rows = await listNewsArticles();
  return xmlResponse(buildNewsSitemap(rows), { maxAge: 300 });
};
