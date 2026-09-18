/**
 * URLs sitemap (pages + paires FR/EN) — script statique et Astro.
 */
import { absoluteArticleUrl } from './article-path.mjs';
import { SITE, hreflang, pagePath, pairHreflang } from './i18n-seo.mjs';
import { isoDate } from './sitemap-news.mjs';

export const SITEMAP_PAGE_SIZE = 2000;

export const POSTS_SITEMAP_SQL = `
  SELECT a.article_id, a.slug, a.date, a.modified, a.lang,
         a.translation_fr, a.translation_en,
         tf.slug AS translation_fr_slug, tf.draft AS translation_fr_draft,
         te.slug AS translation_en_slug, te.draft AS translation_en_draft
  FROM el_articles a
  LEFT JOIN el_articles tf ON tf.article_id = a.translation_fr
  LEFT JOIN el_articles te ON te.article_id = a.translation_en
  WHERE a.draft = 0
  ORDER BY a.date DESC, a.article_id DESC
`.replace(/\s+/g, ' ').trim();

export function staticSitemapUrls(site = SITE) {
  return [
    {
      loc: `${site}/`,
      changefreq: 'hourly',
      priority: '1.0',
      links: hreflang({ lang: 'fr', path: pagePath('home', 'fr') }, 'home', {
        site,
      }),
    },
    {
      loc: `${site}/en/`,
      changefreq: 'hourly',
      priority: '0.9',
      links: hreflang({ lang: 'en', path: pagePath('home', 'en') }, 'home', {
        site,
      }),
    },
    { loc: `${site}/abonnement/`, changefreq: 'monthly', priority: '0.6' },
    { loc: `${site}/a-propos/`, changefreq: 'yearly', priority: '0.3' },
    { loc: `${site}/mentions-legales/`, changefreq: 'yearly', priority: '0.2' },
    {
      loc: `${site}/search/`,
      changefreq: 'monthly',
      priority: '0.4',
      links: hreflang({ lang: 'fr', path: pagePath('search', 'fr') }, 'search', {
        site,
      }),
    },
    {
      loc: `${site}/en/search/`,
      changefreq: 'monthly',
      priority: '0.4',
      links: hreflang({ lang: 'en', path: pagePath('search', 'en') }, 'search', {
        site,
      }),
    },
  ];
}

export function articleSitemapUrl(row, site = SITE) {
  const loc = absoluteArticleUrl(site, row?.article_id, row?.slug);
  if (!loc) return null;
  const frPath =
    row.translation_fr &&
    row.translation_fr_slug &&
    Number(row.translation_fr_draft) === 0
      ? absoluteArticleUrl(site, row.translation_fr, row.translation_fr_slug)
      : '';
  const enPath =
    row.translation_en &&
    row.translation_en_slug &&
    Number(row.translation_en_draft) === 0
      ? absoluteArticleUrl(site, row.translation_en, row.translation_en_slug)
      : '';
  return {
    loc,
    lastmod: isoDate(row.modified || row.date),
    links: pairHreflang({
      lang: row.lang,
      selfPath: loc,
      frPath,
      enPath,
    }),
  };
}
