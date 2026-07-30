/**
 * Fin de la période facturable en cours → Date JS (= prochain renouvellement
 * tant que l’abo Stripe n’est pas résilié ; le renouvellement tacite prolonge
 * via invoice.paid / subscription.updated → sync access_until).
 *
 * API récente : current_period_end est sur subscription.items.data[],
 * plus (ou pas toujours) au niveau racine de l’abonnement.
 */
export function periodEndFromSubscription(sub) {
  if (!sub) return null;

  const fromItems = (sub.items?.data || [])
    .map((it) => Number(it?.current_period_end))
    .filter((n) => Number.isFinite(n) && n > 0);

  const end =
    Number(sub.current_period_end) ||
    (fromItems.length ? Math.max(...fromItems) : 0) ||
    Number(sub.trial_end) ||
    Number(sub.cancel_at) ||
    0;

  if (!end) return null;
  const d = new Date(end * 1000);
  return Number.isNaN(d.getTime()) ? null : d;
}
