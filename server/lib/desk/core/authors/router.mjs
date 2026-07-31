/**
 * GET /api/desk/authors — autocomplete auteurs (articles + comptes staff).
 * Tables + rôles staff injectés (pas de hardcode el_*).
 *
 * ctx :
 *   pool, sendJson, session
 *   articlesTable, usersTable
 *   slugify
 *   staffRoles — string[] pour SQL IN (ex. admin, editor, author)
 */
import { assertSafeSqlIdent } from '../http.mjs';

/**
 * @returns {Promise<boolean>}
 */
export async function handleCoreAuthors(req, res, parts, ctx) {
  if (parts[2] !== 'authors' || parts[3] || req.method !== 'GET') {
    return false;
  }

  const { pool, sendJson, articlesTable, usersTable, slugify, staffRoles } =
    ctx;
  const aTable = assertSafeSqlIdent(
    articlesTable || 'articles',
    'table articles'
  );
  const uTable = assertSafeSqlIdent(usersTable || 'users', 'table users');
  const roles = Array.isArray(staffRoles) && staffRoles.length
    ? staffRoles
    : ['admin', 'editor', 'author'];
  for (const r of roles) {
    if (!/^[a-z0-9_]+$/i.test(r)) {
      sendJson(res, 500, { error: 'staffRoles invalides' });
      return true;
    }
  }
  const rolePlaceholders = roles.map(() => '?').join(', ');
  const slugFn =
    typeof slugify === 'function'
      ? slugify
      : (s) =>
          String(s || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || 'auteur';

  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const q = String(url.searchParams.get('q') || '').trim();
  const like = q ? `%${q}%` : null;
  const out = [];
  const seen = new Set();

  const push = (row) => {
    const name = String(row.name || '').trim();
    if (!name) return;
    const key = name.toLocaleLowerCase('fr');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      name,
      slug: row.slug ? String(row.slug) : slugFn(name),
      userId: row.user_id != null ? Number(row.user_id) : null,
      source: row.source || 'article',
    });
  };

  if (like) {
    const [fromArticles] = await pool.query(
      `SELECT author AS name, author_slug AS slug, author_user_id AS user_id,
              COUNT(*) AS n, 'article' AS source
       FROM \`${aTable}\`
       WHERE author LIKE ?
       GROUP BY author, author_slug, author_user_id
       ORDER BY n DESC, author ASC
       LIMIT 16`,
      [like]
    );
    for (const r of fromArticles) push(r);

    const [fromUsers] = await pool.query(
      `SELECT display_name AS name, login AS slug, id AS user_id, 'user' AS source
       FROM \`${uTable}\`
       WHERE status = 'active'
         AND role IN (${rolePlaceholders})
         AND (display_name LIKE ? OR login LIKE ?)
       ORDER BY display_name ASC
       LIMIT 16`,
      [...roles, like, like]
    );
    for (const r of fromUsers) push(r);
  } else {
    const [top] = await pool.query(
      `SELECT author AS name, author_slug AS slug, author_user_id AS user_id,
              COUNT(*) AS n, 'article' AS source
       FROM \`${aTable}\`
       WHERE author IS NOT NULL AND TRIM(author) != ''
       GROUP BY author, author_slug, author_user_id
       ORDER BY n DESC, author ASC
       LIMIT 12`
    );
    for (const r of top) push(r);
  }

  sendJson(res, 200, { authors: out.slice(0, 12) });
  return true;
}
