import type { Article, LangCode } from './articles';
import {
  displayKeyword,
  countArticlesByCategory,
  countPublishedArticles,
  getArticlesByCategory,
  getArticlesByTag,
  getHeroArticle,
  getPublishedArticles,
  hydrateArticleBody,
  hydrateFeaturedBody,
} from './articles';
import { getCategory } from './categories';
import { chrome, pagePath } from '@el/i18n-seo';

export const ARCHIVE_PAGE_SIZE = 30;

function paginateSlice<T>(items: T[], page: number, total: number) {
  const totalPages = Math.max(1, Math.ceil(total / ARCHIVE_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  return {
    articles: items,
    featured: items[0] as T | undefined,
    rest: items.slice(1),
    page: safePage,
    totalPages,
    total,
  };
}

export async function getArchivePage(lang: LangCode, page: number) {
  const total = await countPublishedArticles(lang);
  const totalPages = Math.max(1, Math.ceil(total / ARCHIVE_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * ARCHIVE_PAGE_SIZE;
  const slice = await getPublishedArticles(lang, {
    includeBody: false,
    limit: ARCHIVE_PAGE_SIZE,
    offset: start,
  });
  if (safePage === 1) {
    const featured = await hydrateArticleBody(await getHeroArticle(lang));
    const heroId = featured?.data.article_id;
    const rest = heroId
      ? slice.filter((a) => a.data.article_id !== heroId)
      : slice;
    return {
      articles: slice,
      featured,
      rest,
      page: safePage,
      totalPages,
      total,
      lang,
    };
  }
  return { ...paginateSlice(await hydrateFeaturedBody(slice), safePage, total), lang };
}

export async function getCategoryArchivePage(
  categorySlug: string,
  lang: LangCode,
  page: number
) {
  const total = await countArticlesByCategory(categorySlug, lang);
  const totalPages = Math.max(1, Math.ceil(total / ARCHIVE_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * ARCHIVE_PAGE_SIZE;
  const slice = await hydrateFeaturedBody(
    await getArticlesByCategory(categorySlug, lang, {
      includeBody: false,
      limit: ARCHIVE_PAGE_SIZE,
      offset: start,
    })
  );
  return {
    ...paginateSlice(slice, safePage, total),
    lang,
    categorySlug,
  };
}

export type HomeArchiveReady = {
  lang: LangCode;
  featured?: Article;
  rest: Article[];
  page: number;
  totalPages: number;
  cache: string;
  title?: string;
};

export async function prepareHomeArchive(
  lang: LangCode,
  rawPage = 1,
  opts: { paginated?: boolean } = {}
): Promise<HomeArchiveReady | { redirect: string }> {
  const requested = Number(rawPage);
  if (
    !Number.isFinite(requested) ||
    requested < 1 ||
    (opts.paginated && requested < 2)
  ) {
    return { redirect: archivePath(lang, 1) };
  }
  const pack = await getArchivePage(lang, requested);
  if (requested > 1 && pack.page !== requested) {
    return { redirect: archivePath(lang, pack.page) };
  }
  return {
    lang,
    featured: pack.featured,
    rest: pack.rest,
    page: pack.page,
    totalPages: pack.totalPages,
    cache:
      pack.page <= 1
        ? 'public, max-age=10, must-revalidate'
        : 'public, max-age=30, stale-while-revalidate=60',
    title:
      pack.page > 1
        ? `${chrome('featured', lang)} — page ${pack.page} | ElectronLibre`
        : undefined,
  };
}

export type CategoryArchiveReady = {
  lang: LangCode;
  slug: string;
  name: string;
  featured?: Article;
  rest: Article[];
  page: number;
  totalPages: number;
  title: string;
};

export async function prepareCategoryArchive(
  slug: string | undefined,
  lang: LangCode,
  rawPage = 1,
  opts: { paginated?: boolean } = {}
): Promise<CategoryArchiveReady | { redirect: string }> {
  const category = slug ? await getCategory(slug) : null;
  if (!category) return { redirect: '/404/' };
  const requested = Number(rawPage);
  if (
    !Number.isFinite(requested) ||
    requested < 1 ||
    (opts.paginated && requested < 2)
  ) {
    return { redirect: categoryArchivePath(category.slug, 1, lang) };
  }
  const pack = await getCategoryArchivePage(category.slug, lang, requested);
  if (requested > 1 && pack.page !== requested) {
    return { redirect: categoryArchivePath(category.slug, pack.page, lang) };
  }
  return {
    lang,
    slug: category.slug,
    name: category.name,
    featured: pack.featured,
    rest: pack.rest,
    page: pack.page,
    totalPages: pack.totalPages,
    title:
      pack.page > 1
        ? `${category.name} — page ${pack.page} | ElectronLibre`
        : `${category.name} | ElectronLibre`,
  };
}

export type TagArchiveReady = {
  lang: LangCode;
  tagSlug: string;
  name: string;
  featured?: Article;
  rest: Article[];
};

export async function prepareTagArchive(
  rawSlug: string | undefined,
  lang: LangCode
): Promise<TagArchiveReady | { redirect: string }> {
  const tagSlug = decodeURIComponent(rawSlug || '');
  if (!tagSlug) return { redirect: '/404/' };
  const articles = await hydrateFeaturedBody(
    await getArticlesByTag(tagSlug, lang)
  );
  return {
    lang,
    tagSlug,
    name: displayKeyword(tagSlug),
    featured: articles[0],
    rest: articles.slice(1),
  };
}

export function archivePath(lang: LangCode, page: number): string {
  return pagePath('home', lang, { page });
}

/** URLs archive catégorie : /[en/]articles/category/{slug}/[+page/N/] */
export function categoryArchivePath(
  slug: string,
  page: number,
  lang: LangCode = 'fr'
): string {
  return pagePath('category', lang, { slug, page });
}

/** Chemin de base pour Pagination (sans slash final). */
export function categoryArchiveBase(
  slug: string,
  lang: LangCode = 'fr'
): string {
  return pagePath('category', lang, { slug }).replace(/\/$/, '');
}

export function buildPageNumbers(
  current: number,
  total: number
): Array<number | '…'> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages = new Set<number>([1, total, current, current - 1, current + 1]);
  if (current <= 3) {
    pages.add(2);
    pages.add(3);
    pages.add(4);
  }
  if (current >= total - 2) {
    pages.add(total - 1);
    pages.add(total - 2);
    pages.add(total - 3);
  }
  const sorted = [...pages]
    .filter((p) => p >= 1 && p <= total)
    .sort((a, b) => a - b);
  const out: Array<number | '…'> = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push('…');
    out.push(p);
    prev = p;
  }
  return out;
}
