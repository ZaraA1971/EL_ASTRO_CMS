import crypto from 'node:crypto';
import { parseJsonArray, rowToArticle } from './db.mjs';
import { canAccessDesk, canEditAll, canPublish } from './roles.mjs';
import { canManageUsers, handleDeskUsers } from './users.mjs';
import { auditLog } from './audit.mjs';
import { chapo } from './excerpt.mjs';
import { cleanHtml } from './html-clean.mjs';
import { handleDeskMedia } from './media/handler.mjs';
import {
  listCategories,
  createCategory,
} from './categories.mjs';
import { createElDeskRegistry } from './desk/el/el-plugins.mjs';
import {
  asJson,
  canEditArticle,
  ensureArticleDateNullable,
  nextArticleId,
  normalizeKeywords,
  nowMysql,
  resolveArticleSlug,
  slugify,
  toMysqlDate,
  uniqueSlug,
} from './desk/core/article-helpers.mjs';
import {
  ensureSubscriberKeywords,
  loadEditableTwin,
  syncKeywordsToTwin,
} from './desk/el/article-el.mjs';
import { pushPublishedArticle } from './desk/el/plugins/push.mjs';
import { emitDeskLifecycle } from './desk/core/lifecycle.mjs';
import { getContentGen } from './desk/core/content-gen.mjs';

function deskBrand(ctx) {
  return {
    name: ctx.brand?.name || process.env.DESK_BRAND_NAME || 'Pupitre',
    product:
      ctx.brand?.product || process.env.DESK_BRAND_PRODUCT || '',
    shortName:
      ctx.brand?.shortName ||
      process.env.DESK_BRAND_SHORT ||
      'Pupitre',
  };
}

export { canAccessDesk, canEditAll, canPublish };
export { canEditArticle } from './desk/core/article-helpers.mjs';
export { bumpContentGen, getContentGen } from './desk/core/content-gen.mjs';

/** Plugins EL (+ front-cache hooks). */
const defaultDeskPlugins = createElDeskRegistry();

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
  const plugins = ctx.plugins || defaultDeskPlugins;
  const deskReqCtx = { ...ctx, session, actor, ip, plugins };

  // /api/desk/me
  if (parts[2] === 'me' && req.method === 'GET') {
    return sendJson(res, 200, {
      user: {
        id: session.uid,
        login: session.login,
        name: session.name,
        role: session.role,
      },
      capabilities: plugins.mergeCaps(
        {
          editAll: canEditAll(session.role),
          create: true,
          publish: canPublish(session.role),
          manageUsers: canManageUsers(session.role),
          media: true,
          mediaDelete: canEditAll(session.role),
        },
        ctx,
        session
      ),
      brand: deskBrand(ctx),
      contentGen: getContentGen(),
      plugins: plugins.ids(),
    });
  }

  // Plugins top-level (newsletter, audience, …)
  if (await plugins.tryHandle(req, res, parts, deskReqCtx)) {
    return;
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

  // /api/desk/categories — liste + création rubrique
  if (parts[2] === 'categories' && !parts[3]) {
    if (req.method === 'GET') {
      const categories = await listCategories(pool);
      return sendJson(res, 200, { categories });
    }
    if (req.method === 'POST') {
      let body = {};
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return sendJson(res, 400, { error: 'JSON invalide' });
      }
      try {
        const category = await createCategory(pool, {
          name: body.name,
          slug: body.slug,
        });
        await auditLog(pool, {
          actor,
          action: 'category.create',
          targetType: 'category',
          targetId: category.slug,
          meta: { name: category.name },
          ip,
        });
        await emitDeskLifecycle(
          plugins,
          'onCategoryChange',
          { category },
          deskReqCtx
        );
        return sendJson(res, 201, { category });
      } catch (err) {
        return sendJson(res, err.status || 500, {
          error: err.message || 'Création rubrique impossible',
        });
      }
    }
    return sendJson(res, 405, { error: 'Méthode non autorisée' });
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
        `SELECT article_id, slug, title, date, modified, author, author_user_id,
                access, lang, draft
         FROM el_articles ${whereSql}
         ORDER BY modified DESC, article_id DESC
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
      const articleId = await nextArticleId(pool);
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
          article_id, slug, title, excerpt, body, date, modified,
          author, author_slug, author_user_id,
          categories, category_names, tags, ia_keywords,
          access, lang, draft, source_url
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          articleId,
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
      const [rows] = await pool.query('SELECT * FROM el_articles WHERE article_id = ?', [
        articleId,
      ]);
      const article = rowToArticle(rows[0]);
      await emitDeskLifecycle(
        plugins,
        'onMutate',
        { article, action: 'create' },
        deskReqCtx
      );
      if (session.ingest) {
        await auditLog(pool, {
          actor,
          action: 'article.create_ingest',
          targetType: 'article',
          targetId: articleId,
          meta: { source: 'qualif', source_url: sourceUrl },
          ip,
        });
      }
      return sendJson(res, 201, { article });
    }

    return sendJson(res, 405, { error: 'Méthode non autorisée' });
  }

  // /api/desk/articles/:articleId[/publish]
  const articleId = Number(parts[3]);
  if (!articleId) return sendJson(res, 400, { error: 'article_id invalide' });

  const [existingRows] = await pool.query(
    'SELECT * FROM el_articles WHERE article_id = ? LIMIT 1',
    [articleId]
  );
  const existing = existingRows[0];
  if (!existing) return sendJson(res, 404, { error: 'Article inconnu' });
  if (!canEditArticle(session, existing)) {
    return sendJson(res, 403, { error: 'Pas le droit sur cet article' });
  }

  // Plugins article (x, push, keywords, translate, …) — avant les routes core.
  if (await plugins.tryHandleArticle(req, res, parts, deskReqCtx, existing)) {
    return;
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

    // Première mise en ligne : date = maintenant. Republish après brouillon : garder la date.
    await ensureArticleDateNullable(pool);
    const wasDraft = Number(existing.draft) === 1;
    const slug = await resolveArticleSlug(
      pool,
      existing,
      existing.title,
      null
    );
    if (wasDraft) {
      const pubDate = toMysqlDate(existing.date) || nowMysql();
      const mod = nowMysql();
      await pool.query(
        'UPDATE el_articles SET draft = 0, date = ?, modified = ?, slug = ? WHERE article_id = ?',
        [pubDate, mod, slug, articleId]
      );
    } else if (slug !== existing.slug) {
      await pool.query(
        'UPDATE el_articles SET draft = 0, slug = ? WHERE article_id = ?',
        [slug, articleId]
      );
    } else {
      await pool.query('UPDATE el_articles SET draft = 0 WHERE article_id = ?', [
        articleId,
      ]);
    }
    const [rows] = await pool.query('SELECT * FROM el_articles WHERE article_id = ?', [
      articleId,
    ]);
    const article = rowToArticle(rows[0]);
    const contentGen = await emitDeskLifecycle(
      plugins,
      'onPublish',
      { article, wasDraft },
      deskReqCtx
    );
    let push = null;
    if (payload.push) {
      try {
        push = await pushPublishedArticle(rows[0], deskReqCtx, {
          segment: payload.segment,
        });
      } catch (err) {
        console.error('[desk] onesignal', err.message);
        return sendJson(res, 200, {
          article,
          contentGen,
          push: { ok: false, error: err.message },
        });
      }
    }
    await auditLog(pool, {
      actor,
      action: 'article.publish',
      targetType: 'article',
      targetId: articleId,
      meta: { push: Boolean(payload.push), pushOk: push?.ok ?? null, dryRun: push?.dryRun },
      ip,
    });
    return sendJson(res, 200, {
      article,
      contentGen,
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
      // Retour brouillon : conserve la date de 1ʳᵉ publication (remise en ligne = même date).
      await pool.query('UPDATE el_articles SET draft = 1 WHERE article_id = ?', [
        articleId,
      ]);
    } else {
      // Mise en ligne via /draft : date existante ou maintenant + slug
      const pubDate = toMysqlDate(existing.date) || nowMysql();
      const mod = nowMysql();
      const slug = await resolveArticleSlug(
        pool,
        existing,
        existing.title,
        null
      );
      await pool.query(
        'UPDATE el_articles SET draft = 0, date = ?, modified = ?, slug = ? WHERE article_id = ?',
        [pubDate, mod, slug, articleId]
      );
    }
    const [rows] = await pool.query(
      'SELECT * FROM el_articles WHERE article_id = ?',
      [articleId]
    );
    const article = rowToArticle(rows[0]);
    const contentGen = await emitDeskLifecycle(
      plugins,
      wantDraft ? 'onDraft' : 'onPublish',
      { article, draft: wantDraft },
      deskReqCtx
    );
    await auditLog(pool, {
      actor,
      action: wantDraft ? 'article.draft' : 'article.undraft',
      targetType: 'article',
      targetId: articleId,
      meta: { draft: wantDraft },
      ip,
    });
    return sendJson(res, 200, {
      article,
      contentGen,
    });
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
    // Brouillon : conserver date si déjà publiée un jour. En ligne : formulaire ou existante.
    const nextDate = isDraft
      ? toMysqlDate(existing.date) || toMysqlDate(payload.date) || null
      : toMysqlDate(payload.date) || toMysqlDate(existing.date) || nowMysql();
    // modified = dernière édition (tri desk) ; affichage « Mise à jour » seulement si publié
    await pool.query(
      `UPDATE el_articles SET
        slug=?, title=?, excerpt=?, body=?, date=?, modified=?,
        author=?, author_slug=?, author_user_id=?,
        categories=?, category_names=?, tags=?, ia_keywords=?,
        access=?, lang=?, draft=?,
        translation_fr=?, translation_en=?
       WHERE article_id=?`,
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
        articleId,
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
    const [rows] = await pool.query('SELECT * FROM el_articles WHERE article_id = ?', [
      articleId,
    ]);
    const article = rowToArticle(rows[0]);
    const contentGen = await emitDeskLifecycle(
      plugins,
      'onMutate',
      { article, action: 'update' },
      deskReqCtx
    );
    return sendJson(res, 200, {
      article,
      contentGen,
    });
  }

  if (req.method === 'DELETE' && !parts[4]) {
    if (!canEditAll(session.role)) {
      return sendJson(res, 403, { error: 'Suppression réservée éditeur/admin' });
    }
    // Délier les traductions avant suppression
    await pool.query(
      'UPDATE el_articles SET translation_en = NULL WHERE translation_en = ?',
      [articleId]
    );
    await pool.query(
      'UPDATE el_articles SET translation_fr = NULL WHERE translation_fr = ?',
      [articleId]
    );
    await pool.query('DELETE FROM el_articles WHERE article_id = ?', [articleId]);
    const contentGen = await emitDeskLifecycle(
      plugins,
      'onMutate',
      { articleId, action: 'delete' },
      deskReqCtx
    );
    await auditLog(pool, {
      actor,
      action: 'article.delete',
      targetType: 'article',
      targetId: articleId,
      ip,
    });
    return sendJson(res, 200, { ok: true, contentGen });
  }

  return sendJson(res, 404, { error: 'Route desk inconnue' });
}
