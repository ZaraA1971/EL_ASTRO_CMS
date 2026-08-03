/**
 * Routes Desk X : /api/desk/articles/:id/x[/{generate|post}]
 */

import { rowToArticle } from './db.mjs';
import { canPublish } from './roles.mjs';
import { auditLog } from './audit.mjs';
import { ensureXPostsSchema } from './x-schema.mjs';
import {
  DEFAULT_X_ACCOUNT,
  normalizeXAccount,
  listXAccountsPublic,
} from './x-accounts.mjs';
import { createXPost, assertXText, xWeightedLength } from './x-post.mjs';
import { generateXVariants } from './x-generate.mjs';
import { nowMysql } from './mysql-date.mjs';
import { absoluteArticleUrl } from './article-path.mjs';

function mapRow(row) {
  if (!row) return null;
  let variants = null;
  if (row.variants_json) {
    try {
      variants =
        typeof row.variants_json === 'string'
          ? JSON.parse(row.variants_json)
          : row.variants_json;
    } catch {
      variants = null;
    }
  }
  return {
    id: Number(row.id),
    articleId: Number(row.article_id),
    account: row.account,
    text: row.text,
    variants: Array.isArray(variants) ? variants : null,
    tweetId: row.tweet_id || null,
    status: row.status,
    error: row.error || null,
    url: row.tweet_id ? `https://x.com/i/web/status/${row.tweet_id}` : null,
    actorLogin: row.actor_login || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    postedAt: row.posted_at,
    chars: xWeightedLength(row.text || ''),
  };
}

async function loadLatestDraft(pool, articleId, account) {
  const [rows] = await pool.query(
    `SELECT * FROM el_x_posts
     WHERE article_id = ? AND account = ? AND status = 'draft'
     ORDER BY id DESC LIMIT 1`,
    [articleId, account]
  );
  return rows[0] || null;
}

async function loadLastPosted(pool, articleId, account) {
  const [rows] = await pool.query(
    `SELECT * FROM el_x_posts
     WHERE article_id = ? AND account = ? AND status IN ('posted','dry_run')
     ORDER BY id DESC LIMIT 1`,
    [articleId, account]
  );
  return rows[0] || null;
}

async function upsertDraft(pool, {
  articleId,
  account,
  text,
  variants,
  actor,
}) {
  const existing = await loadLatestDraft(pool, articleId, account);
  const variantsJson =
    variants != null ? JSON.stringify(variants) : existing?.variants_json || null;
  if (existing) {
    await pool.query(
      `UPDATE el_x_posts
       SET text = ?, variants_json = ?, error = NULL, actor_id = ?, actor_login = ?
       WHERE id = ?`,
      [
        text,
        variantsJson,
        actor?.uid != null ? Number(actor.uid) : null,
        actor?.login || null,
        existing.id,
      ]
    );
    const [rows] = await pool.query(
      'SELECT * FROM el_x_posts WHERE id = ? LIMIT 1',
      [existing.id]
    );
    return rows[0];
  }
  const [ins] = await pool.query(
    `INSERT INTO el_x_posts
      (article_id, account, text, variants_json, status, actor_id, actor_login)
     VALUES (?, ?, ?, ?, 'draft', ?, ?)`,
    [
      articleId,
      account,
      text,
      variantsJson,
      actor?.uid != null ? Number(actor.uid) : null,
      actor?.login || null,
    ]
  );
  const [rows] = await pool.query(
    'SELECT * FROM el_x_posts WHERE id = ? LIMIT 1',
    [ins.insertId]
  );
  return rows[0];
}

/**
 * @returns {Promise<boolean>} true si traité
 */
export async function handleDeskArticleX(req, res, parts, ctx, existing) {
  const action = parts[5] || '';
  if (parts[4] !== 'x') return false;
  if (action && action !== 'generate' && action !== 'post') {
    ctx.sendJson(res, 404, { error: 'Sous-route X inconnue' });
    return true;
  }

  const { pool, sendJson, readBody, session, actor, ip } = ctx;
  await ensureXPostsSchema(pool);
  const articleId = Number(existing.article_id);
  const xEnv = ctx.x?.env || {};

  // GET — brouillon + dernier post
  if (!action && req.method === 'GET') {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const account =
      normalizeXAccount(url.searchParams.get('account')) || DEFAULT_X_ACCOUNT;
    const draft = await loadLatestDraft(pool, articleId, account);
    const last = await loadLastPosted(pool, articleId, account);
    sendJson(res, 200, {
      account,
      accounts: listXAccountsPublic(xEnv),
      dryRun: Boolean(ctx.x?.dryRun),
      draft: mapRow(draft),
      lastPost: mapRow(last),
      article: {
        id: articleId,
        title: existing.title,
        url: absoluteArticleUrl(ctx.siteUrl, articleId, existing.slug),
      },
    });
    return true;
  }

  // PUT — sauver brouillon
  if (!action && req.method === 'PUT') {
    let body = {};
    try {
      const raw = (await readBody(req)).toString('utf8');
      if (raw.trim()) body = JSON.parse(raw);
    } catch {
      sendJson(res, 400, { error: 'JSON invalide' });
      return true;
    }
    const account =
      normalizeXAccount(body.account) || DEFAULT_X_ACCOUNT;
    let text;
    try {
      text = assertXText(body.text);
    } catch (err) {
      sendJson(res, err.status || 400, { error: err.message, code: err.code });
      return true;
    }
    const variants = Array.isArray(body.variants)
      ? body.variants.map((v) => String(v || '').trim()).filter(Boolean).slice(0, 5)
      : null;
    const row = await upsertDraft(pool, {
      articleId: articleId,
      account,
      text,
      variants,
      actor,
    });
    await auditLog(pool, {
      actor,
      action: 'article.x_draft',
      targetType: 'article',
      targetId: articleId,
      meta: { account, chars: xWeightedLength(text) },
      ip,
    });
    sendJson(res, 200, { ok: true, draft: mapRow(row) });
    return true;
  }

  // POST generate
  if (action === 'generate' && req.method === 'POST') {
    let body = {};
    try {
      const raw = (await readBody(req)).toString('utf8');
      if (raw.trim()) body = JSON.parse(raw);
    } catch {
      sendJson(res, 400, { error: 'JSON invalide' });
      return true;
    }
    const account =
      normalizeXAccount(body.account) || DEFAULT_X_ACCOUNT;
    try {
      const gen = await generateXVariants(existing, {
        account,
        siteUrl: ctx.siteUrl,
        agentEditorial: ctx.agentEditorial,
      });
      const row = await upsertDraft(pool, {
        articleId: articleId,
        account,
        text: gen.text,
        variants: gen.variants,
        actor,
      });
      await auditLog(pool, {
        actor,
        action: 'article.x_generate',
        targetType: 'article',
        targetId: articleId,
        meta: { account, source: gen.source, n: gen.variants.length },
        ip,
      });
      sendJson(res, 200, {
        ok: true,
        account: gen.account,
        handle: gen.handle,
        url: gen.url,
        variants: gen.variants,
        text: gen.text,
        source: gen.source,
        draft: mapRow(row),
      });
    } catch (err) {
      console.error('[desk] x generate', err.message);
      sendJson(res, err.status || 502, {
        error: err.message || 'Échec génération X',
        code: err.code || 'X_GENERATE',
      });
    }
    return true;
  }

  // POST post
  if (action === 'post' && req.method === 'POST') {
    if (!canPublish(session.role)) {
      sendJson(res, 403, { error: 'Publication X réservée éditeur/admin' });
      return true;
    }
    let body = {};
    try {
      const raw = (await readBody(req)).toString('utf8');
      if (raw.trim()) body = JSON.parse(raw);
    } catch {
      sendJson(res, 400, { error: 'JSON invalide' });
      return true;
    }
    const account =
      normalizeXAccount(body.account) || DEFAULT_X_ACCOUNT;
    let text;
    try {
      text = assertXText(body.text);
    } catch (err) {
      sendJson(res, err.status || 400, { error: err.message, code: err.code });
      return true;
    }

    // Garde le brouillon à jour
    await upsertDraft(pool, {
      articleId: articleId,
      account,
      text,
      variants: null,
      actor,
    });

    try {
      const posted = await createXPost({
        account,
        text,
        env: xEnv,
        dryRun: Boolean(ctx.x?.dryRun),
      });
      const status = posted.dryRun ? 'dry_run' : 'posted';
      const [ins] = await pool.query(
        `INSERT INTO el_x_posts
          (article_id, account, text, tweet_id, status, actor_id, actor_login, posted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          articleId,
          account,
          posted.text,
          posted.tweetId,
          status,
          actor?.uid != null ? Number(actor.uid) : null,
          actor?.login || null,
          nowMysql(),
        ]
      );
      await auditLog(pool, {
        actor,
        action: 'article.x_post',
        targetType: 'article',
        targetId: articleId,
        meta: {
          account,
          dryRun: posted.dryRun,
          tweetId: posted.tweetId,
          handle: posted.handle,
        },
        ip,
      });
      const [rows] = await pool.query(
        'SELECT * FROM el_x_posts WHERE id = ? LIMIT 1',
        [ins.insertId]
      );
      sendJson(res, 200, {
        ok: true,
        post: mapRow(rows[0]),
        dryRun: posted.dryRun,
        handle: posted.handle,
        tweetId: posted.tweetId,
        url: posted.url,
        article: rowToArticle(existing),
      });
    } catch (err) {
      console.error('[desk] x post', err.message);
      await pool.query(
        `INSERT INTO el_x_posts
          (article_id, account, text, status, error, actor_id, actor_login)
         VALUES (?, ?, ?, 'error', ?, ?, ?)`,
        [
          articleId,
          account,
          text,
          String(err.message || 'error').slice(0, 500),
          actor?.uid != null ? Number(actor.uid) : null,
          actor?.login || null,
        ]
      ).catch(() => {});
      sendJson(res, err.status || 502, {
        error: err.message || 'Échec publication X',
        code: err.code || 'X_POST',
      });
    }
    return true;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
  return true;
}
