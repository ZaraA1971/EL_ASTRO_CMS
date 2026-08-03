declare module '@el/format-date-fr' {
  export const TZ_PARIS: string;
  export function formatDateFrNumeric(d: Date | string | number | null | undefined): string;
  export function formatDateFrShort(
    d: Date | string | number | null | undefined,
    locale?: string
  ): string;
  export function formatDateFrLong(
    d: Date | string | number | null | undefined,
    locale?: string
  ): string;
  export function formatDateTimeFrShort(
    d: Date | string | number | null | undefined,
    locale?: string
  ): string;
  export function formatDateTimeFrLong(
    d: Date | string | number | null | undefined,
    opts?: { lang?: 'fr' | 'en'; timeZone?: string }
  ): string;
}
