# ElectronLibre — front Astro (prod)

**Site** : https://electronlibre.info  
**Pupitre** : https://electronlibre.info/desk/  
WordPress **retiré** (runtime hors live) ; site + app iOS 100 % Astro/Node.

| Ressource | Emplacement |
|-----------|-------------|
| Médias / documents | `/var/www/el-media/uploads` → **`/media/`** (`el_media` + Pupitre) |
| Articles / comptes | MySQL `el_articles` / `el_users` |
| App iOS | `/api/ios/v1/*` → Node · Bearer JWT |
| Chemins WP | **410** (`/wp-json`, `/wp-admin`, `/wp-login.php`, …) |
| `/wp-content/uploads/*` | **301** → `/media/…` |
| RAG | indexe `el_articles` (FAISS IDs = `article_id`) |
| Backup BDD | `/var/backups/electronlibre-db/` (glissant 7j, cron 22:00) |
| Code WP | `/var/backups/electronlibre-astro/wordpress-runtime-retired-*` (+ freeze 2026-07-25) |

## Accès

| Surface | URL |
|---------|-----|
| Site | https://electronlibre.info/ |
| Login | `/login/` · oublié `/login/forgot/` · reset `/login/reset/` |
| Abonnement | `/abonnement/` |
| Pupitre | https://electronlibre.info/desk/ |

Rôles : `admin` / `editor` · `author` · `subscriber` · `other`.  
**Publier = immédiat** (MySQL) — pas de rebuild Astro à chaque article.

**Sécurité / droits** : source de vérité = `el_users` + `canAccessPremium`. Cookie web = identité seule ; JWT iOS `isSubscriber` = hint UI (refresh au foreground — voir [`docs/ios-auth.md`](docs/ios-auth.md)). Articles abonnés : teaser SSR + corps via `/api/content` (`el-auth.js`).

## Architecture

| Service | Rôle |
|---------|------|
| `el-astro-web.service` | Astro Node SSR `:4322` |
| `el-astro-rag-proxy.service` | API `:8787` (auth, content, desk, newsletter, RAG proxy) |
| `rag.service` | RAG upstream `:8080` — cron index `el_articles` 03:00 |
| MySQL `el_*` | Source de vérité Astro |
| Médias | nginx `/media/` → `/var/www/el-media/uploads` |

Env : `/etc/electronlibre/el-astro-api.env` (**jamais** dans git).  
`EL_MEDIA_ROOT=/var/www/el-media/uploads` (défaut).

## Documents (médiathèque Pupitre)

Stock de **pièces jointes / documents** (images, PDF, Office, zip…) — **pas** une banque d’illustrations pour le front (pas de cards, `og:image`, hero, une).

- Table MySQL `el_media` · SQL [`scripts/sql/el_media.sql`](scripts/sql/el_media.sql)
- Disque `/var/www/el-media/uploads` · URL `/media/` · 301 depuis `/wp-content/uploads/`
- API Pupitre : `GET/POST /api/desk/media`, `PATCH/DELETE /api/desk/media/:id`
- Types : jpeg/png/webp/gif, PDF, txt/csv, doc(x)/xls(x)/ppt(x)/odt/ods/odp, zip — max **25 Mo**
- UI : onglet **Documents** (`/desk/?view=media`) + bouton **Document** dans l’éditeur — upload, recherche, libellé, suppression ; insertion = **lien fichier** (`<a class="el-doc">`), pas d’`<img>` décoratif
- Aperçus pupitre : `.thumb.webp` (~320px) via `sharp` pour les images uniquement ; pastille de type pour les autres
- Index stock historique (images) :

```bash
cd /var/www/el-astro
npm run media:index              # scan + upsert + thumbs
npm run media:index -- --limit=200
npm run media:index -- --dry-run
```

## Mots-clés

- `tags` : slugs WP historiques (conservés)
- `ia_keywords` : libellés Astro (copie humanisée des tags WP via `npm run keywords:from-wp-tags`)
- Génération RAG desk : écrase `ia_keywords` à la demande

## Chapô / excerpts

Source unique : [`shared/excerpt.mjs`](shared/excerpt.mjs)  
→ API `server/lib/excerpt.mjs` · Astro `@el/excerpt` · desk `desk/excerpt.js` (symlink ; **pas** `.mjs` en navigateur).

Mise à jour éditoriale (grâce 45 min) : [`shared/editorial-update.mjs`](shared/editorial-update.mjs)  
→ API `server/lib/editorial-update.mjs` · Astro `@el/editorial-update` · desk `desk/editorial-update.js` (symlink).

Rubriques builtins : [`shared/categories.mjs`](shared/categories.mjs)  
→ API `server/lib/categories.mjs` · Astro `@el/categories` · desk `desk/categories.js` (symlink ; fallback pupitre via `desk/core/rubrics.js`).

Échappement HTML : [`shared/escape-html.mjs`](shared/escape-html.mjs)  
→ API `server/lib/escape-html.mjs` · desk `desk/escape-html.js` (symlink).  
Texte depuis HTML : `stripHtmlToText` / `trimExcerpt` dans [`shared/excerpt.mjs`](shared/excerpt.mjs) (pas de copies locales).

Dates MySQL : [`shared/mysql-date.mjs`](shared/mysql-date.mjs) → `server/lib/mysql-date.mjs`.  
URL article `/articles/{id}-{slug}/` : [`shared/article-path.mjs`](shared/article-path.mjs)  
→ API · Astro `@el/article-path` · desk `desk/article-path.js` (symlink).

Ligne article MySQL : [`shared/article-row.mjs`](shared/article-row.mjs)  
(`parseJsonArray`, `parseRowDate`, `rowToArticle`) → API `server/lib/db.mjs` · Astro `@el/article-row`.

Rôles / libellés : [`shared/roles.mjs`](shared/roles.mjs)  
→ API `server/lib/roles.mjs` · Astro `@el/roles` · desk `desk/roles.js` (symlink).

```js
chapo(article, 'hero')           // 130
chapo(article, 'card')           // 28
chapo(article, 'related')        // 32
chapo(row, 'ios', { entitled })
chapo(bodyHtml, 'store')
```

## Comptes

Création manuelle au pupitre **ou** après paiement Stripe (abonnement mensuel). Sync WP **off** (`EL_SYNC_USERS_FORCE=1` pour un import one-shot historique).

## Abonnement en ligne (Stripe)

- **Mensuel** : 10 jours d’essai, puis 100 € / mois sans engagement — Checkout Stripe (CB + PayPal) sur `/abonnement/`
- **Annuel** : 900 € / an — demande par e-mail (`info@electronlibre.info`)
- Après checkout : compte `el_users` (`source=stripe`, `plan=monthly`, `access_until`) + e-mail Brevo de bienvenue (choix du mot de passe) ; statut Stripe `trialing` pendant l’essai
- Comptes : e-mail Brevo au titulaire à la création + notification admins à la création **et** à la suppression (`server/lib/account-email.mjs`, template `server/lib/email/brand.mjs`)
- Newsletter : opt-in dès création Stripe / Pupitre (`ensureNewsletterEnrollment`) — **sans** attendre le mot de passe
- Espace abonné : `/compte/` (statut, portail facturation Stripe, MDP, newsletter)
- SQL colonnes : [`scripts/sql/el_users_billing.sql`](scripts/sql/el_users_billing.sql) (aussi via `ensureBillingSchema`)

Env (`/etc/electronlibre/el-astro-api.env`) — à renseigner quand Stripe est prêt :

```bash
STRIPE_SECRET_KEY=sk_live_…
STRIPE_WEBHOOK_SECRET=whsec_…
STRIPE_PRICE_MONTHLY=price_…   # Price 100 € / mois
# STRIPE_TRIAL_DAYS=10         # optionnel (défaut 10 ; 0 = pas d’essai)
```

Webhook Stripe → `POST https://electronlibre.info/api/billing/webhook`  
Événements : `checkout.session.completed`, `customer.subscription.updated|deleted`, `invoice.paid`.

Sans ces clés, le checkout affiche un message « bientôt » et renvoie `BILLING_DISABLED` ; l’annuel par e-mail reste disponible.

## Auth / API

- Auth : `/api/auth/*` (login, logout, me, forgot, reset)
- Billing : `/api/billing/*` (config, checkout, me, portal, password, webhook)
- Contenu abonné : `/api/content/:articleId`
- Desk : `/api/desk/*` (articles, users, newsletter, audience, **media**)
- Compagnon : `/api/rag/askWeb` (entitled)
- App iOS : `/api/ios/v1/*` (Bearer) — `/wp-json` coupé (410)

## Sitemaps / SEO

- `/wp-sitemap.xml` — index général (statique, à soumettre GSC)
- `/news-sitemap.xml` — Google News
- Génération : `node scripts/build-sitemaps.mjs` (cron */30)
- GA4 : `G-Q3W21V1KB5`

## Ops

**Référence agents / deploy :** [`CURSOR.md`](./CURSOR.md)

```bash
cd /var/www/el-astro
./scripts/deploy.sh          # tests + build atomique + restart + cache + health
./scripts/deploy.sh web      # front seulement
./scripts/deploy.sh api      # API seulement
```

Ne **jamais** supprimer les dossiers `/var/cache/nginx/el-astro-*` (uniquement
`find … -type f -delete`). Ne jamais redémarrer `el-astro-web` pendant un build.

OneSignal : envoi réel. `ONESIGNAL_DRY_RUN=1` seulement pour un essai sans notif.

### X (Twitter) — studio Pupitre

Panneau dans l’éditeur article (`/desk/`) : variantes d’accroche orientées engagement, compte cible (`@3l3ctr0nLibr3` / `@Bulletin_UE`), puis **publication manuelle** (Copier ou Ouvrir le composer X). Pas d’API X payante en prod.

Routes : `GET|PUT /api/desk/articles/:id/x`, `POST …/x/generate` (brouillon + Assist).

Archive MD d’import : backup `/var/backups/electronlibre-astro/articles-md-import-*.tar.gz` (hors live).

Health : `GET /api/health` · RAG `GET http://127.0.0.1:8080/health/index`

## Hors scope

`rag` / `dash` / `désinfo` code métier · secrets `/etc/electronlibre/*` · drop tables `eaxgw_*` (legacy, encore en BDD).
