import type { APIRoute } from 'astro';
import {
  articleLoc,
  buildUrlset,
  isoDate,
  listPublishedArticlesPage,
  xmlResponse,
} from '../lib/sitemaps';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const page = Number(params.page || 1);
  if (!Number.isFinite(page) || page < 1) {
    return new Response('Not found', { status: 404 });
  }
  const rows = await listPublishedArticlesPage(page);
  if (!rows.length && page > 1) {
    return new Response('Not found', { status: 404 });
  }
  const urls = rows.map((r) => ({
    loc: articleLoc(Number(r.wp_id), String(r.slug)),
    lastmod: isoDate(r.modified || r.date),
  }));
  return xmlResponse(buildUrlset(urls), { maxAge: 600 });
};
