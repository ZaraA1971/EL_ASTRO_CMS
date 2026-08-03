declare module '@el/categories' {
  export const DEFAULT_CATEGORIES: ReadonlyArray<{
    slug: string;
    name: string;
    sort_order: number;
    show_in_nav: boolean;
  }>;
  export const CATEGORIES_TABLE_COLUMNS_SQL: string;
  export function slugifyCategoryName(name: string): string;
  export function categoriesCreateTableSql(tableName: string): string;
  export function categoryNameFromList(
    list: Array<{ slug: string; name?: string }> | null | undefined,
    slug: string
  ): string;
  export function rowToCategory(row: Record<string, unknown>): {
    slug: string;
    name: string;
    sort_order: number;
    show_in_nav: boolean;
  };
  export function ensureCategoriesSchema(
    pool: { query: (...args: unknown[]) => Promise<unknown> },
    tableName: string,
    defaults?: ReadonlyArray<{
      slug: string;
      name: string;
      sort_order?: number;
      show_in_nav?: boolean;
    }>
  ): Promise<void>;
}
