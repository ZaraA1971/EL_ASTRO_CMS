declare module '@el/editorial-update' {
  export const EDITORIAL_UPDATE_GRACE_MS: number;
  export function isEditorialUpdate(
    published: Date | string | number | null | undefined,
    modifiedOrNow?: Date | string | number | null | undefined
  ): boolean;
  export function isPastEditorialUpdateGrace(
    published: Date | string | number | null | undefined,
    now?: Date | string | number
  ): boolean;
  export function shouldBumpEditorialModified(flags?: {
    accessChanged?: boolean;
    iaKeywordsChanged?: boolean;
    otherFieldsChanged?: boolean;
  }): boolean;
}
