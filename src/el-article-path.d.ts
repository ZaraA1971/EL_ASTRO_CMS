declare module '@el/article-path' {
  export function articlePath(
    articleOrId:
      | number
      | string
      | { article_id?: number; slug?: string; data?: { article_id?: number; slug?: string } }
      | null
      | undefined,
    slug?: string
  ): string;
  export function articleIdSlug(
    articleOrId:
      | number
      | string
      | { article_id?: number; slug?: string; data?: { article_id?: number; slug?: string } }
      | null
      | undefined,
    slug?: string
  ): string;
  export function absoluteArticleUrl(
    siteUrl: string | null | undefined,
    articleOrId:
      | number
      | string
      | { article_id?: number; slug?: string; data?: { article_id?: number; slug?: string } }
      | null
      | undefined,
    slug?: string
  ): string;
}
