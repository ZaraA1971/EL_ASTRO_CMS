declare module '@el/roles' {
  export const ROLES: Readonly<{
    ADMIN: 'admin';
    EDITOR: 'editor';
    AUTHOR: 'author';
    SUBSCRIBER: 'subscriber';
    OTHER: 'other';
  }>;
  export const STATUSES: Readonly<{
    ACTIVE: 'active';
    DISABLED: 'disabled';
    EXPIRED: 'expired';
  }>;
  export const ROLE_LABELS_UI: Readonly<Record<string, string>>;
  export const ROLE_LABELS_EMAIL: Readonly<Record<string, string>>;
  export const STATUS_LABELS: Readonly<Record<string, string>>;
  export const STAFF_ROLE_KEYS: readonly string[];
  export function mapWpRoleToEl(wpRole: string): string;
  export function normalizeRole(role: string): string;
  export function isStaffRole(role: string): boolean;
  export function isRedacteurRole(role: string): boolean;
  export function canAccessDesk(role: string): boolean;
  export function canEditAll(role: string): boolean;
  export function canPublish(role: string): boolean;
  export function canAccessPremium(user: {
    role?: string;
    status?: string;
    access_until?: string | Date | null;
  } | null): boolean;
  export function effectiveStatus(user: {
    role?: string;
    status?: string;
    access_until?: string | Date | null;
  } | null): string;
  export function roleLabelUi(role: string): string;
  export function roleLabelEmail(role: string): string;
  export function statusLabel(status: string): string;
}
