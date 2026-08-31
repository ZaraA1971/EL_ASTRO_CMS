import type { APIRoute } from 'astro';
import { buildGeneralSitemapIndexXml, xmlResponse } from '../lib/sitemaps';

export const prerender = false;

/** Alias de /sitemap_index.xml (soumettre plutôt sitemap_index.xml en GSC). */
export const GET: APIRoute = async () =>
  xmlResponse(await buildGeneralSitemapIndexXml(), { maxAge: 600 });
