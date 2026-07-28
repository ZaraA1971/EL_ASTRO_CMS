declare module '@el/categories' {
  export const DEFAULT_CATEGORIES: ReadonlyArray<{
    slug: string;
    name: string;
    sort_order: number;
    show_in_nav: boolean;
  }>;
  export function slugifyCategoryName(name: string): string;
  export function categoryNameFromList(
    list: Array<{ slug: string; name?: string }> | null | undefined,
    slug: string
  ): string;
}
