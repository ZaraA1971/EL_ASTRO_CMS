import { auditLog } from '../../audit.mjs';
import { callEditorialAssist } from '../../editorial-assist.mjs';

export function handleDeskAssist(req, res, _parts, ctx) {
  return handle(req, res, ctx);
}

async function handle(req, res, ctx) {
  const { pool, sendJson, readBody, actor, ip } = ctx;
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
      targetId: body.articleId != null ? Number(body.articleId) || null : null,
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
