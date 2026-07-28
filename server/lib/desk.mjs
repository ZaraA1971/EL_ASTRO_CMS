import crypto from 'node:crypto';
import { parseJsonArray, rowToArticle } from './db.mjs';
import { translateArticleFrToUk } from './deepl.mjs';
import { sendArticlePush } from './onesignal.mjs';
import { canAccessDesk, canEditAll, canPublish } from './roles.mjs';
import { canManageUsers, handleDeskUsers } from './users.mjs';
import { auditLog } from './audit.mjs';
import { handleDeskNewsletter } from './newsletter/handler.mjs';
import { handleDeskAudience } from './audience/handler.mjs';
import {
  buildKeywordSource,
  extractKeywordsViaRag,
  normalizeKeywords,
} from './keywords.mjs';
import { purgeFrontCache } from './front-cache.mjs';
import { callEditorialAssist } from './editorial-assist.mjs';
import { chapo } from './excerpt.mjs';
import { cleanHtml } from './html-clean.mjs';
import { handleDeskMedia } from './media/handler.mjs';
import { handleDeskArticleX } from './x-desk.mjs';
import {
  anyXAccountConfigured,
  listXAccountsPublic,
} from './x-accounts.mjs';

export { canAccessDesk, canEditAll, canPublish };

/** Qualif / services machine — création brouillon uniquement. */
const DESK_INGEST_SESSION = Object.freeze({
  uid: null,
  login: 'qualif',
  name: 'Qualif',
  role: 'editor',
  ingest: true,
});

function safeEqualStr(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (!ba.length || ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function readDeskIngestKey(req) {
  const header = req.headers['x-desk-ingest-key'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  const auth = req.headers.authorization;
  if (typeof auth === 'string') {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  return '';
}

/**
 * Auth machine Qualif → Desk (clé partagée).
 * Autorise uniquement POST /api/desk/articles (création brouillon).
 */
function resolveDeskIngestSession(req, parts, apiKey) {
  if (!apiKey) return null;
  const provided = readDeskIngestKey(req);
  if (!provided || !safeEqualStr(provided, apiKey)) return null;
  const isCreate =
    parts[2] === 'articles' && !parts[3] && req.method === 'POST';
  if (!isCreate) {
    const err = new Error('Ingest Desk : création de brouillon uniquement');
    err.status = 403;
    throw err;
  }
  return DESK_INGEST_SESSION;
}

/**
 * Valide un lien de traduction : la cible doit exister et être éditable
 * par la session (évite IDOR via translation_en / translation_fr).
 * @returns {Promise<object|null>} row twin ou null si twinId falsy
 */
async function loadEditableTwin(pool, session, twinId) {
  const id = Number(twinId) || 0;
  if (!id) return null;
  const [rows] = await pool.query(
    'SELECT * FROM el_articles WHERE wp_id = ? LIMIT 1',
    [id]
  );
  const twin = rows[0] || null;
  if (!twin) {
    const err = new Error('Article de traduction lié introuvable');
    err.status = 400;
    throw err;
  }
  if (!canEditArticle(session, twin)) {
    const err = new Error('Lien de traduction non autorisé sur cet article');
    err.status = 403;
    throw err;
  }
  return twin;
}

/** Propage les mots-clés IA vers la version FR/EN liée (entités souvent bilingues). */
async function syncKeywordsToTwin(pool, session, row, keywords) {
  const twinId =
    Number(row.translation_en) || Number(row.translation_fr) || 0;
  if (!twinId || !Array.isArray(keywords)) return null;
  let twin;
  try {
    twin = await loadEditableTwin(pool, session, twinId);
  } catch {
    // Lien cassé / non autorisé : ne pas bloquer la sauvegarde source
    return null;
  }
  // Mots-clés IA = articles abonnés uniquement
  if (!twin || twin.access === 'granted') return null;
  await pool.query('UPDATE el_articles SET ia_keywords = ? WHERE wp_id = ?', [
    asJson(keywords),
    twinId,
  ]);
  return twinId;
}

/**
 * Génère des mots-clés IA pour un article abonnés s’il n’en a pas encore.
 * Ne lève pas : en cas d’échec RAG, renvoie la liste courante (souvent []).
 */
async function ensureSubscriberKeywords(ctx, {
  access,
  title,
  excerpt,
  body,
  lang,
  existingKeywords = [],
}) {
  if (access === 'granted') return [];
  const current = normalizeKeywords(existingKeywords);
  if (current.length) return current;
  const { content, language } = buildKeywordSource({
    title,
    excerpt,
    body,
    lang,
  });
  if (content.length < 40) return [];
  try {
    return await extractKeywordsViaRag({
      upstream: ctx.ragUpstream,
      apiKey: ctx.ragApiKey,
      content,
      language,
    });
  } catch (err) {
    console.error('[desk] auto-keywords', err.message);
    return [];
  }
}

export function canEditArticle(session, row) {
  if (!session || !canAccessDesk(session.role)) return false;
  if (canEditAll(session.role)) return true;
  return Number(row.author_user_id) === Number(session.uid);
}

function slugify(title) {
  return String(title || 'article')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'article';
}

function toMysqlDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function nowMysql() {
  return toMysqlDate(new Date());
}

let dateNullableEnsured = false;

/** Brouillons : date de publication NULL jusqu’au premier publish. */
async function ensureArticleDateNullable(pool) {
  if (dateNullableEnsured) return;
  const [cols] = await pool.query(`SHOW COLUMNS FROM el_articles LIKE 'date'`);
  const col = cols[0];
  if (col && String(col.Null).toUpperCase() === 'NO') {
    await pool.query(
      'ALTER TABLE el_articles MODIFY COLUMN date DATETIME NULL DEFAULT NULL'
    );
  }
  dateNullableEnsured = true;
}

function asJson(v) {
  if (!v) return JSON.stringify([]);
  if (Array.isArray(v)) return JSON.stringify(v.map(String));
  return JSON.stringify([String(v)]);
}

async function nextWpId(pool) {
  const [[maxRow]] = await pool.query(
    'SELECT COALESCE(MAX(wp_id), 100000) + 1 AS next_id FROM el_articles'
  );
  return Number(maxRow.next_id);
}

async function uniqueSlug(pool, base, excludeWpId = null) {
  let slug = slugify(base);
  let n = 0;
  for (;;) {
    const candidate = n === 0 ? slug : `${slug}-${n}`;
    const [rows] = await pool.query(
      excludeWpId
        ? 'SELECT wp_id FROM el_articles WHERE slug = ? AND wp_id != ? LIMIT 1'
        : 'SELECT wp_id FROM el_articles WHERE slug = ? LIMIT 1',
      excludeWpId ? [candidate, excludeWpId] : [candidate]
    );
    if (!rows.length) return candidate;
    n += 1;
    if (n > 50) return `${slug}-${Date.now()}`;
  }
}

const PLACEHOLDER_SLUGS = new Set([
  'nouvel-article',
  'new-article',
  'untitled',
  'article',
]);

/**
 * Slug URL : suit le titre tant que brouillon / placeholder / slug = ancien titre.
 * Sinon conserve le slug publié (URLs stables), sauf override explicite.
 */
async function resolveArticleSlug(pool, existing, title, payloadSlug) {
  if (payloadSlug != null && String(payloadSlug).trim()) {
    return uniqueSlug(pool, String(payloadSlug).trim(), existing.wp_id);
  }
  const current = String(existing.slug || '').trim();
  const fromTitle = slugify(title);
  const fromOldTitle = slugify(existing.title);
  const isDraft = Number(existing.draft) === 1;
  const isPlaceholder = !current || PLACEHOLDER_SLUGS.has(current);
  const tracksOldTitle = current && current === fromOldTitle;
  if (isDraft || isPlaceholder || tracksOldTitle) {
    return uniqueSlug(pool, title || current || 'article', existing.wp_id);
  }
  return current;
}

/**
 * POST /api/desk/articles/:wpId/translate-uk
 * Source FR → brouillon EN-GB (création ou écrasement), liaison bidirectionnelle.
 */
async function translateUk(req, res, sourceRow, ctx) {
  const { pool, sendJson, readBody, deeplApiKey, session } = ctx;

  let payload = {};
  try {
    const raw = (await readBody(req)).toString('utf8');
    if (raw.trim()) payload = JSON.parse(raw);
  } catch {
    return sendJson(res, 400, { error: 'JSON invalide' });
  }
  const overwrite = payload.overwrite !== false;

  // Si on est sur l'EN, remonter au FR
  let fr = sourceRow;
  if (String(fr.lang || '').toLowerCase() === 'en') {
    const frId = Number(fr.translation_fr) || 0;
    if (!frId) {
      return sendJson(res, 400, {
        error: 'Article EN sans lien FR (translation_fr manquant)',
      });
    }
    const [frRows] = await pool.query(
      'SELECT * FROM el_articles WHERE wp_id = ? LIMIT 1',
      [frId]
    );
    if (!frRows[0]) {
      return sendJson(res, 404, { error: 'Article FR lié introuvable' });
    }
    fr = frRows[0];
  }

  if (String(fr.lang || 'fr').toLowerCase() !== 'fr') {
    return sendJson(res, 400, {
      error: 'La traduction UK part d’un article français',
    });
  }

  let enId = Number(fr.translation_en) || null;
  let enExisting = null;
  if (enId) {
    const [enRows] = await pool.query(
      'SELECT * FROM el_articles WHERE wp_id = ? LIMIT 1',
      [enId]
    );
    enExisting = enRows[0] || null;
    if (!enExisting) enId = null;
  }

  if (enExisting && !overwrite) {
    return sendJson(res, 409, {
      error: 'Version UK déjà existante',
      article: rowToArticle(enExisting),
      created: false,
    });
  }

  if (enExisting && session && !canEditArticle(session, enExisting)) {
    return sendJson(res, 403, {
      error: 'Version UK liée non modifiable (propriété / droits)',
    });
  }

  if (!deeplApiKey) {
    return sendJson(res, 503, {
      error: 'DeepL non configuré (DEEPL_API_KEY)',
    });
  }

  let translated;
  try {
    translated = await translateArticleFrToUk(
      {
        title: fr.title || '',
        excerpt: fr.excerpt || '',
        body: fr.body || '',
      },
      deeplApiKey
    );
  } catch (err) {
    console.error('[desk] deepl', err.message);
    return sendJson(res, 502, {
      error: err.message || 'Échec traduction DeepL',
      code: err.code || 'DEEPL_ERROR',
    });
  }

  const title = (translated.title || '').trim() || `${fr.title} (EN)`;
  const body = cleanHtml(translated.body || '', 'store');
  // Excerpt = début proportionnel du corps EN (pas le chapô gras)
  const excerpt = chapo(body, 'store');
  const now = nowMysql();
  const cats = parseJsonArray(fr.categories);
  const catNames = parseJsonArray(fr.category_names);
  const tags = parseJsonArray(fr.tags);
  // UK : garder les mots-clés seulement si l’article reste abonnés
  const accessEn = fr.access === 'granted' ? 'granted' : 'subscribers';
  const ia = accessEn === 'granted' ? [] : parseJsonArray(fr.ia_keywords);

  await ensureArticleDateNullable(pool);
  if (enExisting) {
    // Écrasement : contenu + méta, forcé brouillon pour relecture humaine
    const slug = await uniqueSlug(pool, title, enExisting.wp_id);
    await pool.query(
      `UPDATE el_articles SET
        slug=?, title=?, excerpt=?, body=?, date=?, modified=?,
        author=?, author_slug=?, author_user_id=?,
        categories=?, category_names=?, tags=?, ia_keywords=?,
        access=?, lang='en', draft=1,
        translation_fr=?, translation_en=?
       WHERE wp_id=?`,
      [
        slug,
        title,
        excerpt,
        body,
        null,
        now,
        fr.author,
        fr.author_slug,
        fr.author_user_id,
        asJson(cats),
        asJson(catNames),
        asJson(tags),
        asJson(ia),
        fr.access === 'granted' ? 'granted' : 'subscribers',
        fr.wp_id,
        enExisting.wp_id,
        enExisting.wp_id,
      ]
    );
    enId = Number(enExisting.wp_id);
  } else {
    enId = await nextWpId(pool);
    const slug = await uniqueSlug(pool, title);
    await pool.query(
      `INSERT INTO el_articles (
        wp_id, slug, title, excerpt, body, date, modified,
        author, author_slug, author_user_id,
        categories, category_names, tags, ia_keywords,
        access, lang, draft, translation_fr, translation_en
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        enId,
        slug,
        title,
        excerpt,
        body,
        null,
        now,
        fr.author,
        fr.author_slug,
        fr.author_user_id,
        asJson(cats),
        asJson(catNames),
        asJson(tags),
        asJson(ia),
        fr.access === 'granted' ? 'granted' : 'subscribers',
        'en',
        1,
        fr.wp_id,
        enId,
      ]
    );
  }

  // Liaison bidirectionnelle côté FR
  await pool.query(
    'UPDATE el_articles SET translation_en = ?, translation_fr = ?, modified = ? WHERE wp_id = ?',
    [enId, fr.wp_id, now, fr.wp_id]
  );

  bumpContentGen();
  const [rows] = await pool.query('SELECT * FROM el_articles WHERE wp_id = ?', [
    enId,
  ]);
  if (ctx.actor) {
    await auditLog(pool, {
      actor: ctx.actor,
      action: enExisting ? 'article.translate_uk_overwrite' : 'article.translate_uk',
      targetType: 'article',
      targetId: enId,
      meta: { source_fr: Number(fr.wp_id), overwritten: Boolean(enExisting) },
      ip: ctx.ip,
    });
  }
  return sendJson(res, enExisting ? 200 : 201, {
    article: rowToArticle(rows[0]),
    created: !enExisting,
    overwritten: Boolean(enExisting),
    source_fr: Number(fr.wp_id),
    contentGen: getContentGen(),
  });
}

/** In-memory generation for short HTTP cache busting */
let contentGen = Date.now();
export function bumpContentGen() {
  contentGen = Date.now();
  // Home / archives publiques : vider le cache nginx dès qu’un article change
  purgeFrontCache();
  return contentGen;
}
export function getContentGen() {
  return contentGen;
}

export async function handleDesk(req, res, parts, ctx) {
  const { pool, sendJson, readBody, resolveDeskSession, clientIp } = ctx;
  let session = null;
  try {
    session = resolveDeskIngestSession(req, parts, ctx.deskIngestApiKey);
  } catch (err) {
    return sendJson(res, err.status || 403, {
      error: err.message || 'Accès pupitre refusé',
    });
  }
  if (!session) {
    // Toujours recharger le rôle depuis MySQL (cookie seul = stale jusqu’à 14 j)
    const resolved = resolveDeskSession
      ? await resolveDeskSession(req)
      : null;
    session = resolved?.session || null;
  }
  if (!session || !canAccessDesk(session.role)) {
    return sendJson(res, 403, { error: 'Accès pupitre refusé' });
  }
  const ip = typeof clientIp === 'function' ? clientIp(req) : undefined;
  const actor = session.ingest
    ? { uid: null, login: session.login }
    : { uid: session.uid, login: session.login };

  // /api/desk/me
  if (parts[2] === 'me' && req.method === 'GET') {
    return sendJson(res, 200, {
      user: {
        id: session.uid,
        login: session.login,
        name: session.name,
        role: session.role,
      },
      capabilities: {
        editAll: canEditAll(session.role),
        create: true,
        publish: canPublish(session.role),
        manageUsers: canManageUsers(session.role),
        onesignal: Boolean(
          canPublish(session.role) &&
            (ctx.onesignal?.dryRun ||
              (ctx.onesignal?.apiKey && ctx.onesignal?.appId))
        ),
        onesignalDryRun: Boolean(ctx.onesignal?.dryRun),
        newsletter: Boolean(canPublish(session.role)),
        newsletterDryRun: Boolean(ctx.brevo?.dryRun),
        audience: Boolean(canPublish(session.role)),
        media: true,
        mediaDelete: canEditAll(session.role),
        xPost: Boolean(
          canPublish(session.role) &&
            (ctx.x?.dryRun || anyXAccountConfigured(ctx.x?.env || {}))
        ),
        xPostDryRun: Boolean(ctx.x?.dryRun),
        xAccounts: listXAccountsPublic(ctx.x?.env || {}),
      },
      contentGen: getContentGen(),
    });
  }

  // /api/desk/media — médiathèque
  if (parts[2] === 'media') {
    return handleDeskMedia(req, res, parts, {
      ...ctx,
      session,
      actor,
      ip,
    });
  }

  // /api/desk/content-gen
  if (parts[2] === 'content-gen' && req.method === 'GET') {
    return sendJson(res, 200, { contentGen: getContentGen() });
  }

  // POST /api/desk/assist — corriger | reformuler | chapo via agent_editorial
  if (parts[2] === 'assist' && !parts[3] && req.method === 'POST') {
    let body = {};
    try {
      const raw = (await readBody(req)).toString('utf8');
      if (raw.trim()) body = JSON.parse(raw);
    } catch {
      return sendJson(res, 400, { error: 'JSON invalide' });
    }
    try {
      const result = await callEditorialAssist({
        upstream: ctx.agentEditorial?.url,
        apiKey: ctx.agentEditorial?.apiKey,
        type: body.type,
        text: body.text,
        prompt: body.prompt,
        profile: 'electronlibre',
      });
      await auditLog(pool, {
        actor,
        action: `assist.${result.type}`,
        targetType: 'article',
        targetId: body.wpId != null ? Number(body.wpId) || null : null,
        ip,
        meta: {
          inputChars: String(body.text || '').length,
          outputChars: result.text.length,
        },
      });
      return sendJson(res, 200, {
        text: result.text,
        type: result.type,
        model: result.model || null,
      });
    } catch (err) {
      console.error('[desk] assist', err.message);
      return sendJson(res, err.status || 502, {
        error: err.message || 'Échec assist IA',
      });
    }
  }

  // GET /api/desk/authors?q= — autocomplete auteur (articles + comptes rédaction)
  if (parts[2] === 'authors' && !parts[3] && req.method === 'GET') {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const q = String(url.searchParams.get('q') || '').trim();
    const like = q ? `%${q}%` : null;
    const out = [];
    const seen = new Set();

    const push = (row) => {
      const name = String(row.name || '').trim();
      if (!name) return;
      const key = name.toLocaleLowerCase('fr');
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        name,
        slug: row.slug ? String(row.slug) : slugify(name),
        userId: row.user_id != null ? Number(row.user_id) : null,
        source: row.source || 'article',
      });
    };

    if (like) {
      const [fromArticles] = await pool.query(
        `SELECT author AS name, author_slug AS slug, author_user_id AS user_id,
                COUNT(*) AS n, 'article' AS source
         FROM el_articles
         WHERE author LIKE ?
         GROUP BY author, author_slug, author_user_id
         ORDER BY n DESC, author ASC
         LIMIT 16`,
        [like]
      );
      for (const r of fromArticles) push(r);

      const [fromUsers] = await pool.query(
        `SELECT display_name AS name, login AS slug, id AS user_id, 'user' AS source
         FROM el_users
         WHERE status = 'active'
           AND role IN ('admin', 'administrator', 'editor', 'author')
           AND (display_name LIKE ? OR login LIKE ?)
         ORDER BY display_name ASC
         LIMIT 16`,
        [like, like]
      );
      for (const r of fromUsers) push(r);
    } else {
      const [top] = await pool.query(
        `SELECT author AS name, author_slug AS slug, author_user_id AS user_id,
                COUNT(*) AS n, 'article' AS source
         FROM el_articles
         WHERE author IS NOT NULL AND TRIM(author) != ''
         GROUP BY author, author_slug, author_user_id
         ORDER BY n DESC, author ASC
         LIMIT 12`
      );
      for (const r of top) push(r);
    }

    return sendJson(res, 200, { authors: out.slice(0, 12) });
  }

  // /api/desk/users[/:id]
  if (parts[2] === 'users') {
    return handleDeskUsers(req, res, parts, { ...ctx, session, ip, actor });
  }

  // /api/desk/newsletter/*
  if (parts[2] === 'newsletter') {
    return handleDeskNewsletter(req, res, parts, {
      ...ctx,
      session,
      ip,
      actor,
    });
  }

  // /api/desk/audience/*
  if (parts[2] === 'audience') {
    return handleDeskAudience(req, res, parts, {
      ...ctx,
      session,
      ip,
      actor,
    });
  }

  // /api/desk/articles
  if (parts[2] === 'articles' && !parts[3]) {
    if (req.method === 'GET') {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const q = String(url.searchParams.get('q') || '').trim();
      const lang = String(url.searchParams.get('lang') || '').trim();
      const draftParam = url.searchParams.get('draft');
      const page = Math.max(1, Number(url.searchParams.get('page') || 1));
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 20)));
      const offset = (page - 1) * limit;

      const where = [];
      const params = [];
      if (!canEditAll(session.role)) {
        where.push('author_user_id = ?');
        params.push(session.uid);
      }
      if (lang) {
        where.push('lang = ?');
        params.push(lang);
      }
      if (draftParam === '1' || draftParam === '0') {
        where.push('draft = ?');
        params.push(Number(draftParam));
      }
      if (q) {
        where.push('(title LIKE ? OR excerpt LIKE ? OR slug LIKE ?)');
        const like = `%${q}%`;
        params.push(like, like, like);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const [[{ total: totalRaw }]] = await pool.query(
        `SELECT COUNT(*) AS total FROM el_articles ${whereSql}`,
        params
      );
      const total = Number(totalRaw || 0);
      const pages = Math.max(1, Math.ceil(total / limit) || 1);
      const pageClamped = Math.min(page, pages);
      const offsetClamped = (pageClamped - 1) * limit;
      // Liste légère : pas de body/excerpt/JSON. ORDER BY indexable (évite COALESCE → filesort).
      const [rows] = await pool.query(
        `SELECT wp_id, slug, title, date, modified, author, author_user_id,
                access, lang, draft
         FROM el_articles ${whereSql}
         ORDER BY modified DESC, wp_id DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offsetClamped]
      );
      return sendJson(res, 200, {
        total,
        page: pageClamped,
        limit,
        pages,
        articles: rows.map((r) => rowToArticle(r, { includeBody: false })),
      });
    }

    if (req.method === 'POST') {
      let payload;
      try {
        payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      } catch {
        return sendJson(res, 400, { error: 'JSON invalide' });
      }
      const title = String(payload.title || 'Sans titre').trim() || 'Sans titre';
      const slug = await uniqueSlug(
        pool,
        String(payload.slug || '').trim() || title
      );
      const [[maxRow]] = await pool.query(
        'SELECT COALESCE(MAX(wp_id), 100000) + 1 AS next_id FROM el_articles'
      );
      const wpId = Number(maxRow.next_id);
      const now = nowMysql();
      await ensureArticleDateNullable(pool);
      // Ingest Qualif / author : toujours brouillon à la création
      const draft = session.ingest
        ? 1
        : canPublish(session.role)
          ? payload.draft === false
            ? 0
            : 1
          : 1;
      const bodyHtml = cleanHtml(payload.body || '', 'store');
      const sourceUrl = payload.source_url
        ? String(payload.source_url).trim().slice(0, 500) || null
        : null;
      // Ingest Qualif peut imposer un auteur rédaction (ex. Emmanuel Torregano)
      const authorUserId = session.ingest
        ? payload.author_user_id != null
          ? Number(payload.author_user_id) || null
          : null
        : session.uid || null;
      // Date de publication : seulement si déjà en ligne à la création
      const pubDate = draft ? null : toMysqlDate(payload.date) || now;
      await pool.query(
        `INSERT INTO el_articles (
          wp_id, slug, title, excerpt, body, date, modified,
          author, author_slug, author_user_id,
          categories, category_names, tags, ia_keywords,
          access, lang, draft, source_url
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          wpId,
          slug,
          title,
          chapo(bodyHtml, 'store'),
          bodyHtml,
          pubDate,
          now,
          String(payload.author || session.name || session.login),
          payload.author_slug
            ? String(payload.author_slug)
            : slugify(session.login),
          authorUserId,
          asJson(payload.categories),
          asJson(payload.category_names),
          asJson(payload.tags),
          asJson(
            payload.access === 'granted'
              ? []
              : normalizeKeywords(payload.ia_keywords)
          ),
          payload.access === 'granted' ? 'granted' : 'subscribers',
          String(payload.lang || 'fr').toLowerCase(),
          draft,
          sourceUrl,
        ]
      );
      bumpContentGen();
      if (session.ingest) {
        await auditLog(pool, {
          actor,
          action: 'article.create_ingest',
          targetType: 'article',
          targetId: wpId,
          meta: { source: 'qualif', source_url: sourceUrl },
          ip,
        });
      }
      const [rows] = await pool.query('SELECT * FROM el_articles WHERE wp_id = ?', [
        wpId,
      ]);
      return sendJson(res, 201, { article: rowToArticle(rows[0]) });
    }

    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  // /api/desk/articles/:wpId[/publish]
  const wpId = Number(parts[3]);
  if (!wpId) return sendJson(res, 400, { error: 'wp_id invalide' });

  const [existingRows] = await pool.query(
    'SELECT * FROM el_articles WHERE wp_id = ? LIMIT 1',
    [wpId]
  );
  const existing = existingRows[0];
  if (!existing) return sendJson(res, 404, { error: 'Article inconnu' });
  if (!canEditArticle(session, existing)) {
    return sendJson(res, 403, { error: 'Pas le droit sur cet article' });
  }

  if (parts[4] === 'publish' && req.method === 'POST') {
    if (!canPublish(session.role)) {
      return sendJson(res, 403, {
        error: 'Publication réservée éditeur/admin',
      });
    }
    let payload = {};
    try {
      const raw = (await readBody(req)).toString('utf8');
      if (raw.trim()) payload = JSON.parse(raw);
    } catch {
      return sendJson(res, 400, { error: 'JSON invalide' });
    }

    // Première mise en ligne : date de publication = maintenant (pas avant).
    await ensureArticleDateNullable(pool);
    const wasDraft = Number(existing.draft) === 1;
    const slug = await resolveArticleSlug(
      pool,
      existing,
      existing.title,
      null
    );
    if (wasDraft) {
      const pubDate = nowMysql();
      await pool.query(
        'UPDATE el_articles SET draft = 0, date = ?, modified = ?, slug = ? WHERE wp_id = ?',
        [pubDate, pubDate, slug, wpId]
      );
    } else if (slug !== existing.slug) {
      await pool.query(
        'UPDATE el_articles SET draft = 0, slug = ? WHERE wp_id = ?',
        [slug, wpId]
      );
    } else {
      await pool.query('UPDATE el_articles SET draft = 0 WHERE wp_id = ?', [
        wpId,
      ]);
    }
    bumpContentGen();
    const [rows] = await pool.query('SELECT * FROM el_articles WHERE wp_id = ?', [
      wpId,
    ]);
    const article = rowToArticle(rows[0]);
    let push = null;
    if (payload.push) {
      try {
        push = await sendArticlePush(rows[0], {
          appId: ctx.onesignal?.appId,
          apiKey: ctx.onesignal?.apiKey,
          siteUrl: ctx.onesignal?.siteUrl,
          dryRun: Boolean(ctx.onesignal?.dryRun),
          title: 'ElectronLibre',
          segment: payload.segment || 'All',
          sendToMobile: true,
        });
      } catch (err) {
        console.error('[desk] onesignal', err.message);
        return sendJson(res, 200, {
          article,
          contentGen: getContentGen(),
          push: { ok: false, error: err.message },
        });
      }
    }
    await auditLog(pool, {
      actor,
      action: 'article.publish',
      targetType: 'article',
      targetId: wpId,
      meta: { push: Boolean(payload.push), pushOk: push?.ok ?? null, dryRun: push?.dryRun },
      ip,
    });
    return sendJson(res, 200, {
      article,
      contentGen: getContentGen(),
      push: push ? { ok: true, ...push } : null,
    });
  }

  // Basculer brouillon immédiatement (sans réécrire titre/corps)
  if (parts[4] === 'draft' && req.method === 'POST') {
    let payload = {};
    try {
      const raw = (await readBody(req)).toString('utf8');
      if (raw.trim()) payload = JSON.parse(raw);
    } catch {
      return sendJson(res, 400, { error: 'JSON invalide' });
    }
    const wantDraft = payload.draft !== false && payload.draft !== 0;
    if (!wantDraft && !canPublish(session.role)) {
      return sendJson(res, 403, {
        error: 'Publication réservée éditeur/admin',
      });
    }
    await ensureArticleDateNullable(pool);
    if (wantDraft) {
      // Retour brouillon : efface la date de publication
      await pool.query(
        'UPDATE el_articles SET draft = 1, date = NULL WHERE wp_id = ?',
        [wpId]
      );
    } else {
      // Mise en ligne via le bouton brouillon : date = maintenant + slug depuis titre
      const pubDate = nowMysql();
      const slug = await resolveArticleSlug(
        pool,
        existing,
        existing.title,
        null
      );
      await pool.query(
        'UPDATE el_articles SET draft = 0, date = ?, modified = ?, slug = ? WHERE wp_id = ?',
        [pubDate, pubDate, slug, wpId]
      );
    }
    bumpContentGen();
    await auditLog(pool, {
      actor,
      action: wantDraft ? 'article.draft' : 'article.undraft',
      targetType: 'article',
      targetId: wpId,
      meta: { draft: wantDraft },
      ip,
    });
    const [rows] = await pool.query(
      'SELECT * FROM el_articles WHERE wp_id = ?',
      [wpId]
    );
    return sendJson(res, 200, {
      article: rowToArticle(rows[0]),
      contentGen: getContentGen(),
    });
  }

  if (parts[4] === 'keywords' && req.method === 'POST') {
    let payload = {};
    try {
      const raw = (await readBody(req)).toString('utf8');
      if (raw.trim()) payload = JSON.parse(raw);
    } catch {
      return sendJson(res, 400, { error: 'JSON invalide' });
    }

    const access =
      payload.access != null
        ? String(payload.access)
        : existing.access || 'subscribers';
    if (access === 'granted') {
      return sendJson(res, 400, {
        error:
          'Les mots-clés IA sont réservés aux articles abonnés (pas aux articles gratuits).',
      });
    }

    const title =
      payload.title != null ? String(payload.title) : existing.title || '';
    const excerpt =
      payload.excerpt != null
        ? String(payload.excerpt)
        : existing.excerpt || '';
    const body =
      payload.body != null ? cleanHtml(payload.body, 'store') : existing.body || '';
    const lang =
      payload.lang != null
        ? String(payload.lang)
        : existing.lang || 'fr';

    const { content, language } = buildKeywordSource({
      title,
      excerpt,
      body,
      lang,
    });
    if (content.length < 40) {
      return sendJson(res, 400, {
        error: 'Ajoutez un titre et un peu de texte avant de générer les mots-clés.',
      });
    }

    try {
      const keywords = await extractKeywordsViaRag({
        upstream: ctx.ragUpstream,
        apiKey: ctx.ragApiKey,
        content,
        language,
      });
      if (!keywords.length) {
        return sendJson(res, 502, {
          error: 'Aucun mot-clé renvoyé par l’IA',
        });
      }
      // Persiste + force accès abonnés (génération = articles paywall).
      // Pas de date de mise à jour (réservée à Enregistrer le contenu).
      await pool.query(
        'UPDATE el_articles SET ia_keywords = ?, access = ? WHERE wp_id = ?',
        [asJson(keywords), 'subscribers', wpId]
      );
      existing.access = 'subscribers';
      const twinId = await syncKeywordsToTwin(pool, session, existing, keywords);
      bumpContentGen();
      await auditLog(pool, {
        actor,
        action: 'article.keywords',
        targetType: 'article',
        targetId: wpId,
        meta: { count: keywords.length, language, twinId },
        ip,
      });
      const [rows] = await pool.query(
        'SELECT * FROM el_articles WHERE wp_id = ?',
        [wpId]
      );
      return sendJson(res, 200, {
        keywords,
        article: rowToArticle(rows[0]),
        twinId,
        contentGen: getContentGen(),
      });
    } catch (err) {
      console.error('[desk] keywords', err.message);
      return sendJson(res, 502, {
        error: err.message || 'Échec extraction mots-clés',
      });
    }
  }

  if (parts[4] === 'x') {
    return handleDeskArticleX(
      req,
      res,
      parts,
      { ...ctx, session, actor, ip },
      existing
    );
  }

  if (parts[4] === 'push' && req.method === 'POST') {
    if (!canPublish(session.role)) {
      return sendJson(res, 403, {
        error: 'Push réservé éditeur/admin',
      });
    }
    if (Number(existing.draft)) {
      return sendJson(res, 400, {
        error: 'Publiez l’article avant d’envoyer un push',
      });
    }
    let payload = {};
    try {
      const raw = (await readBody(req)).toString('utf8');
      if (raw.trim()) payload = JSON.parse(raw);
    } catch {
      return sendJson(res, 400, { error: 'JSON invalide' });
    }
    try {
      const push = await sendArticlePush(existing, {
        appId: ctx.onesignal?.appId,
        apiKey: ctx.onesignal?.apiKey,
        siteUrl: ctx.onesignal?.siteUrl,
        dryRun: Boolean(ctx.onesignal?.dryRun),
        title: 'ElectronLibre',
        segment: payload.segment || 'All',
        sendToMobile: true,
      });
      await auditLog(pool, {
        actor,
        action: 'article.push',
        targetType: 'article',
        targetId: wpId,
        meta: { dryRun: push.dryRun, recipients: push.recipients },
        ip,
      });
      return sendJson(res, 200, { ok: true, push });
    } catch (err) {
      console.error('[desk] onesignal', err.message);
      return sendJson(res, 502, {
        error: err.message || 'Échec OneSignal',
        code: err.code || 'ONESIGNAL_ERROR',
      });
    }
  }

  if (parts[4] === 'translate-uk' && req.method === 'POST') {
    return translateUk(req, res, existing, { ...ctx, session, actor, ip });
  }

  if (req.method === 'GET' && !parts[4]) {
    return sendJson(res, 200, { article: rowToArticle(existing) });
  }

  if (req.method === 'PUT' && !parts[4]) {
    let payload;
    try {
      payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    } catch {
      return sendJson(res, 400, { error: 'JSON invalide' });
    }
    const title =
      payload.title != null
        ? String(payload.title).trim() || existing.title
        : existing.title;
    const slug = await resolveArticleSlug(
      pool,
      existing,
      title,
      payload.slug
    );
    const cats =
      payload.categories != null
        ? payload.categories
        : parseJsonArray(existing.categories);
    const catNames =
      payload.category_names != null
        ? payload.category_names
        : parseJsonArray(existing.category_names);

    // Author peut forcer brouillon, pas publier via PUT (réservé /publish)
    let draftVal = existing.draft;
    if (payload.draft === true) draftVal = 1;
    else if (payload.draft === false && canPublish(session.role)) draftVal = 0;

    const authorName =
      payload.author != null ? String(payload.author).trim() : existing.author;
    const authorSlug =
      payload.author_slug != null
        ? String(payload.author_slug).trim() || slugify(authorName)
        : payload.author != null
          ? slugify(authorName)
          : existing.author_slug;
    const authorUserId =
      payload.author_user_id !== undefined
        ? payload.author_user_id != null
          ? Number(payload.author_user_id) || null
          : null
        : existing.author_user_id;

    const bodyHtml =
      payload.body != null ? cleanHtml(payload.body, 'store') : existing.body || '';
    const excerpt = chapo(bodyHtml, 'store');
    const accessNext =
      payload.access === 'granted'
        ? 'granted'
        : payload.access === 'subscribers'
          ? 'subscribers'
          : existing.access;
    // Mots-clés IA réservés aux articles abonnés — auto si vide à l’enregistrement
    let iaKeywordsNext =
      accessNext === 'granted'
        ? []
        : payload.ia_keywords != null
          ? normalizeKeywords(payload.ia_keywords)
          : parseJsonArray(existing.ia_keywords);
    let autoKeywords = false;
    if (accessNext === 'subscribers' && !iaKeywordsNext.length) {
      const generated = await ensureSubscriberKeywords(ctx, {
        access: accessNext,
        title,
        excerpt,
        body: bodyHtml,
        lang:
          payload.lang != null
            ? String(payload.lang).toLowerCase()
            : existing.lang || 'fr',
        existingKeywords: [],
      });
      if (generated.length) {
        iaKeywordsNext = generated;
        autoKeywords = true;
      }
    }

    // Liens de traduction : auteurs ne peuvent pas les réassigner (IDOR).
    // Editors/admins doivent pouvoir éditer la cible si elle existe.
    let translationFr = existing.translation_fr;
    let translationEn = existing.translation_en;
    if (canEditAll(session.role)) {
      try {
        if (payload.translation_fr !== undefined) {
          const wanted =
            payload.translation_fr != null
              ? Number(payload.translation_fr) || null
              : null;
          if (wanted) await loadEditableTwin(pool, session, wanted);
          translationFr = wanted;
        }
        if (payload.translation_en !== undefined) {
          const wanted =
            payload.translation_en != null
              ? Number(payload.translation_en) || null
              : null;
          if (wanted) await loadEditableTwin(pool, session, wanted);
          translationEn = wanted;
        }
      } catch (err) {
        return sendJson(res, err.status || 400, {
          error: err.message || 'Lien de traduction invalide',
        });
      }
    }

    await ensureArticleDateNullable(pool);
    const isDraft = Number(draftVal) === 1;
    // Brouillon : pas de date de publication. En ligne : date formulaire ou existante.
    const nextDate = isDraft
      ? null
      : toMysqlDate(payload.date) || toMysqlDate(existing.date) || nowMysql();
    // modified = dernière édition (tri desk) ; affichage « Mise à jour » seulement si publié
    await pool.query(
      `UPDATE el_articles SET
        slug=?, title=?, excerpt=?, body=?, date=?, modified=?,
        author=?, author_slug=?, author_user_id=?,
        categories=?, category_names=?, tags=?, ia_keywords=?,
        access=?, lang=?, draft=?,
        translation_fr=?, translation_en=?
       WHERE wp_id=?`,
      [
        slug,
        title,
        excerpt,
        bodyHtml,
        nextDate,
        nowMysql(),
        authorName,
        authorSlug,
        authorUserId,
        asJson(cats),
        asJson(catNames),
        asJson(
          payload.tags != null ? payload.tags : parseJsonArray(existing.tags)
        ),
        asJson(iaKeywordsNext),
        accessNext,
        payload.lang != null
          ? String(payload.lang).toLowerCase()
          : existing.lang,
        draftVal,
        translationFr,
        translationEn,
        wpId,
      ]
    );
    if (
      accessNext !== 'granted' &&
      (autoKeywords || payload.ia_keywords != null)
    ) {
      await syncKeywordsToTwin(
        pool,
        session,
        {
          ...existing,
          translation_fr: translationFr,
          translation_en: translationEn,
        },
        iaKeywordsNext
      );
    }
    bumpContentGen();
    const [rows] = await pool.query('SELECT * FROM el_articles WHERE wp_id = ?', [
      wpId,
    ]);
    return sendJson(res, 200, {
      article: rowToArticle(rows[0]),
      contentGen: getContentGen(),
    });
  }

  if (req.method === 'DELETE' && !parts[4]) {
    if (!canEditAll(session.role)) {
      return sendJson(res, 403, { error: 'Suppression réservée éditeur/admin' });
    }
    // Délier les traductions avant suppression
    await pool.query(
      'UPDATE el_articles SET translation_en = NULL WHERE translation_en = ?',
      [wpId]
    );
    await pool.query(
      'UPDATE el_articles SET translation_fr = NULL WHERE translation_fr = ?',
      [wpId]
    );
    await pool.query('DELETE FROM el_articles WHERE wp_id = ?', [wpId]);
    bumpContentGen();
    await auditLog(pool, {
      actor,
      action: 'article.delete',
      targetType: 'article',
      targetId: wpId,
      ip,
    });
    return sendJson(res, 200, { ok: true, contentGen: getContentGen() });
  }

  return sendJson(res, 404, { error: 'Unknown desk route' });
}
