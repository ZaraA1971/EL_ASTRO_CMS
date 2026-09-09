/**
 * Export comptes pupitre — source unique (desk + API).
 *
 * API principale : usersExportCsv(users, context)
 *   context = 'csv'
 *
 * Pas de hash / jeton. Les call-sites passent le contexte, pas `;` / BOM.
 */

export const USERS_EXPORT_CONTEXTS = {
  /** CSV tableur FR (Excel) — séparateur `;`, BOM UTF-8. */
  csv: { separator: ';', bom: '\uFEFF' },
};

/** Colonnes stables — ordre = fichier. */
export const USERS_EXPORT_COLUMNS = [
  { key: 'id', header: 'id' },
  { key: 'login', header: 'identifiant' },
  { key: 'email', header: 'email' },
  { key: 'name', header: 'nom' },
  { key: 'role', header: 'role' },
  { key: 'status', header: 'statut' },
  { key: 'entitled', header: 'premium' },
  { key: 'desk', header: 'pupitre' },
  { key: 'access_until', header: 'fin_acces' },
  { key: 'newsletter', header: 'newsletter' },
  { key: 'source', header: 'source' },
  { key: 'wp_role', header: 'role_wp' },
  { key: 'notes', header: 'notes' },
  { key: 'registered', header: 'inscrit' },
  { key: 'updated_at', header: 'mis_a_jour' },
  { key: 'plan', header: 'plan' },
  { key: 'billing_email', header: 'email_facturation' },
  { key: 'stripe_customer_id', header: 'stripe_client' },
  { key: 'stripe_subscription_id', header: 'stripe_abonnement' },
];

function yn(v) {
  if (v === true || v === 1 || v === '1') return 'oui';
  if (v === false || v === 0 || v === '0') return 'non';
  return '';
}

function cellDate(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 19).replace('T', ' ');
  }
  return String(v).replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

/**
 * DTO desk / ligne BDD → ligne d’export (clés USERS_EXPORT_COLUMNS).
 */
export function deskUserToExportRow(user) {
  if (!user) return null;
  return {
    id: user.id ?? '',
    login: user.login || '',
    email: user.email || '',
    name: user.name || user.display_name || '',
    role: user.role || '',
    status: user.status || '',
    entitled: yn(user.entitled),
    desk: yn(user.desk),
    access_until: cellDate(user.access_until),
    newsletter: yn(user.newsletter_opt_in),
    source: user.source || '',
    wp_role: user.wp_role || '',
    notes: user.notes || '',
    registered: cellDate(user.registered),
    updated_at: cellDate(user.updated_at),
    plan: user.plan || '',
    billing_email: user.billing_email || '',
    stripe_customer_id: user.stripe_customer_id || '',
    stripe_subscription_id: user.stripe_subscription_id || '',
  };
}

function csvEscape(value, sep) {
  const s = value == null ? '' : String(value);
  if (/["\r\n]/.test(s) || s.includes(sep)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * @param {object[]} users — DTO desk (rowToDeskUser / publicUser + extras)
 * @param {'csv'} [context]
 */
export function usersExportCsv(users, context = 'csv') {
  const rules = USERS_EXPORT_CONTEXTS[context];
  if (!rules) throw new Error(`users-export: contexte inconnu ${context}`);
  const sep = rules.separator;
  const header = USERS_EXPORT_COLUMNS.map((c) => csvEscape(c.header, sep)).join(
    sep
  );
  const lines = [header];
  for (const user of users || []) {
    const row = deskUserToExportRow(user);
    if (!row) continue;
    lines.push(
      USERS_EXPORT_COLUMNS.map((c) => csvEscape(row[c.key], sep)).join(sep)
    );
  }
  return `${rules.bom || ''}${lines.join('\r\n')}\r\n`;
}
