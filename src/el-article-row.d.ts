declare module '@el/article-row' {
  export function parseJsonArray(v: unknown): string[];
  export function parseRowDate(v: unknown): Date | null;
  export function rowToArticle(
    row: Record<string, unknown> | null | undefined,
    opts?: { includeBody?: boolean }
  ): {
    id: string;
    data: {
      article_id: number;
      title: string;
      slug: string;
      date: Date | null;
      modified?: Date;
      author: string;
      author_slug?: string;
      author_user_id: number | null;
      categories: string[];
      category_names: string[];
      tags: string[];
      ia_keywords: string[];
      translation_fr?: number;
      translation_en?: number;
      access: 'granted' | 'subscribers';
      lang: string;
      source_url?: string;
      excerpt: string;
      draft: boolean;
    };
    body: string;
  } | null;
}
