/**
 * Desk Audience — port du plugin WP electronlibre-audience-patch.
 * GET  /api/desk/audience
 * POST /api/desk/audience/refresh
 */
import { canPublish } from '../roles.mjs';
import { auditLog } from '../audit.mjs';
import { articlePath } from '../article-path.mjs';
import {
  extractGraphData,
  flushAudienceCache,
  getHits,
  getTopReferrers,
  getTotal,
  goatcounterConfigured,
  hitCount,
  normalizeHits,
  normalizeReferrers,
  parseGoatPath,
  sumViewsFromStats,
  utcYmdDaysAgo,
  withAudienceCache,
} from '../goatcounter.mjs';

async function enrichHitsWithArticles(pool, hits) {
  const parsed = hits.map((row) => ({
    row,
    ...parseGoatPath(row?.path),
    views: hitCount(row),
    title: String(row?.title || '').trim(),
  }));

  const articleIds = [...new Set(parsed.map((p) => p.articleId).filter(Boolean))];
  const slugs = [
    ...new Set(parsed.filter((p) => !p.articleId && p.slug).map((p) => p.slug)),
  ];

  /** @type {Map<number, any>} */
  const byId = new Map();
  /** @type {Map<string, any>} */
  const bySlug = new Map();

  if (articleIds.length) {
    const [rows] = await pool.query(
      `SELECT article_id, slug, title, draft, access
       FROM el_articles WHERE article_id IN (?)`,
      [articleIds]
    );
    for (const r of rows) byId.set(Number(r.article_id), r);
  }

  if (slugs.length) {
    const [rows] = await pool.query(
      `SELECT article_id, slug, title, draft, access
       FROM el_articles WHERE slug IN (?)`,
      [slugs]
    );
    for (const r of rows) {
      const key = String(r.slug);
      if (!bySlug.has(key)) bySlug.set(key, r);
    }
  }

  return parsed.map((p) => {
    const art =
      (p.articleId && byId.get(p.articleId)) ||
      (p.slug && bySlug.get(p.slug)) ||
      null;
    const articleId = art ? Number(art.article_id) : p.articleId;
    const slug = art ? String(art.slug) : p.slug;
    const href =
      articleId && slug
        ? articlePath(articleId, slug)
        : p.pathname || null;
    return {
      path: p.path,
      pathname: p.pathname || null,
      title: (art && art.title) || p.title || '(sans titre)',
      views: p.views,
      articleId: articleId || null,
      slug: slug || null,
      href,
      draft: art ? Number(art.draft) === 1 : null,
      access: art ? art.access : null,
    };
  });
}

export async function buildAudiencePayload(pool, goatcounter) {
  const start = utcYmdDaysAgo(30);

  const summary = await withAudienceCache('summary', () =>
    getTotal(goatcounter, { start })
  );

  if (!summary) {
    return {
      ok: false,
      configured: goatcounterConfigured(goatcounter),
      error: 'Données indisponibles — GoatCounter n’a pas répondu',
      start,
      kpis: {
        views30: null,
        views7: null,
        concentrationPct: null,
      },
      graph: [],
      referrers: [],
      top: [],
      fetchedAt: new Date().toISOString(),
    };
  }

  const views30 =
    summary.total != null && Number.isFinite(Number(summary.total))
      ? Number(summary.total)
      : null;
  const views7 = sumViewsFromStats(summary, 7);
  const graph = extractGraphData(summary);

  const topHitsRaw = await withAudienceCache('top_hits', () =>
    getHits(goatcounter, { start, limit: 40 })
  );
  const topHits = normalizeHits(topHitsRaw);
  const top = await enrichHitsWithArticles(pool, topHits);

  const top5Views = top.slice(0, 5).reduce((acc, row) => acc + row.views, 0);
  const concentrationPct =
    views30 && views30 > 0
      ? Math.round((top5Views / views30) * 100)
      : null;

  const refsRaw = await withAudienceCache('toprefs', () =>
    getTopReferrers(goatcounter, { start, limit: 20 })
  );
  const refsStats = Array.isArray(refsRaw?.stats) ? refsRaw.stats : [];
  const referrers = normalizeReferrers(refsStats, views30 || 0);

  return {
    ok: true,
    configured: true,
    start,
    kpis: {
      views30,
      views7,
      concentrationPct,
    },
    graph,
    referrers,
    top,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Routes desk : /api/desk/audience[ /refresh ]
 */
export async function handleDeskAudience(req, res, parts, ctx) {
  const { pool, sendJson, session, actor, ip, goatcounter } = ctx;

  if (!canPublish(session.role)) {
    return sendJson(res, 403, {
      error: 'Audience réservée admin/editor',
    });
  }

  if (!goatcounterConfigured(goatcounter || {})) {
    return sendJson(res, 503, {
      error:
        'GoatCounter non configuré (GOATCOUNTER_SITE / GOATCOUNTER_API_KEY)',
      configured: false,
    });
  }

  // POST /api/desk/audience/refresh
  if (parts[3] === 'refresh' && !parts[4] && req.method === 'POST') {
    flushAudienceCache();
    const payload = await buildAudiencePayload(pool, goatcounter);
    await auditLog(pool, {
      actor,
      action: 'audience.refresh',
      targetType: 'audience',
      targetId: null,
      ip,
      meta: { ok: payload.ok },
    });
    return sendJson(res, payload.ok ? 200 : 502, payload);
  }

  // GET /api/desk/audience
  if (!parts[3] && req.method === 'GET') {
    const payload = await buildAudiencePayload(pool, goatcounter);
    return sendJson(res, payload.ok ? 200 : 502, payload);
  }

  return sendJson(res, 404, { error: 'Not found' });
}
