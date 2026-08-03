declare module '@el/slugify' {
  export function stripDiacritics(s: string): string;
  export function slugify(
    input: string,
    opts?: { sep?: string; max?: number; fallback?: string }
  ): string;
  export function slugifyArticle(title: string): string;
  export function slugifyCategoryName(name: string): string;
}