/**
 * CRUD articles portable — table + helpers + hooks host injectés via ctx.
 *
 * ctx requis :
 *   pool, sendJson, readBody, session, actor, ip, plugins
 *   articleHelpers (createArticleHelpers / article-host)
 *   articlesTable (ou articleHelpers.tableName)
 *   rowToArticle, parseJsonArray, canEditAll, canPublish
 *   cleanHtml, chapo
 *
 * ctx optionnel :
 *   auditLog, normalizeKeywords
 *   ensureSubscriberKeywords, loadEditableTwin, syncKeywordsToTwin
 *   beforeArticleRoute(req,res,parts,ctx,existing) → true si déjà répondu
 *   afterPublish({ article, row, payload, contentGen }, ctx) → { push } | null
 */
import { assertSafeSqlIdent, parseJsonBody } from '../http.mjs';
import { emitDeskLifecycle } from '../lifecycle.mjs';
import {
  isEditorialUpdate,
  shouldBumpEditorialModified,
} from '../../../editorial-update.mjs';

function tableOf(ctx) {
  return assertSafeSqlIdent(
    ctx.articlesTable || ctx.articleHelpers?.tableName || 'articles',
    'table articles'
  );
}

function helpersOf(ctx) {
  const h = ctx.articleHelpers;
  if (!h?.canEditArticle || !h?.uniqueSlug || !h?.nextArticleId) {
    throw new Error('ctx.articleHelpers incomplet');
  }
  return h;
}

async function applyExclusivePin(pool, table, articleId, lang, pinned) {
  const on = pinned ? 1 : 0;
  if (on) {
    await pool.query(
      `UPDATE \`${table}\` SET pinned = 0
       WHERE lang = ? AND article_id != ? AND pinned = 1`,
      [lang, articleId]
    );
  }
  await pool.query(
    `UPDATE \`${table}\` SET pinned = ? WHERE article_id = ?`,
    [on, articleId]
  );
}

function normKeywords(ctx, raw) {
  if (typeof ctx.normalizeKeywords === 'function') {
    return ctx.normalizeKeywords(raw);
  }
  if (Array.isArray(raw)) return raw.map(String);
  if (raw == null) return [];
  return [String(raw)];
}

/** Collection GET/POST /api/desk/articles */
async function handleCollection(req, res, ctx) {
  const {
    pool,
    sendJson,
    readBody,
    session,
    actor,
    ip,
    plugins,
    rowToArticle,
    canEditAll,
    canPublish,
    cleanHtml,
    chapo,
    auditLog,
  } = ctx;
  const h = helpersOf(ctx);
  const table = tableOf(ctx);

  if (req.method === 'GET') {
    await h.ensureArticlePinnedColumn(pool);
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const q = String(url.searchParams.get('q') || '').trim();
    const lang = String(url.searchParams.get('lang') || '').trim();
    const draftParam = url.searchParams.get('draft');
    const category = String(url.searchParams.get('category') || '')
      .trim()
      .toLowerCase();
    const author = String(url.searchParams.get('author') || '').trim();
    const dateDay = String(url.searchParams.get('date') || '').trim();
    const modifiedDay = String(url.searchParams.get('modified') || '').trim();
    const dayRe = /^\d{4}-\d{2}-\d{2}$/;
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit = Math.min(
      50,
      Math.max(1, Number(url.searchParams.get('limit') || 20))
    );

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
    if (category) {
      // categories = JSON array de slugs (ex. ["ia","robotic"])
      // MariaDB: JSON_CONTAINS(col, ?) avec un littéral JSON string — pas CAST(? AS JSON)
      where.push('JSON_CONTAINS(categories, ?)');
      params.push(JSON.stringify(category));
    }
    if (author) {
      where.push('author = ?');
      params.push(author);
    }
    if (dayRe.test(dateDay)) {
      where.push('DATE(`date`) = ?');
      params.push(dateDay);
    }
    if (dayRe.test(modifiedDay)) {
      where.push('DATE(`modified`) = ?');
      params.push(modifiedDay);
    }
    if (q) {
      where.push('(title LIKE ? OR excerpt LIKE ? OR slug LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [[{ total: totalRaw }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM \`${table}\` ${whereSql}`,
      params
    );
    const total = Number(totalRaw || 0);
    const pages = Math.max(1, Math.ceil(total / limit) || 1);
    const pageClamped = Math.min(page, pages);
    const offsetClamped = (pageClamped - 1) * limit;
    const [rows] = await pool.query(
      `SELECT article_id, slug, title, date, modified, author, author_user_id,
              categories, category_names, access, lang, draft, pinned
       FROM \`${table}\` ${whereSql}
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
    const parsed = await parseJsonBody(req, readBody);
    if (!parsed.ok) {
      return sendJson(res, 400, { error: 'JSON invalide' });
    }
    const payload = parsed.value;
    const title = String(payload.title || 'Sans titre').trim() || 'Sans titre';
    const slug = await h.uniqueSlug(
      pool,
      String(payload.slug || '').trim() || title
    );
    const articleId = await h.nextArticleId(pool);
    const now = h.nowMysql();
    await h.ensureArticleDateNullable(pool);
    await h.ensureArticlePinnedColumn(pool);
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
    const authorUserId = session.ingest
      ? payload.author_user_id != null
        ? Number(payload.author_user_id) || null
        : null
      : session.uid || null;
    const pubDate = draft ? null : h.toMysqlDate(payload.date) || now;
    await pool.query(
      `INSERT INTO \`${table}\` (
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
          : h.slugify(session.login),
        authorUserId,
        h.asJson(payload.categories),
        h.asJson(payload.category_names),
        h.asJson(payload.tags),
        h.asJson(
          payload.access === 'granted'
            ? []
            : normKeywords(ctx, payload.ia_keywords)
        ),
        payload.access === 'granted' ? 'granted' : 'subscribers',
        String(payload.lang || 'fr').toLowerCase(),
        draft,
        sourceUrl,
      ]
    );
    const [rows] = await pool.query(
      `SELECT * FROM \`${table}\` WHERE article_id = ?`,
      [articleId]
    );
    const article = rowToArticle(rows[0]);
    await emitDeskLifecycle(
      plugins,
      'onMutate',
      { article, action: 'create' },
      ctx
    );
    if (session.ingest && typeof auditLog === 'function') {
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

async function handlePublish(req, res, ctx, existing, articleId) {
  const {
    pool,
    sendJson,
    readBody,
    session,
    actor,
    ip,
    plugins,
    rowToArticle,
    canPublish,
    auditLog,
    afterPublish,
  } = ctx;
  const h = helpersOf(ctx);
  const table = tableOf(ctx);

  if (!canPublish(session.role)) {
    return sendJson(res, 403, {
      error: 'Publication réservée éditeur/admin',
    });
  }
  const parsed = await parseJsonBody(req, readBody, { allowEmpty: true });
  if (!parsed.ok) {
    return sendJson(res, 400, { error: 'JSON invalide' });
  }
  const payload = parsed.value;

  await h.ensureArticleDateNullable(pool);
  const wasDraft = Number(existing.draft) === 1;
  const slug = await h.resolveArticleSlug(
    pool,
    existing,
    existing.title,
    null
  );
  if (wasDraft) {
    const pubDate = h.toMysqlDate(existing.date) || h.nowMysql();
    const mod = h.nowMysql();
    await pool.query(
      `UPDATE \`${table}\` SET draft = 0, date = ?, modified = ?, slug = ? WHERE article_id = ?`,
      [pubDate, mod, slug, articleId]
    );
  } else if (slug !== existing.slug) {
    await pool.query(
      `UPDATE \`${table}\` SET draft = 0, slug = ? WHERE article_id = ?`,
      [slug, articleId]
    );
  } else {
    await pool.query(
      `UPDATE \`${table}\` SET draft = 0 WHERE article_id = ?`,
      [articleId]
    );
  }
  const [rows] = await pool.query(
    `SELECT * FROM \`${table}\` WHERE article_id = ?`,
    [articleId]
  );
  const article = rowToArticle(rows[0]);
  const contentGen = await emitDeskLifecycle(
    plugins,
    'onPublish',
    { article, wasDraft },
    ctx
  );

  let push = null;
  if (payload.push && typeof afterPublish === 'function') {
    try {
      push = await afterPublish(
        { article, row: rows[0], payload, contentGen },
        ctx
      );
    } catch (err) {
      console.error('[desk] afterPublish', err.message);
      return sendJson(res, 200, {
        article,
        contentGen,
        push: { ok: false, error: err.message },
      });
    }
  }

  if (typeof auditLog === 'function') {
    await auditLog(pool, {
      actor,
      action: 'article.publish',
      targetType: 'article',
      targetId: articleId,
      meta: {
        push: Boolean(payload.push),
        pushOk: push?.ok ?? null,
        dryRun: push?.dryRun,
      },
      ip,
    });
  }
  return sendJson(res, 200, {
    article,
    contentGen,
    push: push ? { ok: true, ...push } : null,
  });
}

async function handleDraft(req, res, ctx, existing, articleId) {
  const {
    pool,
    sendJson,
    readBody,
    session,
    actor,
    ip,
    plugins,
    rowToArticle,
    canPublish,
    auditLog,
  } = ctx;
  const h = helpersOf(ctx);
  const table = tableOf(ctx);

  const parsed = await parseJsonBody(req, readBody, { allowEmpty: true });
  if (!parsed.ok) {
    return sendJson(res, 400, { error: 'JSON invalide' });
  }
  const payload = parsed.value;
  const wantDraft = payload.draft !== false && payload.draft !== 0;
  if (!wantDraft && !canPublish(session.role)) {
    return sendJson(res, 403, {
      error: 'Publication réservée éditeur/admin',
    });
  }
  await h.ensureArticleDateNullable(pool);
  if (wantDraft) {
    await pool.query(
      `UPDATE \`${table}\` SET draft = 1 WHERE article_id = ?`,
      [articleId]
    );
  } else {
    const pubDate = h.toMysqlDate(existing.date) || h.nowMysql();
    const mod = h.nowMysql();
    const slug = await h.resolveArticleSlug(
      pool,
      existing,
      existing.title,
      null
    );
    await pool.query(
      `UPDATE \`${table}\` SET draft = 0, date = ?, modified = ?, slug = ? WHERE article_id = ?`,
      [pubDate, mod, slug, articleId]
    );
  }
  const [rows] = await pool.query(
    `SELECT * FROM \`${table}\` WHERE article_id = ?`,
    [articleId]
  );
  const article = rowToArticle(rows[0]);
  const contentGen = await emitDeskLifecycle(
    plugins,
    wantDraft ? 'onDraft' : 'onPublish',
    { article, draft: wantDraft },
    ctx
  );
  if (typeof auditLog === 'function') {
    await auditLog(pool, {
      actor,
      action: wantDraft ? 'article.draft' : 'article.undraft',
      targetType: 'article',
      targetId: articleId,
      meta: { draft: wantDraft },
      ip,
    });
  }
  return sendJson(res, 200, { article, contentGen });
}

async function handleUpdate(req, res, ctx, existing, articleId) {
  const {
    pool,
    sendJson,
    readBody,
    session,
    plugins,
    rowToArticle,
    parseJsonArray,
    canEditAll,
    canPublish,
    cleanHtml,
    chapo,
    ensureSubscriberKeywords,
    loadEditableTwin,
    syncKeywordsToTwin,
  } = ctx;
  const h = helpersOf(ctx);
  const table = tableOf(ctx);

  const parsed = await parseJsonBody(req, readBody);
  if (!parsed.ok) {
    return sendJson(res, 400, { error: 'JSON invalide' });
  }
  const payload = parsed.value;
  const payloadKeys = Object.keys(payload).filter((k) => payload[k] !== undefined);
  if (
    payloadKeys.length === 1 &&
    payloadKeys[0] === 'pinned' &&
    canPublish(session.role)
  ) {
    await h.ensureArticlePinnedColumn(pool);
    const access = String(existing.access || 'subscribers');
    const pinnedNext =
      access === 'granted'
        ? 0
        : payload.pinned === true || payload.pinned === 1
          ? 1
          : 0;
    const lang = String(existing.lang || 'fr').toLowerCase();
    await applyExclusivePin(pool, table, articleId, lang, pinnedNext);
    const [pinRows] = await pool.query(
      `SELECT * FROM \`${table}\` WHERE article_id = ?`,
      [articleId]
    );
    const article = rowToArticle(pinRows[0]);
    const contentGen = await emitDeskLifecycle(
      plugins,
      'onMutate',
      { article, action: 'pin' },
      ctx
    );
    return sendJson(res, 200, { article, contentGen });
  }
  const title =
    payload.title != null
      ? String(payload.title).trim() || existing.title
      : existing.title;
  // Avoid ER_DATA_TOO_LONG / process crash when body lands in title.
  if (String(title || '').length > 200) {
    return sendJson(res, 400, {
      error: 'Titre trop long (max 200 caractères) — le corps va dans body, pas title',
      code: 'TITLE_TOO_LONG',
    });
  }
  const slug = await h.resolveArticleSlug(pool, existing, title, payload.slug);
  const cats =
    payload.categories != null
      ? payload.categories
      : parseJsonArray(existing.categories);
  const catNames =
    payload.category_names != null
      ? payload.category_names
      : parseJsonArray(existing.category_names);

  let draftVal = existing.draft;
  if (payload.draft === true) draftVal = 1;
  else if (payload.draft === false && canPublish(session.role)) draftVal = 0;

  const authorName =
    payload.author != null ? String(payload.author).trim() : existing.author;
  const authorSlug =
    payload.author_slug != null
      ? String(payload.author_slug).trim() || h.slugify(authorName)
      : payload.author != null
        ? h.slugify(authorName)
        : existing.author_slug;
  const authorUserId =
    payload.author_user_id !== undefined
      ? payload.author_user_id != null
        ? Number(payload.author_user_id) || null
        : null
      : existing.author_user_id;

  const bodyHtml =
    payload.body != null
      ? cleanHtml(payload.body, 'store')
      : existing.body || '';
  const excerpt = chapo(bodyHtml, 'store');
  const accessNext =
    payload.access === 'granted'
      ? 'granted'
      : payload.access === 'subscribers'
        ? 'subscribers'
        : existing.access;

  let iaKeywordsNext =
    accessNext === 'granted'
      ? []
      : payload.ia_keywords != null
        ? normKeywords(ctx, payload.ia_keywords)
        : parseJsonArray(existing.ia_keywords);
  let autoKeywords = false;
  if (
    accessNext === 'subscribers' &&
    !iaKeywordsNext.length &&
    typeof ensureSubscriberKeywords === 'function'
  ) {
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

  let translationFr = existing.translation_fr;
  let translationEn = existing.translation_en;
  if (canEditAll(session.role) && typeof loadEditableTwin === 'function') {
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
  } else if (canEditAll(session.role)) {
    if (payload.translation_fr !== undefined) {
      translationFr =
        payload.translation_fr != null
          ? Number(payload.translation_fr) || null
          : null;
    }
    if (payload.translation_en !== undefined) {
      translationEn =
        payload.translation_en != null
          ? Number(payload.translation_en) || null
          : null;
    }
  }

  await h.ensureArticleDateNullable(pool);
  await h.ensureArticlePinnedColumn(pool);
  const isDraft = Number(draftVal) === 1;
  const nextDate = isDraft
    ? h.toMysqlDate(existing.date) || h.toMysqlDate(payload.date) || null
    : h.toMysqlDate(payload.date) ||
      h.toMysqlDate(existing.date) ||
      h.nowMysql();

  const tagsNext =
    payload.tags != null ? payload.tags : parseJsonArray(existing.tags);
  const langNext =
    payload.lang != null
      ? String(payload.lang).toLowerCase()
      : existing.lang;
  // datetime-local côté desk est à la minute — ignorer les secondes.
  const dateKey = (v) => {
    const s = h.toMysqlDate(v);
    return s ? s.slice(0, 16) : null;
  };
  // Contenu seul (titre/corps/slug/date/draft/lang/trad) → remonte `modified`.
  // Accès, rubriques, auteur, tags, mots-clés IA, épingle Une : non.
  const otherFieldsChanged =
    title !== String(existing.title || '') ||
    slug !== String(existing.slug || '') ||
    bodyHtml !== String(existing.body || '') ||
    Number(draftVal) !== Number(existing.draft) ||
    String(langNext || '') !== String(existing.lang || '') ||
    (translationFr == null ? null : Number(translationFr)) !==
      (existing.translation_fr == null
        ? null
        : Number(existing.translation_fr)) ||
    (translationEn == null ? null : Number(translationEn)) !==
      (existing.translation_en == null
        ? null
        : Number(existing.translation_en)) ||
    dateKey(nextDate) !== dateKey(existing.date);

  const nowMysql = h.nowMysql();
  const publishedForGrace = existing.date || nextDate;
  let nextModified = nowMysql;
  if (!shouldBumpEditorialModified({ otherFieldsChanged })) {
    // Métas seules / no-op : garder modified / date de pub.
    nextModified =
      h.toMysqlDate(existing.modified) ||
      h.toMysqlDate(existing.date) ||
      nowMysql;
  } else if (
    !isDraft &&
    publishedForGrace &&
    !isEditorialUpdate(publishedForGrace, new Date())
  ) {
    // En ligne : pas de tampon « mise à jour » dans les 45 min après publication.
    nextModified =
      nextDate || h.toMysqlDate(publishedForGrace) || nowMysql;
  }

  try {
    await pool.query(
      `UPDATE \`${table}\` SET
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
        nextModified,
        authorName,
        authorSlug,
        authorUserId,
        h.asJson(cats),
        h.asJson(catNames),
        h.asJson(tagsNext),
        h.asJson(iaKeywordsNext),
        accessNext,
        langNext,
        draftVal,
        translationFr,
        translationEn,
        articleId,
      ]
    );

    if (accessNext === 'granted' && Number(existing.pinned) === 1) {
      await applyExclusivePin(pool, table, articleId, langNext, false);
    }

    if (
      typeof syncKeywordsToTwin === 'function' &&
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

    const [rows] = await pool.query(
      `SELECT * FROM \`${table}\` WHERE article_id = ?`,
      [articleId]
    );
    const article = rowToArticle(rows[0]);
    const contentGen = await emitDeskLifecycle(
      plugins,
      'onMutate',
      { article, action: 'update' },
      ctx
    );
    return sendJson(res, 200, { article, contentGen });
  } catch (err) {
    const sqlMsg = err && (err.sqlMessage || err.message);
    const code = err && err.code;
    const status =
      code === 'ER_DATA_TOO_LONG' || code === 'ER_TRUNCATED_WRONG_VALUE'
        ? 400
        : 500;
    return sendJson(res, status, {
      error: sqlMsg || 'Erreur mise à jour article',
      code: code || 'UPDATE_FAILED',
    });
  }
}

async function handleDelete(req, res, ctx, _existing, articleId) {
  const {
    pool,
    sendJson,
    session,
    actor,
    ip,
    plugins,
    canEditAll,
    auditLog,
  } = ctx;
  const table = tableOf(ctx);

  if (!canEditAll(session.role)) {
    return sendJson(res, 403, {
      error: 'Suppression réservée éditeur/admin',
    });
  }
  await pool.query(
    `UPDATE \`${table}\` SET translation_en = NULL WHERE translation_en = ?`,
    [articleId]
  );
  await pool.query(
    `UPDATE \`${table}\` SET translation_fr = NULL WHERE translation_fr = ?`,
    [articleId]
  );
  await pool.query(`DELETE FROM \`${table}\` WHERE article_id = ?`, [
    articleId,
  ]);
  const contentGen = await emitDeskLifecycle(
    plugins,
    'onMutate',
    { articleId, action: 'delete' },
    ctx
  );
  if (typeof auditLog === 'function') {
    await auditLog(pool, {
      actor,
      action: 'article.delete',
      targetType: 'article',
      targetId: articleId,
      ip,
    });
  }
  return sendJson(res, 200, { ok: true, contentGen });
}

/**
 * @returns {Promise<boolean>} true si la route articles a été traitée
 */
export async function handleCoreArticles(req, res, parts, ctx) {
  const { pool, sendJson } = ctx;
  const h = helpersOf(ctx);
  const table = tableOf(ctx);

  if (parts[2] !== 'articles') return false;

  if (!parts[3]) {
    await handleCollection(req, res, ctx);
    return true;
  }

  const articleId = Number(parts[3]);
  if (!articleId) {
    sendJson(res, 400, { error: 'article_id invalide' });
    return true;
  }

  const [existingRows] = await pool.query(
    `SELECT * FROM \`${table}\` WHERE article_id = ? LIMIT 1`,
    [articleId]
  );
  const existing = existingRows[0];
  if (!existing) {
    sendJson(res, 404, { error: 'Article inconnu' });
    return true;
  }
  if (!h.canEditArticle(ctx.session, existing)) {
    sendJson(res, 403, { error: 'Pas le droit sur cet article' });
    return true;
  }

  if (typeof ctx.beforeArticleRoute === 'function') {
    const handled = await ctx.beforeArticleRoute(
      req,
      res,
      parts,
      ctx,
      existing
    );
    if (handled) return true;
  }

  if (parts[4] === 'publish' && req.method === 'POST') {
    await handlePublish(req, res, ctx, existing, articleId);
    return true;
  }
  if (parts[4] === 'draft' && req.method === 'POST') {
    await handleDraft(req, res, ctx, existing, articleId);
    return true;
  }
  if (req.method === 'GET' && !parts[4]) {
    sendJson(res, 200, { article: ctx.rowToArticle(existing) });
    return true;
  }
  if (req.method === 'PUT' && !parts[4]) {
    await handleUpdate(req, res, ctx, existing, articleId);
    return true;
  }
  if (req.method === 'DELETE' && !parts[4]) {
    await handleDelete(req, res, ctx, existing, articleId);
    return true;
  }

  sendJson(res, 404, { error: 'Route desk inconnue' });
  return true;
}
