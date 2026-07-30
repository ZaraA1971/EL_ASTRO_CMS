/**
 * Colonnes Stripe / plan sur el_users (idempotent).
 */

let ensured = false;

async function addColumnIfMissing(pool, column, ddl) {
  await pool
    .query(`ALTER TABLE el_users ADD COLUMN IF NOT EXISTS ${ddl}`)
    .catch(async () => {
      const [cols] = await pool.query(`SHOW COLUMNS FROM el_users LIKE ?`, [
        column,
      ]);
      if (!cols.length) {
        await pool.query(`ALTER TABLE el_users ADD COLUMN ${ddl}`);
      }
    });
}

export async function ensureBillingSchema(pool) {
  if (ensured) return;
  // login = e-mail pour les abonnés Stripe (jusqu’à 100 chars comme email)
  try {
    await pool.query(
      'ALTER TABLE el_users MODIFY COLUMN login VARCHAR(100) NOT NULL'
    );
  } catch {
    /* ignore if already sized / unsupported */
  }
  await addColumnIfMissing(
    pool,
    'stripe_customer_id',
    'stripe_customer_id VARCHAR(64) NULL'
  );
  await addColumnIfMissing(
    pool,
    'stripe_subscription_id',
    'stripe_subscription_id VARCHAR(64) NULL'
  );
  await addColumnIfMissing(pool, 'plan', 'plan VARCHAR(32) NULL');
  await addColumnIfMissing(
    pool,
    'billing_email',
    'billing_email VARCHAR(100) NULL'
  );
  // MariaDB 10.5+ : IF NOT EXISTS — idempotent sans avaler d’autres erreurs
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_el_users_stripe_customer ON el_users (stripe_customer_id)'
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_el_users_stripe_subscription ON el_users (stripe_subscription_id)'
  );
  ensured = true;
}
