import type { APIRoute } from 'astro';
import { buildPagesSitemapXml, xmlResponse } from '../lib/sitemaps';

export const prerender = false;

export const GET: APIRoute = async () =>
  xmlResponse(buildPagesSitemapXml(), { maxAge: 3600 });
