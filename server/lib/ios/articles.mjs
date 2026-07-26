/**
 * Articles iOS — lecture el_articles (draft=0), DTO compatible WP plugin.
 */
import { chapo } from '../excerpt.mjs';

function normalizeLang(lang) {
  const l = String(lang || 'FR').toUpperCase();
  return l === 'EN' ? 'EN' : 'FR';
}

function isPublicAccess(row) {
  return String(row?.access || '').toLowerCase() === 'granted';
}

function escapeHtmlText(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
      .map((p) => `<p>${escapeHtmlText(p).replace(/\n/g, '<br />')}</p>`)
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
  return h;
}

function rowDateIso(row) {
  const raw = row?.date;
  if (!raw) return '';
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toISOString();
}

export function toIosArticleDto(row, { entitled = false, lang = 'FR' } = {}) {
  const pub = isPublicAccess(row);
  const canSeeBody = pub || entitled;
  const content = canSeeBody ? sanitizeHtmlForIos(row?.body || '') : '';
  return {
    id: Number(row.wp_id),
    title: String(row.title || ''),
    date: rowDateIso(row),
    excerpt: chapo(row, 'ios', { entitled: canSeeBody }),
    content,
    isPublic: pub,
    lang: normalizeLang(lang),
  };
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

export async function getPublishedRow(pool, wpId) {
  const id = Number(wpId) || 0;
  if (!id) return null;
  const [rows] = await pool.query(
    'SELECT * FROM el_articles WHERE wp_id = ? AND draft = 0 LIMIT 1',
    [id]
  );
  return rows[0] || null;
}

export async function resolveArticleForLang(pool, wpId, lang) {
  const want = normalizeLang(lang);
  let row = await getPublishedRow(pool, wpId);
  if (!row) return null;

  const rowLang = String(row.lang || 'fr').toUpperCase();
  if (want === 'EN') {
    if (rowLang === 'EN') return row;
    return getPublishedRow(pool, row.translation_en);
  }
  if (rowLang === 'FR') return row;
  return getPublishedRow(pool, row.translation_fr);
}
