# ElectronLibre — règles Cursor / ops prod

Ce fichier est la référence **ops + qualité** pour tout agent ou humain qui touche
le site en production (`electronlibre.info`). Lire avant de déployer.

Companion : `README.md` (architecture) · `AGENTS.md` (dev Astro).

## Incidents déjà vus (ne pas reproduire)

| Symptôme | Cause | Remède |
|---|---|---|
| **502** site-wide | Suppression du **dossier** zone nginx (`/var/cache/nginx/el-astro-prod`) | Recréer les dirs (`mkdir -p` + `chown www-data`), jamais `rm -rf` sur la zone |
| **Page blanche** / HTTP 500 | `el-astro-web` redémarré pendant ou juste après un `astro build` incomplet (`ERR_MODULE_NOT_FOUND` sur `dist/server/chunks/*`) | Build atomique vers `dist.next` puis swap, **puis** restart |

## Interdits absolus

- Ne **jamais** `rm -rf /var/cache/nginx` ni supprimer les dossiers zone :
  `el-astro-prod`, `el-astro`, `el-astro-qualif`.
- Ne **jamais** élargir une purge au-delà de :
  `find <zone> -type f -delete`.
- Ne **jamais** redémarrer `el-astro-web` pendant un build, ni si le build a échoué.
- Ne **jamais** servir / éditer un `dist/` à moitié écrit.
- Ne **jamais** committer de secrets (`.env`, `/etc/electronlibre/*`).

## Déploiement obligatoire

Utiliser le script (ne pas improviser une suite `build && restart && rm`) :

```bash
cd /var/www/el-astro
./scripts/deploy.sh          # tests + front + API + cache + healthchecks
./scripts/deploy.sh web      # front seulement (src/, public/, pages)
./scripts/deploy.sh api      # API seulement (server/, env billing)
./scripts/deploy.sh --skip-tests   # urgence uniquement
```

Le script :

1. `npm test` (sauf `--skip-tests`)
2. Build atomique : `astro build --outDir dist.next` → swap `dist`
3. Restart **après** swap réussi
4. Purge cache = **fichiers seulement** + `mkdir -p` des zones
5. Healthchecks locaux (`:4322` et `:8787`) — exit ≠ 0 si échec

### Qui redémarrer ?

| Changement | Action |
|---|---|
| `src/`, `public/`, `astro.config.*`, pages | `./scripts/deploy.sh web` |
| `server/` ou env API | `./scripts/deploy.sh api` (ou `all`) |
| Les deux | `./scripts/deploy.sh` |

Après édition de `/etc/electronlibre/el-astro-api.env` → restart API obligatoire
(`billing` / Stripe / DB sont lus au boot).

## Cache nginx

Zones :

- prod : `/var/cache/nginx/el-astro-prod`
- local/qualif : `/var/cache/nginx/el-astro`, `…/el-astro-qualif`

Purge sûre :

```bash
sudo mkdir -p /var/cache/nginx/el-astro-prod
sudo chown www-data:www-data /var/cache/nginx/el-astro-prod
sudo find /var/cache/nginx/el-astro-prod -type f -delete
```

Si `error.log` contient `mkdir() ".../el-astro-prod/…" failed (2: No such file)` :
recréer les dossiers zone, `nginx -t && systemctl reload nginx` — **ne pas**
continuer à supprimer.

Le code (`server/lib/front-cache.mjs`) ne doit purger que des fichiers et
réassurer l’existence des dossiers.

## Billing / compte (règles produit)

- Checkout public **off** sans `STRIPE_SECRET_KEY` + `STRIPE_PRICE_MONTHLY` +
  `STRIPE_WEBHOOK_SECRET` (sinon paiement sans provision).
- Staff (`admin` / `editor` / `author`) ≠ abonné Stripe sur `/compte/` :
  pas de portail, libellé « Compte équipe ».
- Ne pas rattacher manuellement des `cus_` / `sub_` de test aux comptes staff.
- Abonnés `annual_manual` : pas de checkout mensuel qui écrase le plan.
- Sur `/compte/`, une erreur `/api/billing/me` ne doit **pas** afficher l’écran
  « connectez-vous » si la session auth est valide.

Stripe Dashboard (complément, hors code) :

- E-mails abo / essais / échecs activés
- « Inclure un lien… gérer leurs abonnements » → lien perso
  `https://electronlibre.info/compte/`

## Services

| Unit | Rôle | Port |
|---|---|---|
| `el-astro-web.service` | Astro SSR | `127.0.0.1:4322` |
| `el-astro-rag-proxy.service` | API auth/billing/desk/RAG | `127.0.0.1:8787` |
| `nginx` | TLS + cache proxy | 80/443 |

Vérifs rapides :

```bash
curl -sI http://127.0.0.1:4322/ | head -1          # → HTTP/1.1 200
curl -sS http://127.0.0.1:8787/api/health           # → ok + billing
sudo journalctl -u el-astro-web -n 40 --no-pager    # pas de ERR_MODULE_NOT_FOUND
sudo tail -30 /var/log/nginx/error.log
```

## Qualité code (rock solid)

- Toujours `npm test` avant deploy touchant `server/` ou billing.
- Pas de changements ops « à la main » en prod hors script.
- Préférer messages d’erreur actionnables (`code:` JSON) aux 500 opaques.
- UI authentifiée : distinguer « non connecté » / « erreur API » / « chargé ».
- Ne pas cacher un CTA billing derrière un état DB incohérent (staff + Stripe).
- Après fix prod : healthcheck HTTP **avant** de dire que c’est bon.

## Source unique (quand c’est possible)

Règle : **une seule source de vérité** pour une constante, une règle métier ou un
module partagé. Pas de copie « alignée à la main » entre desk / API / Astro.

- Logique commune → `shared/*.mjs`
- API → `server/lib/*.mjs` en **re-export** depuis `shared/`
- Astro → alias Vite `@el/…` + éventuel re-export typé dans `src/lib/`
- Desk navigateur → **symlink** `desk/foo.js` → `../shared/foo.mjs`
  (extension `.js` obligatoire côté navigateur ; pas de `.mjs` servi tel quel)

Exemples : `shared/excerpt.mjs` (`stripHtmlToText`, chapô),
`shared/html-clean.mjs`, `shared/escape-html.mjs`,
`shared/mysql-date.mjs`, `shared/article-path.mjs`,
`shared/article-row.mjs` (`rowToArticle`, `parseJsonArray`),
`shared/roles.mjs` (rôles, ACL, libellés UI/e-mail),
`shared/editorial-update.mjs` (grâce 45 min « Mis à jour »),
`shared/categories.mjs` (rubriques builtins),
`shared/slugify.mjs` (articles `-`, rubriques `_`),
`shared/humanize.mjs` (tags / mots-clés affichés).

Si tu ajoutes une règle utilisée à plusieurs endroits : **factorer / étendre
`shared/` d’abord**, puis brancher les call-sites. Dupliquer un seuil ou une
fonction « pour aller vite » est une dette — la corriger avant de committer.

## Dev local

Voir `AGENTS.md` : `astro dev --background` (+ `stop` / `status` / `logs`).
Ne pas utiliser le script de deploy prod pour du simple dev.
