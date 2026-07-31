import { auditLog } from '../../../audit.mjs';
import { parseJsonArray, rowToArticle } from '../../../db.mjs';
import { translateArticleFrToUk } from '../../../deepl.mjs';
import { chapo } from '../../../excerpt.mjs';
import { cleanHtml } from '../../../html-clean.mjs';
import {
  asJson,
  canEditArticle,
  ensureArticleDateNullable,
  nextArticleId,
  nowMysql,
  uniqueSlug,
} from '../../core/article-helpers.mjs';
import { getContentGen } from '../../core/content-gen.mjs';
import { emitDeskLifecycle } from '../../core/lifecycle.mjs';

/**
 * POST /api/desk/articles/:articleId/translate-uk
 * Source FR → brouillon EN-GB (création ou écrasement), liaison bidirectionnelle.
 */
export async function handleDeskArticleTranslateUk(req, res, _parts, ctx, sourceRow) {
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
      'SELECT * FROM el_articles WHERE article_id = ? LIMIT 1',
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
      'SELECT * FROM el_articles WHERE article_id = ? LIMIT 1',
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
    const slug = await uniqueSlug(pool, title, enExisting.article_id);
    await pool.query(
      `UPDATE el_articles SET
        slug=?, title=?, excerpt=?, body=?, date=?, modified=?,
        author=?, author_slug=?, author_user_id=?,
        categories=?, category_names=?, tags=?, ia_keywords=?,
        access=?, lang='en', draft=1,
        translation_fr=?, translation_en=?
       WHERE article_id=?`,
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
        fr.article_id,
        enExisting.article_id,
        enExisting.article_id,
      ]
    );
    enId = Number(enExisting.article_id);
  } else {
    enId = await nextArticleId(pool);
    const slug = await uniqueSlug(pool, title);
    await pool.query(
      `INSERT INTO el_articles (
        article_id, slug, title, excerpt, body, date, modified,
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
        fr.article_id,
        enId,
      ]
    );
  }

  // Liaison bidirectionnelle côté FR
  await pool.query(
    'UPDATE el_articles SET translation_en = ?, translation_fr = ?, modified = ? WHERE article_id = ?',
    [enId, fr.article_id, now, fr.article_id]
  );

  const [rows] = await pool.query('SELECT * FROM el_articles WHERE article_id = ?', [
    enId,
  ]);
  const article = rowToArticle(rows[0]);
  const contentGen = await emitDeskLifecycle(
    ctx.plugins,
    'onMutate',
    { article, action: 'translate-uk', source_fr: Number(fr.article_id) },
    ctx
  );
  if (ctx.actor) {
    await auditLog(pool, {
      actor: ctx.actor,
      action: enExisting ? 'article.translate_uk_overwrite' : 'article.translate_uk',
      targetType: 'article',
      targetId: enId,
      meta: { source_fr: Number(fr.article_id), overwritten: Boolean(enExisting) },
      ip: ctx.ip,
    });
  }
  return sendJson(res, enExisting ? 200 : 201, {
    article,
    created: !enExisting,
    overwritten: Boolean(enExisting),
    source_fr: Number(fr.article_id),
    contentGen: contentGen || getContentGen(),
  });
}
