declare module '@el/sitemap-news' {
  export const NEWS_SITEMAP_DAYS: number;
  export const NEWS_SITEMAP_FALLBACK: number;
  export function xmlEscape(value: string): string;
  export function isoDate(d: Date | string | null | undefined): string;
  export function newsLang(lang: string | null | undefined): 'en' | 'fr';
  export function buildSitemapIndex(locs: string[]): string;
  export function buildUrlset(
    urls: Array<{
      loc: string;
      lastmod?: string;
      changefreq?: string;
      priority?: string;
      links?: Array<{ hreflang: string; href: string }>;
    }>
  ): string;
  export function newsSitemapXml(
    rows: Array<{
      article_id?: number;
      slug?: string;
      title?: string;
      date?: Date | string;
      lang?: string;
    }>,
    opts: { locOf: (row: object) => string; name?: string }
  ): string;
}
