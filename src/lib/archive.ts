import type { Article, LangCode } from './articles';
import {
  countArticlesByCategory,
  countPublishedArticles,
  getArticlesByCategory,
  getPublishedArticles,
} from './articles';

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
  return { ...paginateSlice(slice, safePage, total), lang };
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
  const slice = await getArticlesByCategory(categorySlug, lang, {
    includeBody: false,
    limit: ARCHIVE_PAGE_SIZE,
    offset: start,
  });
  return {
    ...paginateSlice(slice, safePage, total),
    lang,
    categorySlug,
  };
}

export function archivePath(lang: LangCode, page: number): string {
  if (lang === 'en') {
    return page <= 1 ? '/en/' : `/en/page/${page}/`;
  }
  return page <= 1 ? '/' : `/page/${page}/`;
}

/** URLs archive catégorie : /articles/category/{slug}/[+page/N/] */
export function categoryArchivePath(slug: string, page: number): string {
  const base = `/articles/category/${slug}`;
  return page <= 1 ? `${base}/` : `${base}/page/${page}/`;
}

/** Chemin de base pour Pagination (sans slash final). */
export function categoryArchiveBase(slug: string): string {
  return `/articles/category/${slug}`;
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
