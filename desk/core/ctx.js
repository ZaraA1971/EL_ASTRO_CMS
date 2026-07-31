/**
 * Registre rempli par app.js (composition root) avant bootstrap().
 * Les vues/plugins appellent `ctx.render()`, `ctx.bindNav()`, etc. sans
 * importer app.js directement — évite les cycles d’imports.
 *
 * @type {{ render?: () => void, bindNav?: () => void, navTabs?: (active: string) => string, openDesiredView?: () => Promise<void> }}
 */
export const ctx = {};
