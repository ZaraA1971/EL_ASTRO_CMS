import { getContentGen } from '../content-gen.mjs';

export function handleDeskContentGen(_req, res, _parts, ctx) {
  return ctx.sendJson(res, 200, { contentGen: getContentGen() });
}
