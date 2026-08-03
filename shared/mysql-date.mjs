/**
 * Dates MySQL DATETIME — source unique (UTC → `YYYY-MM-DD HH:mm:ss`).
 */

export function toMysqlDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export function nowMysql() {
  return toMysqlDate(new Date());
}
