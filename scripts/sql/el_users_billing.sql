-- Colonnes facturation Stripe (abonnement en ligne)
-- Idempotent via ensureBillingSchema() au démarrage API.

ALTER TABLE el_users
  ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS plan VARCHAR(32) NULL,
  ADD COLUMN IF NOT EXISTS billing_email VARCHAR(100) NULL;

CREATE INDEX IF NOT EXISTS idx_el_users_stripe_customer
  ON el_users (stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_el_users_stripe_subscription
  ON el_users (stripe_subscription_id);
