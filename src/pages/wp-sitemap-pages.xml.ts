import type { APIRoute } from 'astro';
import { STATIC_URLS, buildUrlset, xmlResponse } from '../lib/sitemaps';

export const prerender = false;

export const GET: APIRoute = async () => {
  return xmlResponse(buildUrlset(STATIC_URLS), { maxAge: 3600 });
};
