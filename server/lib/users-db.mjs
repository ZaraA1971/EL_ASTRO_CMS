/**
 * Lectures el_users partagées (web + iOS).
 */

const USER_COLS = `id, login, email, display_name, password_hash, role, status, access_until, wp_role, source, updated_at`;

export async function findUserById(pool, userId) {
  const id = Number(userId) || 0;
  if (!id) return null;
  const [rows] = await pool.query(
    `SELECT ${USER_COLS} FROM el_users WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

export async function findUserByLogin(pool, loginOrEmail) {
  const id = String(loginOrEmail || '')
    .trim()
    .toLowerCase();
  if (!id) return null;
  const [rows] = await pool.query(
    `SELECT ${USER_COLS}
     FROM el_users
     WHERE LOWER(login) = ? OR LOWER(email) = ?
     LIMIT 1`,
    [id, id]
  );
  return rows[0] || null;
}
