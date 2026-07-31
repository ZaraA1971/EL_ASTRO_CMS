import { auditLog } from '../../audit.mjs';
import { rowToArticle } from '../../db.mjs';
import {
  buildKeywordSource,
  extractKeywordsViaRag,
} from '../../keywords.mjs';
import { cleanHtml } from '../../html-clean.mjs';
import { asJson, syncKeywordsToTwin } from '../article-helpers.mjs';
import { bumpContentGen, getContentGen } from '../content-gen.mjs';

export async function handleDeskArticleKeywords(req, res, _parts, ctx, existing) {
  const { pool, sendJson, readBody, session, actor, ip } = ctx;
  const articleId = Number(existing.article_id);
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
      'UPDATE el_articles SET ia_keywords = ?, access = ? WHERE article_id = ?',
      [asJson(keywords), 'subscribers', articleId]
    );
    existing.access = 'subscribers';
    const twinId = await syncKeywordsToTwin(pool, session, existing, keywords);
    bumpContentGen();
    await auditLog(pool, {
      actor,
      action: 'article.keywords',
      targetType: 'article',
      targetId: articleId,
      meta: { count: keywords.length, language, twinId },
      ip,
    });
    const [rows] = await pool.query(
      'SELECT * FROM el_articles WHERE article_id = ?',
      [articleId]
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
