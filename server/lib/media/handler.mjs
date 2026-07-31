/**
 * Compat — wrapper EL autour de `handleCoreMedia`.
 * Chemin live : `desk.mjs` → `tryHandleCoreCrud` (même store/FS).
 * Conservé pour appels directs hors host.
 */
import { canEditAll, isStaffRole } from '../roles.mjs';
import { auditLog } from '../audit.mjs';
import { elMediaStore } from './schema.mjs';
import {
  resolveMediaRoot,
  slugifyFilename,
  yyyymmDirs,
  uniqueRelPath,
  publicUrlFromPath,
  absoluteFromRel,
  toMediaDto,
  MAX_UPLOAD_BYTES,
} from './storage.mjs';
import { detectMediaMime, writeMediaFile } from './process.mjs';
import { handleCoreMedia } from '../desk/core/media/router.mjs';

const mediaFs = {
  resolveMediaRoot,
  slugifyFilename,
  yyyymmDirs,
  uniqueRelPath,
  publicUrlFromPath,
  absoluteFromRel,
  toMediaDto,
  MAX_UPLOAD_BYTES,
  detectMediaMime,
  writeMediaFile,
};

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string[]} parts — ['api','desk','media', ...]
 */
export async function handleDeskMedia(req, res, parts, ctx) {
  return handleCoreMedia(req, res, parts, {
    ...ctx,
    mediaStore: ctx.mediaStore || elMediaStore,
    mediaFs: ctx.mediaFs || mediaFs,
    canEditAll: ctx.canEditAll || canEditAll,
    isStaffRole: ctx.isStaffRole || isStaffRole,
    auditLog: ctx.auditLog || auditLog,
  });
}
