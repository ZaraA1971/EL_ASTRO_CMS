/**
 * Bienvenue abonnement Stripe — délègue à l’e-mail de création de compte.
 */
import { sendAccountCreatedEmail } from '../account-email.mjs';

export async function sendWelcomeEmail({ user, resetToken, brevo, siteUrl }) {
  return sendAccountCreatedEmail({
    user,
    resetToken,
    brevo,
    siteUrl,
    source: 'stripe',
  });
}
