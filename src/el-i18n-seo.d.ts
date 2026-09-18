declare module '@el/i18n-seo' {
  export const SITE: string;
  export const PATH_CONTEXTS: Record<string, { fr: string; en: string }>;
  export const CHROME_CONTEXTS: Record<string, { fr: string; en: string }>;
  export function resolveLang(lang: string | null | undefined): 'fr' | 'en';
  export function chrome(context: string, lang: string | null | undefined): string;
  export function pagePath(
    context: string,
    lang: string | null | undefined,
    opts?: { slug?: string; page?: number }
  ): string;
  export function absoluteUrl(pathOrUrl: string, site?: string): string;
  export function hreflang(
    data: {
      lang?: string;
      path?: string;
      alternates?: { fr?: string; en?: string };
    },
    context: string,
    opts?: { site?: string; slug?: string; page?: number }
  ): Array<{ hreflang: string; href: string }>;
  export function pairHreflang(
    data: {
      lang?: string;
      selfPath: string;
      frPath?: string;
      enPath?: string;
    },
    opts?: { site?: string }
  ): Array<{ hreflang: string; href: string }>;
}
