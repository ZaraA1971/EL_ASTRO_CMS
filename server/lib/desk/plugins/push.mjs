import { auditLog } from '../../audit.mjs';
import { sendArticlePush } from '../../onesignal.mjs';
import { canPublish } from '../../roles.mjs';

export async function handleDeskArticlePush(req, res, _parts, ctx, article) {
  const { pool, sendJson, readBody, session, actor, ip } = ctx;
  const articleId = Number(article.article_id);
  if (!canPublish(session.role)) {
    return sendJson(res, 403, {
      error: 'Push réservé éditeur/admin',
    });
  }
  if (Number(article.draft)) {
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
    const push = await sendArticlePush(article, {
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
      targetId: articleId,
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
