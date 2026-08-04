/**
 * Articles iOS — lecture el_articles (draft=0), DTO compatible WP plugin.
 */
import { chapo } from '../excerpt.mjs';
import { cleanHtml } from '../html-clean.mjs';
import { isEditorialUpdate } from '../editorial-update.mjs';
import { escapeHtml } from '../escape-html.mjs';
import { normalizeAccess, parseRowDate } from '../article-row.mjs';

function normalizeLang(lang) {
  const l = String(lang || 'FR').toUpperCase();
  return l === 'EN' ? 'EN' : 'FR';
}

/**
 * Sanitize HTML pour clients iOS (WebView).
 * Pas un DOMPurify complet : retire scripts / handlers / URLs dangereuses.
 */
export function sanitizeHtmlForIos(html) {
  let h = String(html || '');
  h = h.replace(/<!--[\s\S]*?-->/g, '').trim();
  if (!h) return '';

  if (!/<[a-z][\s\S]*>/i.test(h)) {
    return h
      .split(/\n{2,}/)
      .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br />')}</p>`)
      .join('');
  }

  // Balises actives / embedding
  h = h.replace(
    /<(script|style|iframe|object|embed|form|link|meta|base|svg|math)[\s\S]*?<\/\1>/gi,
    ''
  );
  h = h.replace(
    /<(script|style|iframe|object|embed|form|link|meta|base|svg|math)\b[^>]*\/?>/gi,
    ''
  );
  // Handlers on*
  h = h.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // javascript: / vbscript: / data: dans URL attrs
  h = h.replace(
    /\s(href|src|xlink:href|action|formaction)\s*=\s*(["'])\s*(?:javascript|vbscript|data)\s*:/gi,
    ' $1=$2#'
  );
  // srcdoc
  h = h.replace(/\s+srcdoc\s*=\s*("[^"]*"|'[^']*')/gi, '');
  // Styles collés (color noir, font Arial…) — dark mode WebView
  return cleanHtml(h, 'ios');
}

function toIsoUtc(d) {
  return d.toISOString();
}

function rowDateIso(row) {
  const d = parseRowDate(row?.date);
  if (!d) return row?.date ? String(row.date) : '';
  return toIsoUtc(d);
}

/**
 * Date de MAJ éditoriale (colonne `modified`), alignée sur « Mis à jour le… » du site.
 * Omis si absent ou dans le délai de grâce après publication.
 */
function rowUpdatedIso(row) {
  const published = parseRowDate(row?.date);
  const modified = parseRowDate(row?.modified);
  if (!published || !modified) return null;
  if (!isEditorialUpdate(published, modified)) return null;
  return toIsoUtc(modified);
}

export function toIosArticleDto(row, { entitled = false, lang = 'FR' } = {}) {
  const access = normalizeAccess(row?.access);
  const pub = access === 'granted';
  const canSeeBody = pub || entitled;
  const content = canSeeBody ? sanitizeHtmlForIos(row?.body || '') : '';
  const dto = {
    id: Number(row.article_id),
    title: String(row.title || ''),
    date: rowDateIso(row),
    excerpt: chapo(row, 'ios', { entitled: canSeeBody }),
    content,
    /** true = gratuit ; false = réservé abonnés (miroir de access === 'granted'). */
    isPublic: pub,
    /**
     * Statut canonique pour l’app : `granted` (gratuit) | `subscribers` (abonné).
     * Toujours présent — ne pas déduire uniquement de content vide.
     */
    access,
    lang: normalizeLang(lang),
  };
  const updated = rowUpdatedIso(row);
  if (updated) dto.updated = updated;
  return dto;
}

export async function queryIosArticles(pool, args = {}) {
  const lang = normalizeLang(args.lang);
  const page = Math.max(1, Number(args.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(args.per_page) || 50));
  const offset = (page - 1) * perPage;
  const search = String(args.search || '').trim();
  const dbLang = lang.toLowerCase();

  let sql =
    'SELECT * FROM el_articles WHERE draft = 0 AND LOWER(lang) = ?';
  const params = [dbLang];

  if (search) {
    // Title/excerpt only — pas d’oracle sur le body paywall
    sql += ' AND (title LIKE ? OR excerpt LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like);
  }

  sql += ' ORDER BY date DESC LIMIT ? OFFSET ?';
  params.push(perPage, offset);

  const [rows] = await pool.query(sql, params);
  return rows;
}

export async function getPublishedRow(pool, articleId) {
  const id = Number(articleId) || 0;
  if (!id) return null;
  const [rows] = await pool.query(
    'SELECT * FROM el_articles WHERE article_id = ? AND draft = 0 LIMIT 1',
    [id]
  );
  return rows[0] || null;
}

export async function resolveArticleForLang(pool, articleId, lang) {
  const want = normalizeLang(lang);
  let row = await getPublishedRow(pool, articleId);
  if (!row) return null;

  const rowLang = String(row.lang || 'fr').toUpperCase();
  if (want === 'EN') {
    if (rowLang === 'EN') return row;
    return getPublishedRow(pool, row.translation_en);
  }
  if (rowLang === 'FR') return row;
  return getPublishedRow(pool, row.translation_fr);
}
