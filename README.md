# ElectronLibre — front Astro (migration)

Staging Scaleway. WordPress prod **inchangé**.

## Accès

| Surface | URL |
|---------|-----|
| Site | https://qualif.electronlibre.info/ (aussi `:8090`) |
| Login | `/login/` · oublié `/login/forgot/` · reset `/login/reset/` |
| Abonnement | `/abonnement/` |
| Pupitre | https://qualif.electronlibre.info/desk/ (aussi `:8091/desk/`) |

Compte test : `el-staging` (mot de passe hors dépôt).  
Rôles : `admin` / `editor` (tous articles) · `author` (ses articles).  
**Publier = immédiat** (MySQL) — pas de rebuild Astro à chaque article.

## Architecture

| Service | Rôle |
|---------|------|
| `el-astro-web.service` | Astro Node SSR `:4322` |
| `el-astro-rag-proxy.service` | API Node `server/api.mjs` `:8787` (auth, content, desk, newsletter, RAG proxy) |
| MySQL `el_articles` | Source de vérité articles |
| MySQL `el_users` | Comptes / rôles (sync WP) |

Env principal : `/etc/electronlibre/el-astro-api.env` (**jamais** dans git).  
TinaCMS retiré. Pupitre = `/desk/` uniquement.  
Tables Astro : `el_*` — **jamais** les tables WP `eaxgw_*`.

## Comptes (`el_users`)

| Niveau | `role` | Droits |
|--------|--------|--------|
| Admin | `admin` | Pupitre + premium + gestion de tous les comptes |
| Rédacteurs | `editor` / `author` | Pupitre (+ editor gère abonnés/auteurs) |
| Abonnés | `subscriber` | Premium si actif / non expiré |
| Autres | `other` | Contenu `granted` seulement |

Sync WP : `php scripts/sync-el-users.php` (cron horaire).  
Pupitre → **Comptes** : CRUD, régénération MDP, suppression (ACL `canMutateUser`).

## Auth front

- Connexion : identifiant **ou** e-mail (`POST /api/auth/login`)
- Mot de passe oublié : `POST /api/auth/forgot` → e-mail Brevo → `/login/reset/?token=`
- Layout auth minimal (sans Compagnon) pour les gestionnaires de MDP
- `/.well-known/change-password` → `/login/forgot/`

## Newsletter

- Compose / envoi depuis Pupitre (`view=newsletter`)
- Groupes : `admin` · `redacteurs` · `abonnes`
- Brevo (API ou SMTP) ; `BREVO_DRY_RUN` dans l’env API
- Désabo public : `/newsletter/unsubscribe/`

## API (`:8787` via `/api/`)

| Route | Rôle |
|-------|------|
| `POST /api/auth/login` | Connexion |
| `POST /api/auth/logout` | Déconnexion |
| `GET /api/auth/me` | Session + `entitled` / `desk` |
| `POST /api/auth/forgot` | Demande reset MDP |
| `GET/POST /api/auth/reset` | Valider jeton / nouveau MDP |
| `GET /api/content/:wpId` | Corps article (entitled) |
| `GET/POST/PUT/DELETE /api/desk/users[/:id]` | Comptes |
| `POST /api/desk/users/:id/password` | Régénérer MDP |
| `GET/POST /api/desk/newsletter*` | Newsletter desk |
| `POST /api/newsletter/unsubscribe` | Désabo |
| `POST /api/desk/articles/:id/publish` | Publier (`push` optionnel) |
| `POST /api/rag/askWeb` | Compagnon (entitled) |

## Solidification

- Vague A–C : paywall, ACL desk DB, OneSignal dry-run, rate-limit, audit, perf listes
- Newsletter Brevo + groupes privilèges
- Auth reset + layout PM-friendly

## CSS / assets

- Source unique : `public/css/el/*` — cache-bust `ASSET_V` (`src/lib/assets.ts`)
- Articles MD sous `src/content/articles/` = **archive d’import** (ignorés par git / non indexés au build). SoT = MySQL.

## Ops

```bash
cd /var/www/el-astro
npm test
npm run build
sudo systemctl restart el-astro-web.service
sudo systemctl restart el-astro-rag-proxy.service
php scripts/sync-el-users.php
npm run import:articles:db   # MD archive → el_articles
```

Health : `GET /api/health` → `ok`, `db`, `brevo`, `brevoDryRun`, `onesignalDryRun`, …

## Hors scope

`rag` / `dash` / `désinfo` / WP prod / secrets `/etc/electronlibre/*`.
