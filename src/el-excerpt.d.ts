declare module '@el/excerpt' {
  export const HERO_EXCERPT_WORDS: number;
  export const CARD_EXCERPT_WORDS: number;
  export const RELATED_EXCERPT_WORDS: number;
  export const IOS_BODY_FALLBACK_WORDS: number;

  export type ExcerptContext = 'hero' | 'card' | 'related' | 'ios' | 'store';

  export const EXCERPT_CONTEXTS: Record<
    ExcerptContext,
    { words?: number; allowBody?: boolean; mode?: string }
  >;

  export function stripLeadingChapoHtml(html: string): string;
  export function stripHtmlToText(
    html: string,
    opts?: { blocks?: boolean }
  ): string;
  export function plainTextFromHtml(html: string): string;
  export function deriveExcerptFromBody(
    bodyHtml: string,
    opts?: { ratio?: number; minChars?: number; maxChars?: number }
  ): string;
  export function trimExcerpt(text: string, words?: number): string;
  export function cardExcerpt(
    article: {
      excerpt?: string;
      body?: string;
      data?: { excerpt?: string; body?: string };
    } | null,
    words: number,
    opts?: { allowBody?: boolean }
  ): string;
  export function excerptPlainForClient(
    row: { excerpt?: string; body?: string },
    opts?: { allowBodyFallback?: boolean; maxWords?: number }
  ): string;

  /** API principale : chapô selon le contexte (hero 130, card 28, …). */
  export function chapo(
    articleOrBody:
      | string
      | {
          excerpt?: string;
          body?: string;
          data?: { excerpt?: string; body?: string };
        }
      | null,
    context: ExcerptContext,
    opts?: {
      entitled?: boolean;
      allowBodyFallback?: boolean;
      ratio?: number;
      minChars?: number;
      maxChars?: number;
    }
  ): string;
}
