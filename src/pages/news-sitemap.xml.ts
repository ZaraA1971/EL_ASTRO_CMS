import type { APIRoute } from 'astro';
import { buildNewsSitemapXml, xmlResponse } from '../lib/sitemaps';

export const prerender = false;

/** Sitemap Google News — 2ᵉ URL à soumettre. */
export const GET: APIRoute = async () =>
  xmlResponse(await buildNewsSitemapXml(), { maxAge: 300 });
