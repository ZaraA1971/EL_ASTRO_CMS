import { getContentGen } from '../../core/content-gen.mjs';

export function handleDeskContentGen(_req, res, _parts, ctx) {
  return ctx.sendJson(res, 200, { contentGen: getContentGen() });
}
