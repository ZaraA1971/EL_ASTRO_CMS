import type { APIRoute } from 'astro';
import { buildGeneralSitemapIndexXml, xmlResponse } from '../lib/sitemaps';

export const prerender = false;

/**
 * Index général — URL fraîche à soumettre dans GSC.
 * (évite l’état « type inconnu » collé à /sitemap.xml)
 */
export const GET: APIRoute = async () =>
  xmlResponse(await buildGeneralSitemapIndexXml(), { maxAge: 600 });
