import type { APIRoute } from 'astro';
import { buildPostsSitemapXml, xmlResponse } from '../lib/sitemaps';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const page = Number(params.page || 1);
  const xml = await buildPostsSitemapXml(page);
  if (xml == null) return new Response('Not found', { status: 404 });
  return xmlResponse(xml, { maxAge: 600 });
};
