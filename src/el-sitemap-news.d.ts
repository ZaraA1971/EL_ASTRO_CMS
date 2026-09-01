declare module '@el/sitemap-news' {
  export const NEWS_SITEMAP_DAYS: number;
  export const NEWS_SITEMAP_FALLBACK: number;
  export function xmlEscape(value: string): string;
  export function isoDate(d: Date | string | null | undefined): string;
  export function newsLang(lang: string | null | undefined): 'en' | 'fr';
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
