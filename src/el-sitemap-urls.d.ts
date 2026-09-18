declare module '@el/sitemap-urls' {
  export const SITEMAP_PAGE_SIZE: number;
  export const POSTS_SITEMAP_SQL: string;
  export function staticSitemapUrls(site?: string): Array<{
    loc: string;
    changefreq?: string;
    priority?: string;
    links?: Array<{ hreflang: string; href: string }>;
  }>;
  export function articleSitemapUrl(
    row: {
      article_id?: number;
      slug?: string;
      date?: Date | string;
      modified?: Date | string | null;
      lang?: string;
      translation_fr?: number | null;
      translation_en?: number | null;
      translation_fr_slug?: string | null;
      translation_en_slug?: string | null;
      translation_fr_draft?: number | null;
      translation_en_draft?: number | null;
    },
    site?: string
  ): {
    loc: string;
    lastmod: string;
    links: Array<{ hreflang: string; href: string }>;
  } | null;
}
