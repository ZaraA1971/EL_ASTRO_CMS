/**
 * Composition newsletter quotidienne FR — port de Newsletter_daily.php
 * Source : el_articles (MySQL), zéro WP.
 */

import { parseJsonArray } from '../db.mjs';
import { chapo, stripHtmlToText, trimExcerpt } from '../excerpt.mjs';
import {
  escapeHtml,
  renderAppInstallPill,
  EL_EMAIL_TOKENS,
} from '../email/brand.mjs';
import { absoluteArticleUrl } from '../article-path.mjs';
import { humanizeTag } from '../humanize.mjs';

const TZ = 'Europe/Paris';
/** « Si vous l’aviez manqué » — court (hors contexte hero). */
const MISSED_EXCERPT_WORDS = 18;

const STOP_WORDS = [
  'ia',
  'ai',
  'tech',
  'web',
  'web 1,2,3',
  'culture',
  'politique',
  'economie',
  'économie',
  'robotic',
  'high-tech',
  'android',
  'newsletter',
  'googlebook',
  'so amazing',
  'so cult',
  'le flouze',
  'médias',
  'medias',
  'numérique',
  'numerique',
  'innovation',
  'régulation',
  'regulation',
  'plateformes',
  'streaming',
  'musique',
  'cinéma',
  'cinema',
];

/** Jetons e-mail + overrides newsletter (fond hero / corps). */
const TOKENS = {
  ...EL_EMAIL_TOKENS,
  dark: '#333333',
  text: '#111827',
  body: '#475569',
  borderLight: '#f1f5f9',
};

export function normalizeKeyword(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP_NORM = new Set(
  STOP_WORDS.map(normalizeKeyword).filter(Boolean)
);

/** @param {string} ymd YYYY-MM-DD */
export function dayBoundsParis(ymd) {
  // Intervalles locaux Paris stockés comme DATETIME naïfs (aligné WP)
  return {
    start: `${ymd} 00:00:00`,
    end: `${ymd} 23:59:59`,
    display: ymd.split('-').reverse().join('/'),
  };
}

export function previousBusinessDay(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Monday = 1 in getUTCDay? Sunday=0 … Monday=1
  const dow = dt.getUTCDay(); // 0=Sun … 1=Mon
  const back = dow === 1 ? 3 : 1;
  dt.setUTCDate(dt.getUTCDate() - back);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function todayYmdParis(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(now); // YYYY-MM-DD
}

/** Alias — même implémentation que shared/excerpt trimExcerpt. */
export function trimWords(text, limit) {
  return trimExcerpt(text, limit);
}

export function articleExcerptFromBody(body, wordLimit = 120) {
  return trimExcerpt(stripHtmlToText(body), wordLimit);
}

/** Extrait court (section « manqué ») — chapô stocké, sinon trim du corps. */
export function articleExcerptForNewsletter(article, wordLimit = MISSED_EXCERPT_WORDS) {
  const stored = stripHtmlToText(article?.excerpt || '');
  if (stored) {
    return wordLimit ? trimExcerpt(stored, wordLimit) : stored;
  }
  return articleExcerptFromBody(article?.body, wordLimit);
}

/** Édito (= Aujourd’hui) : articles abonnés. Brèves (= En bref) : accès gratuit. */
export function isEditorialArticle(article) {
  return String(article?.access || 'subscribers') !== 'granted';
}

export function tagLabel(article) {
  const tags = article.tags || [];
  if (tags[0]) return humanizeTag(tags[0]);
  const names = article.category_names || [];
  if (names[0]) return names[0];
  return 'News';
}

export function sortNewsletterArticles(articles) {
  return [...articles].sort((a, b) => {
    const edA = isEditorialArticle(a);
    const edB = isEditorialArticle(b);
    if (edA !== edB) return edA ? -1 : 1;
    return new Date(a.date) - new Date(b.date);
  });
}

export function buildDynamicSubtitle(articles) {
  const names = [];
  const seen = new Set();
  for (const a of articles) {
    for (const tag of a.tags || []) {
      const norm = normalizeKeyword(tag);
      if (!norm || STOP_NORM.has(norm) || seen.has(norm)) continue;
      seen.add(norm);
      names.push(humanizeTag(tag));
    }
  }
  if (!names.length) {
    return 'Au sommaire aujourd’hui : les principaux enjeux du numérique, des médias, des industries de la culture et de l’intelligence artificielle.';
  }
  if (names.length === 1) {
    return `Au sommaire aujourd’hui : ${names[0]} — l’essentiel des signaux du jour.`;
  }
  const last = names.pop();
  return `Au sommaire aujourd’hui : ${names.join(', ')} et ${last} — l’essentiel des signaux du jour.`;
}

function rowToNlArticle(row) {
  return {
    article_id: Number(row.article_id),
    slug: String(row.slug),
    title: String(row.title),
    excerpt: String(row.excerpt || ''),
    body: String(row.body || ''),
    date: row.date instanceof Date ? row.date : new Date(row.date),
    tags: parseJsonArray(row.tags),
    categories: parseJsonArray(row.categories),
    category_names: parseJsonArray(row.category_names),
    access: row.access === 'granted' ? 'granted' : 'subscribers',
  };
}

async function fetchArticlesForDay(pool, ymd, { paywalledOnly = false } = {}) {
  const { start, end } = dayBoundsParis(ymd);
  let sql = `SELECT article_id, slug, title, excerpt, body, date, tags, categories, category_names, access
    FROM el_articles
    WHERE draft = 0 AND lang = 'fr'
      AND date >= ? AND date <= ?`;
  const params = [start, end];
  if (paywalledOnly) {
    sql += ` AND access = 'subscribers'`;
  }
  sql += ` ORDER BY date ASC`;
  const [rows] = await pool.query(sql, params);
  return (rows || []).map(rowToNlArticle);
}

function formatDateFr(date) {
  const d = date instanceof Date ? date : new Date(date);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Cartouches outils — couleurs alignées HomeTools (Une).
 * Compagnon bleu #2f6dfb · Desinfo crème/#0f6b4c · GEO noir/#059669
 */
function renderHomeToolCartouches(siteUrl, t) {
  const base = String(siteUrl || 'https://electronlibre.info').replace(/\/+$/, '');
  const aiLink = `${base}/newsletter-open-ia`;
  const shell = `width:100%;max-width:100%;margin:18px 0;border-radius:14px;overflow:hidden;`;
  const pad = `padding:22px 24px;font-family:${t.fontUi};`;
  const cta = (bg) =>
    `display:inline-block;padding:10px 14px;background-color:${bg};color:#ffffff !important;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none;font-family:${t.fontUi};`;

  let html = '';

  // EL Compagnon (glass sombre + accent bleu Une)
  html += `<div style="${shell}background-color:#1c1c1d;border:1px solid #2a2a2d;color:#eaeaea;">`;
  html += `<div style="${pad}">`;
  html += `<p style="margin:0 0 10px;color:#2f6dfb;font-size:12px;line-height:1;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;font-family:${t.fontUi};">IA · EL Compagnon</p>`;
  html += `<h2 style="margin:0 0 8px;color:#ffffff;font-size:20px;line-height:1.25;font-weight:700;font-family:${t.fontEditorial};">Interrogez notre <span style="color:#2f6dfb;">IA éditoriale</span></h2>`;
  html += `<p style="margin:0 0 16px;color:#b8b8bc;font-size:14px;line-height:1.55;font-family:${t.fontUi};">Interrogez les archives ElectronLibre. Réponses sourcées, directement depuis le site ou l’app.</p>`;
  html += `<a href="${escapeHtml(aiLink)}" target="_blank" style="${cta('#2f6dfb')}">Ouvrir EL Compagnon →</a>`;
  html += `</div></div>`;

  // Observatoire de la désinformation (crème / vert forêt)
  html += `<div style="${shell}background-color:#f5f2e9;border:1px solid #e4dfd2;color:#1f2933;">`;
  html += `<div style="${pad}">`;
  html += `<h2 style="margin:0 0 8px;color:#0f6b4c;font-size:20px;line-height:1.2;font-weight:400;font-family:${t.fontEditorial};">Observatoire de la désinformation</h2>`;
  html += `<p style="margin:0 0 16px;color:#4b5563;font-size:14px;line-height:1.55;font-family:${t.fontUi};">Palmarès roulant fondé sur les Community Notes utiles sur X.</p>`;
  html += `<a href="https://desinfo.electronlibre.info/" target="_blank" style="${cta('#0f6b4c')}">Voir le palmarès →</a>`;
  html += `</div></div>`;

  // GEO (noir / émeraude)
  html += `<div style="${shell}background-color:#050505;border:1px solid #27272a;color:#d4d4d8;">`;
  html += `<div style="${pad}">`;
  html += `<p style="margin:0 0 8px;color:#059669;font-size:11px;line-height:1.4;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;">Veille IA</p>`;
  html += `<h2 style="margin:0 0 8px;color:#fafafa;font-size:22px;line-height:1.15;letter-spacing:-0.02em;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;">GEO</h2>`;
  html += `<p style="margin:0 0 16px;color:#a1a1aa;font-size:14px;line-height:1.55;font-family:${t.fontUi};">Comment les IA citent et classent marques, médias, marchés.</p>`;
  html += `<a href="https://geo.electronlibre.info/" target="_blank" style="${cta('#059669')}">Ouvrir GEO →</a>`;
  html += `</div></div>`;

  return html;
}

function renderArticleCards(articles, siteUrl, t) {
  if (!articles.length) {
    return `<div style="width:100%;max-width:100%;margin:24px 0;border-radius:18px;overflow:hidden;"><div style="padding:28px;background-color:#ffffff;border-radius:18px;color:${t.body};text-align:center;font-family:${t.fontUi};">Aucun article publié aujourd’hui.</div></div>`;
  }

  const sectionStyle = `width:100%;max-width:100%;margin:26px 0 14px;color:${t.accent};font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-family:${t.fontUi};font-weight:600;`;
  const cardShell = `width:100%;max-width:100%;margin-left:0;margin-right:0;border-radius:18px;overflow:hidden;`;
  const articleInner = `padding:24px 26px;background-color:#ffffff;border:1px solid ${t.border};border-radius:18px;font-family:${t.fontUi};`;

  let html = `<div style="width:100%;max-width:100%;font-family:${t.fontUi};">`;
  html += `<h2 style="${sectionStyle}">Aujourd’hui dans ElectronLibre</h2>`;

  let briefShown = false;
  let index = 0;
  for (const a of articles) {
    index += 1;
    const editorial = isEditorialArticle(a);
    if (!editorial && !briefShown) {
      html += `<h2 style="${sectionStyle}">En bref</h2>`;
      briefShown = true;
    }
    const label = tagLabel(a);
    const href = absoluteArticleUrl(siteUrl, a);
    const titleStyle = editorial
      ? `margin:0 0 12px;font-size:23px;line-height:1.22;letter-spacing:-0.02em;font-weight:700;color:${t.text};font-family:${t.fontEditorial};`
      : `margin:0 0 10px;font-size:19px;line-height:1.32;letter-spacing:-0.01em;font-weight:700;color:${t.meta};font-family:${t.fontEditorial};`;
    const linkColor = editorial ? t.text : t.meta;

    html += `<div style="${cardShell}margin-bottom:18px;"><div style="${articleInner}">`;
    html += `<p style="margin:0 0 10px;color:${t.meta};font-size:11px;line-height:1.4;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;font-family:${t.fontUi};">${escapeHtml(label)} · ${escapeHtml(formatDateFr(a.date))}</p>`;
    html += `<h2 style="${titleStyle}"><a href="${escapeHtml(href)}" rel="bookmark" style="color:${linkColor};text-decoration:none;">${escapeHtml(a.title)}</a></h2>`;
    html += `<div style="font-size:15px;color:${t.body};line-height:1.65;margin:0;font-family:${t.fontUi};">`;
    if (editorial) {
      // Même longueur que la Une (hero = 130 mots, prolongé avec le corps)
      const excerpt = chapo(a, 'hero');
      if (excerpt) {
        html += `<p style="margin:0 0 14px;color:${t.body};font-size:15px;line-height:1.65;font-family:${t.fontUi};">${escapeHtml(excerpt)}</p>`;
      }
      html += `<a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;margin-top:10px;color:${t.accent} !important;font-size:14px;font-weight:700;text-decoration:none;font-family:${t.fontUi};">Continuer de lire…</a>`;
    } else {
      // Brève : corps HTML allégé (déjà stocké propre)
      const brief = String(a.body || '').trim();
      html += `<div style="font-size:14px;line-height:1.6;color:${t.meta};font-family:${t.fontUi};">${brief}</div>`;
    }
    html += `</div></div></div>`;

    if (index === 1) {
      html += renderHomeToolCartouches(siteUrl, t);
    }
  }
  html += `</div>`;
  return html;
}

function renderMissed(missed, siteUrl, t) {
  if (!missed.length) return '';
  const sectionStyle = `width:100%;max-width:100%;margin:26px 0 14px;color:${t.accent};font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-family:${t.fontUi};font-weight:600;`;
  let html = `<div style="width:100%;max-width:100%;font-family:${t.fontUi};">`;
  html += `<h2 style="${sectionStyle}">Si vous l’aviez manqué</h2>`;
  html += `<section style="width:100%;max-width:100%;margin:0;border-radius:18px;overflow:hidden;">`;
  html += `<div style="padding:22px 26px;background-color:#ffffff;border:1px solid ${t.border};border-radius:18px;font-family:${t.fontUi};">`;
  html += `<ul style="margin:0;padding:0;list-style:none;">`;
  missed.forEach((a, i) => {
    const href = absoluteArticleUrl(siteUrl, a);
    const excerpt = articleExcerptForNewsletter(a, MISSED_EXCERPT_WORDS);
    const border = i === 0 ? 'none' : `1px solid ${t.borderLight}`;
    const padTop = i === 0 ? '0' : '11px';
    html += `<li style="margin:0;padding:${padTop} 0 11px;border-top:${border};font-size:14px;line-height:1.45;font-family:${t.fontUi};">`;
    html += `<a href="${escapeHtml(href)}" target="_blank" style="color:${t.text};font-weight:700;text-decoration:none;font-family:${t.fontEditorial};">${escapeHtml(a.title)}</a>`;
    if (excerpt) {
      html += `<span style="display:block;margin-top:5px;color:${t.body};font-size:13px;line-height:1.45;font-weight:400;font-family:${t.fontUi};">${escapeHtml(excerpt)}</span>`;
    }
    html += `</li>`;
  });
  html += `</ul></div></section></div>`;
  return html;
}

/**
 * Injecte le lien désabo dans le footer (par destinataire).
 */
export function injectUnsubscribe(html, unsubUrl) {
  const link = escapeHtml(unsubUrl);
  return String(html).replace(/__UNSUBSCRIBE_URL__/g, link);
}

/**
 * Compose HTML + métadonnées pour une date éditoriale.
 */
export async function composeDailyNewsletter(pool, opts = {}) {
  const ymd = opts.date || todayYmdParis();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    throw new Error('date_invalide');
  }
  const siteUrl = String(opts.siteUrl || 'https://electronlibre.info').replace(
    /\/+$/,
    ''
  );
  const t = TOKENS;
  const { display } = dayBoundsParis(ymd);

  const dayArticles = sortNewsletterArticles(await fetchArticlesForDay(pool, ymd));
  const prev = previousBusinessDay(ymd);
  let missed = await fetchArticlesForDay(pool, prev, { paywalledOnly: true });
  missed = missed
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);

  const subtitle = buildDynamicSubtitle(dayArticles);
  const subject = `ElectronLibre — Newsletter du ${display}`;

  const container = `width:100%;max-width:600px;margin-left:auto;margin-right:auto;`;
  const block = `width:100%;max-width:100%;margin-left:0;margin-right:0;`;

  let html = `<div class="newsletter-shell" id="newsletter-content" style="width:100%;box-sizing:border-box;background-color:${t.surfaceAlt};padding:0 14px 36px;font-family:${t.fontUi};">`;
  html += `<div class="newsletter-container" style="${container}">`;

  // Hero
  html += `<div style="${block}background-color:${t.dark};border-radius:22px;overflow:hidden;color:#ffffff;box-shadow:0 18px 48px rgba(15,23,42,0.18);">`;
  html += `<div style="padding:10px 32px 28px;">`;
  html += `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 20px 0;"><tr><td align="center" style="text-align:center;padding:0;margin:0;">`;
  html += `<a href="${escapeHtml(siteUrl)}" target="_blank" style="display:inline-block;margin:0 auto;padding:0;text-align:center;font-family:${t.fontEditorial};font-size:34px;line-height:1;letter-spacing:-0.01em;font-weight:700;color:#ffffff;text-decoration:none;">Electron<span style="color:${t.brandLibre};font-weight:500;">Libre</span></a>`;
  html += `</td></tr></table>`;
  html += `<div style="display:inline-block;margin:0 0 14px;padding:6px 10px;border:1px solid rgba(255,255,255,0.22);border-radius:999px;color:${t.accent};font-size:11px;letter-spacing:0.12em;text-transform:uppercase;font-family:${t.fontUi};">Newsletter quotidienne</div>`;
  html += `<h1 style="margin:0;color:#ffffff;font-size:31px;line-height:1.18;letter-spacing:-0.02em;font-weight:700;font-family:${t.fontEditorial};">Une lecture exigeante<br/>des enjeux du <span style="color:${t.accent};">numérique</span></h1>`;
  html += `<p style="margin:14px 0 0;color:${t.onDarkMuted};font-size:15px;line-height:1.55;font-family:${t.fontUi};">${escapeHtml(subtitle)}</p>`;
  html += `</div>`;
  html += `<div style="padding:16px 16px 20px;text-align:center;background:rgba(255,255,255,0.08);border-top:1px solid rgba(255,255,255,0.12);overflow:hidden;">`;
  html += `<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="100%" style="width:100%;max-width:100%;margin:0 auto;border-collapse:collapse;table-layout:fixed;text-align:center;"><tr>`;
  html += `<td align="center" style="padding:4px;">${renderAppInstallPill(t)}</td>`;
  html += `<td align="center" style="padding:4px;"><a href="${escapeHtml(siteUrl)}" target="_blank" style="display:inline-block;color:${t.onDarkMuted} !important;font-size:12px;text-decoration:none;font-family:${t.fontUi};">Site</a></td>`;
  html += `<td align="center" style="padding:4px;"><a href="mailto:info@electronlibre.info" style="display:inline-block;color:${t.onDarkMuted} !important;font-size:12px;text-decoration:none;font-family:${t.fontUi};">Contact</a></td>`;
  html += `<td align="center" style="padding:4px;"><a href="https://x.com/@3l3ctr0nLibr3" target="_blank" style="display:inline-block;color:${t.onDarkMuted} !important;font-size:12px;text-decoration:none;font-family:${t.fontUi};">X / Twitter</a></td>`;
  html += `</tr></table></div></div>`;

  html += renderArticleCards(dayArticles, siteUrl, t);
  html += renderMissed(missed, siteUrl, t);

  const year = new Date().getFullYear();
  html += `<div style="${block}margin-top:22px;padding:22px 20px;text-align:center;font-size:12px;line-height:1.6;color:${t.meta};font-family:${t.fontUi};">`;
  html += `Vous recevez cette newsletter car vous êtes abonné à <a href="${escapeHtml(siteUrl)}" style="color:${t.meta};text-decoration:underline;">ElectronLibre</a>.<br/>`;
  html += `Vous pouvez <a href="__UNSUBSCRIBE_URL__" target="_blank" style="color:${t.meta};text-decoration:underline;">vous désabonner de la newsletter</a> sans modifier votre abonnement.<br/>`;
  html += `© ${year} ElectronLibre. Tous droits réservés.`;
  html += `</div></div></div>`;

  return {
    date: ymd,
    displayDate: display,
    subject,
    html,
    subtitle,
    articleIds: dayArticles.map((a) => a.article_id),
    missedIds: missed.map((a) => a.article_id),
    counts: {
      today: dayArticles.length,
      editorial: dayArticles.filter(isEditorialArticle).length,
      briefs: dayArticles.filter((a) => !isEditorialArticle(a)).length,
      missed: missed.length,
    },
  };
}
