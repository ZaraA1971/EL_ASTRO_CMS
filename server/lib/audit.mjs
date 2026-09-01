/**
 * Journal d’audit desk (MySQL el_audit_log).
 */

import { nowMysql } from './mysql-date.mjs';

let ensured = false;

export async function ensureAuditTable(pool) {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS el_audit_log (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      at DATETIME NOT NULL,
      actor_id BIGINT UNSIGNED NULL,
      actor_login VARCHAR(60) NULL,
      action VARCHAR(64) NOT NULL,
      target_type VARCHAR(32) NULL,
      target_id VARCHAR(64) NULL,
      meta JSON NULL,
      ip VARCHAR(64) NULL,
      PRIMARY KEY (id),
      KEY idx_at (at),
      KEY idx_action (action),
      KEY idx_actor (actor_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  ensured = true;
}

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {{ actor?: { uid?: number, login?: string }, action: string, targetType?: string, targetId?: string|number, meta?: object, ip?: string }} evt
 */
export async function auditLog(pool, evt) {
  try {
    await ensureAuditTable(pool);
    const [result] = await pool.query(
      `INSERT INTO el_audit_log (at, actor_id, actor_login, action, target_type, target_id, meta, ip)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        nowMysql(),
        evt.actor?.uid != null ? Number(evt.actor.uid) : null,
        evt.actor?.login || null,
        String(evt.action || 'unknown').slice(0, 64),
        evt.targetType || null,
        evt.targetId != null ? String(evt.targetId).slice(0, 64) : null,
        evt.meta != null ? JSON.stringify(evt.meta) : null,
        evt.ip || null,
      ]
    );
    const insertId = result?.insertId;
    void import('./ops/vigie-ingress.mjs')
      .then((m) => m.pushVigieFromAudit(evt, insertId))
      .catch((err) => console.error('[audit] vigie', err.message));
  } catch (err) {
    console.error('[audit]', err.message);
  }
}
