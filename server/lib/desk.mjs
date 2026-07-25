import { parseJsonArray, rowToArticle } from './db.mjs';
import { translateArticleFrToUk } from './deepl.mjs';
import { sendArticlePush } from './onesignal.mjs';
import { canAccessDesk, canEditAll, canPublish } from './roles.mjs';
import { canManageUsers, handleDeskUsers } from './users.mjs';
import { auditLog } from './audit.mjs';
import { handleDeskNewsletter } from './newsletter/handler.mjs';

export { canAccessDesk, canEditAll, canPublish };

export function canEditArticle(session, row) {
  if (!session || !canAccessDesk(session.role)) return false;
  if (canEditAll(session.role)) return true;
  return Number(row.author_user_id) === Number(session.uid);
}

function cleanHtml(html) {
  if (typeof html !== 'string') return '';
  return html
    .replace(/\s*data-(?:start|end|pm-slice|pm-paste)=["'][^"']*["']/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+>/g, '>')
    .trim();
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

/**
 * POST /api/desk/articles/:wpId/translate-uk
 * Source FR → brouillon EN-GB (création ou écrasement), liaison bidirectionnelle.
 */
async function translateUk(req, res, sourceRow, ctx) {
  const { pool, sendJson, readBody, deeplApiKey } = ctx;

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
  const excerpt = translated.excerpt || '';
  const body = cleanHtml(translated.body || '');
  const now = nowMysql();
  const cats = parseJsonArray(fr.categories);
  const catNames = parseJsonArray(fr.category_names);
  const tags = parseJsonArray(fr.tags);
  const ia = parseJsonArray(fr.ia_keywords);

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
        toMysqlDate(fr.date) || toMysqlDate(enExisting.date),
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
        toMysqlDate(fr.date) || now,
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
  return contentGen;
}
export function getContentGen() {
  return contentGen;
}

export async function handleDesk(req, res, parts, ctx) {
  const { pool, sendJson, readBody, resolveDeskSession, clientIp } = ctx;
  // Toujours recharger le rôle depuis MySQL (cookie seul = stale jusqu’à 14 j)
  const resolved = resolveDeskSession
    ? await resolveDeskSession(req)
    : null;
  const session = resolved?.session || null;
  if (!session || !canAccessDesk(session.role)) {
    return sendJson(res, 403, { error: 'Accès pupitre refusé' });
  }
  const ip = typeof clientIp === 'function' ? clientIp(req) : undefined;
  const actor = { uid: session.uid, login: session.login };

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
      },
      contentGen: getContentGen(),
    });
  }

  // /api/desk/content-gen
  if (parts[2] === 'content-gen' && req.method === 'GET') {
    return sendJson(res, 200, { contentGen: getContentGen() });
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

      const [[{ total }]] = await pool.query(
        `SELECT COUNT(*) AS total FROM el_articles ${whereSql}`,
        params
      );
      const [rows] = await pool.query(
        `SELECT wp_id, slug, title, excerpt, date, modified, author, author_user_id,
                access, lang, draft, categories, category_names
         FROM el_articles ${whereSql}
         ORDER BY COALESCE(modified, date) DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      return sendJson(res, 200, {
        total: Number(total),
        page,
        limit,
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
      // Author : toujours brouillon à la création
      const draft = canPublish(session.role)
        ? payload.draft === false
          ? 0
          : 1
        : 1;
      await pool.query(
        `INSERT INTO el_articles (
          wp_id, slug, title, excerpt, body, date, modified,
          author, author_slug, author_user_id,
          categories, category_names, tags, ia_keywords,
          access, lang, draft
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          wpId,
          slug,
          title,
          String(payload.excerpt || ''),
          cleanHtml(payload.body || ''),
          toMysqlDate(payload.date) || now,
          now,
          String(payload.author || session.name || session.login),
          payload.author_slug ? String(payload.author_slug) : slugify(session.login),
          session.uid,
          asJson(payload.categories),
          asJson(payload.category_names),
          asJson(payload.tags),
          asJson(payload.ia_keywords),
          payload.access === 'granted' ? 'granted' : 'subscribers',
          String(payload.lang || 'fr').toLowerCase(),
          draft,
        ]
      );
      bumpContentGen();
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

    await pool.query(
      'UPDATE el_articles SET draft = 0, modified = ? WHERE wp_id = ?',
      [nowMysql(), wpId]
    );
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
    return translateUk(req, res, existing, { ...ctx, actor, ip });
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
    let slug = existing.slug;
    if (payload.slug != null) {
      const wanted = String(payload.slug).trim() || existing.slug;
      slug = await uniqueSlug(pool, wanted, wpId);
    }
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

    await pool.query(
      `UPDATE el_articles SET
        slug=?, title=?, excerpt=?, body=?, date=?, modified=?,
        author=?, author_slug=?,
        categories=?, category_names=?, tags=?, ia_keywords=?,
        access=?, lang=?, draft=?,
        translation_fr=?, translation_en=?
       WHERE wp_id=?`,
      [
        slug,
        title,
        payload.excerpt != null ? String(payload.excerpt) : existing.excerpt || '',
        payload.body != null ? cleanHtml(payload.body) : existing.body || '',
        toMysqlDate(payload.date) || toMysqlDate(existing.date),
        nowMysql(),
        payload.author != null ? String(payload.author) : existing.author,
        payload.author_slug != null
          ? String(payload.author_slug)
          : existing.author_slug,
        asJson(cats),
        asJson(catNames),
        asJson(
          payload.tags != null ? payload.tags : parseJsonArray(existing.tags)
        ),
        asJson(
          payload.ia_keywords != null
            ? payload.ia_keywords
            : parseJsonArray(existing.ia_keywords)
        ),
        payload.access === 'granted'
          ? 'granted'
          : payload.access === 'subscribers'
            ? 'subscribers'
            : existing.access,
        payload.lang != null
          ? String(payload.lang).toLowerCase()
          : existing.lang,
        draftVal,
        payload.translation_fr != null
          ? Number(payload.translation_fr) || null
          : existing.translation_fr,
        payload.translation_en != null
          ? Number(payload.translation_en) || null
          : existing.translation_en,
        wpId,
      ]
    );
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
