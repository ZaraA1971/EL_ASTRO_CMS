# Pupitre core — contrats & inventaire (Phase 0 + migration identité)

Document de cadrage. Pas de code d’extraction ici.

**Décisions déjà prises**

| Sujet | Décision |
|-------|----------|
| Identité article | Migration **C appliquée** (SQL + code + deploy) : PK `article_id`, valeurs inchangées |
| URLs publiques | Restent `/articles/{id}-{slug}/` (le nombre ne change pas) |
| Open source | Optionnel, **après** modularisation ; licence envisagée MIT |
| Produit | Pas de SaaS Pupitre ; gain principal = modularité EL + éventuel intérêt dév |
| Prérequis rollback | GitHub `main` = `bff2cc8` (sync) · dump BDD `pre-article-id-migration-20260731T164546.sql.gz` |

**Ordre d’exécution**

1. ~~Phase 0 — ce document~~  
2. ~~Migration identité `wp_id` → `article_id` (code + SQL + deploy)~~  
3. ~~**Phase 1** — modulariser in-place~~ (1a registry API · 1b plugins routes · 1c UI split)  
4. Phase 2–3 — hooks host, package layout  
5. Phase 4 — OSS (optionnel)

Env optionnel : `DESK_PLUGINS=newsletter,audience,x,push,keywords,translate,assist,content-gen` (csv). Absent = tous ; vide = aucun plugin (caps plugin absentes).

## Ops — obligatoire à chaque phase

Avant tout deploy, restart service, ou purge cache pendant ce chantier : **relire [`CURSOR.md`](../CURSOR.md)**.

Rappels non négociables :

- Deploy **uniquement** via `./scripts/deploy.sh` (`web` / `api` / all) — jamais `build && restart` improvisé.
- Jamais `rm -rf` sur une zone nginx ; purge = `find <zone> -type f -delete` + `mkdir -p`.
- Jamais restart `el-astro-web` pendant / après un build raté.
- `npm test` avant deploy qui touche `server/` ; healthchecks `:4322` + `:8787` après.
- Pas de secrets (`/etc/electronlibre/*`) dans git.
- Desk UI = fichiers sous `/desk/` (sync fichiers) ; API = `./scripts/deploy.sh api`.

Checklist courte en fin de chaque phase touchant la prod :

```bash
npm test
./scripts/deploy.sh          # ou web / api selon le diff
curl -sI http://127.0.0.1:4322/ | head -1
curl -sS http://127.0.0.1:8787/api/health
journalctl -u el-astro-web -n 20 --no-pager   # pas ERR_MODULE_NOT_FOUND
```

---

## 1. Architecture actuelle

```
nginx /desk/  →  fichiers statiques  /var/www/el-astro/desk/
                     desk/app.js (SPA) + styles + symlinks shared/

navigateur    →  /api/desk/*  →  el-astro-rag-proxy (:8787)
                     server/api.mjs → handleDesk() (server/lib/desk.mjs)
                     + handlers media / users / newsletter / audience / x
```

- Pas de pages Astro pour le desk.
- Auth = cookie session site (`/api/auth/*`), résolue à nouveau côté desk (`resolveDeskSession`).
- Injection : objet `deskCtx` (pool, mediaRoot, brevo, onesignal, rag, x, deepl, …).

---

## 2. Identité article (cible)

| Avant | Après |
|-------|--------|
| PK `el_articles.wp_id` | PK `el_articles.article_id` |
| Même valeur numérique | Oui (transfert, pas de renumérotation) |
| Champ JSON / API `wp_id` | `article_id` |
| iOS DTO `id` | Inchangé (toujours le numéro) |
| RAG FAISS ids | Inchangés |
| `el_x_posts.article_id` | Déjà nommé ainsi ; pointe vers les mêmes ids |
| `translation_fr` / `translation_en` | Restent des BIGINT → `article_id` |

Création : `COALESCE(MAX(article_id), 100000) + 1` (même plancher qu’aujourd’hui).

Alias de compat JSON `wp_id` : **non** sauf besoin constaté (DTO iOS expose déjà `id`).

---

## 3. Vues UI (`?view=`)

| View | Rôle | Core / plugin |
|------|------|----------------|
| `login` | Connexion | **core** |
| `list` | Liste articles | **core** |
| `edit` | Éditeur article (+ zones plugin) | **core** (+ slots plugins) |
| `media` | Documents / médiathèque | **core** |
| `users` / `user-edit` | Comptes | **core** (champs billing = adapter EL) |
| `newsletter` | Campagnes Brevo | **plugin** `newsletter` |
| `audience` | Stats GoatCounter | **plugin** `audience` |

Navigation actuelle conditionnée par `capabilities` de `GET /api/desk/me`.

---

## 4. Routes `/api/desk/*`

### Core

| Méthode | Route | Notes |
|---------|-------|-------|
| GET | `/me` | user + capabilities (+ contentGen aujourd’hui → à extraire) |
| GET/POST | `/articles` | liste / création brouillon |
| GET/PUT/DELETE | `/articles/:id` | CRUD |
| POST | `/articles/:id/publish` | publier |
| POST | `/articles/:id/draft` | repasser en brouillon |
| GET/POST | `/categories` | rubriques |
| GET | `/authors?q=` | autocomplete auteur |
| GET/POST | `/media` | liste / upload |
| PATCH/DELETE | `/media/:id` | meta / suppression |
| GET/POST | `/users` | liste / création |
| GET/PUT/DELETE | `/users/:id` | CRUD compte |
| POST | `/users/:id/password` | régénérer MDP |

Auth machine optionnelle : `DESK_INGEST_API_KEY` sur `POST /articles` uniquement (core).

### Plugins EL (hors core)

| Plugin | Méthode | Route |
|--------|---------|-------|
| `keywords` (RAG) | POST | `/articles/:id/keywords` |
| `push` (OneSignal) | POST | `/articles/:id/push` |
| `translate` (DeepL) | POST | `/articles/:id/translate-uk` |
| `x` | GET/PUT | `/articles/:id/x` |
| `x` | POST | `/articles/:id/x/generate`, `…/x/post` |
| `assist` | POST | `/assist` |
| `content-gen` | GET | `/content-gen` |
| `newsletter` | * | `/newsletter…` |
| `audience` | * | `/audience…` |

Hors `/api/desk` mais host EL : `/api/billing/*`, `/api/ios/*`, `/api/rag/*`, auth site, purge cache nginx (`onPublish` hook).

---

## 5. Capabilities (`GET /api/desk/me`)

### Core (toujours définies)

| Cap | Sens actuel |
|-----|-------------|
| `editAll` | admin / editor |
| `create` | staff desk |
| `publish` | admin / editor |
| `manageUsers` | admin (via `canManageUsers`) |
| `media` | médiathèque |
| `mediaDelete` | admin / editor |

### Plugin (absentes ou `false` si plugin non monté)

| Cap | Plugin |
|-----|--------|
| `onesignal` / `onesignalDryRun` | `push` |
| `newsletter` / `newsletterDryRun` | `newsletter` |
| `audience` | `audience` |
| `xPost` / `xPostDryRun` / `xAccounts` | `x` |

Règle Phase 1 : l’UI n’affiche un onglet / bouton plugin **que** si la cap correspondante est vraie. Core sans plugins = Articles + Documents + Comptes (+ login).

---

## 6. Contrat `DeskPlugin` (cible Phase 1)

Interface logique (pas encore implémentée) :

```js
/**
 * @typedef {object} DeskPlugin
 * @property {string} id                 // ex. 'newsletter' | 'x' | 'audience'
 * @property {(ctx) => object} caps      // fragment mergé dans capabilities
 * @property {(req, res, parts, ctx) => boolean | Promise<boolean>} handleRoute
 *   // true = route consommée ; false = pas pour ce plugin
 * @property {object} [ui]
 * @property {string} [ui.navView]       // ?view=…
 * @property {string} [ui.navLabel]
 * @property {string} [ui.cap]           // cap qui montre l’onglet
 * @property {() => void} [ui.mountEditor]  // boutons / panneaux dans edit
 * @property {(article, ctx) => Promise<void>} [onPublish]
 * @property {(article, ctx) => Promise<void>} [onDraft]
 */
```

Host EL enregistre les plugins au boot ; `handleDesk` délègue d’abord au registry, sinon au routeur core.

Hooks host (hors plugin UI) :

- `onPublish` / `onDraft` — purge cache front, index RAG, etc.
- Champs user billing — adapter qui enrichit DTO users (`access_until`, `source`, Stripe) sans polluer le CRUD staff core.

---

## 7. Modèle données minimal (core)

Préfixe table : rester `el_*` chez EL ; un core portable pourra documenter des noms logiques.

| Table | Rôle core | Notes EL |
|-------|-----------|----------|
| `el_articles` | Contenu | PK → `article_id` ; `translation_*` optionnel bilingue |
| `el_categories` | Rubriques | |
| `el_media` | Documents | disque + URL configurables |
| `el_users` | Comptes / auth | core : id, login, email, hash, role, status ; EL : `access_until`, Stripe, newsletter_opt_in |
| `el_audit_log` | Journal desk | |

### Hors core (tables / JSON EL)

| Table / champ | Plugin / host |
|---------------|---------------|
| `el_newsletters`, `el_newsletter_recipients` | `newsletter` |
| `el_x_posts` | `x` |
| `el_users.access_until`, billing cols | host billing |
| `el_users.newsletter_*` | `newsletter` + host |
| FAISS / RAG store | host |

### Schéma articles (cible après rename)

Champs essentiels core : `article_id`, `slug`, `title`, `excerpt`, `body`, `date`, `modified`, `author*`, `categories`, `category_names`, `tags`, `ia_keywords`, `access`, `lang`, `draft`, `source_url`, timestamps.

Champs EL / plugins : `translation_fr`, `translation_en` (workflow DeepL) — peuvent rester en table chez EL tout en étant ignorés par un core nu.

---

## 8. Modules partagés déjà extraits

| Module | Chemin | Destin |
|--------|--------|--------|
| excerpt / chapo | `shared/excerpt.mjs` | **core** |
| html-clean | `shared/html-clean.mjs` | **core** |
| desk-ui | `shared/desk-ui.mjs` | **core** |
| categories (constantes front) | `shared/categories.mjs` | front site ; CRUD DB = API desk |

---

## 9. Hotspots & risques

1. **`desk/app.js` (~4.3k LOC)** — découpe par vue + `plugins/*.js` obligatoire en Phase 1.  
2. **Migration identité terminée** — `article_id` est désormais la PK (voir §2).  
3. **`el_users` mixte** — staff + abonnés Stripe ; core ne gère que le CRUD comptes, pas Checkout.  
4. **Publish side-effects** — OneSignal, cache nginx, keywords : sortent en hooks/plugins.  
5. **Pas de registry aujourd’hui** — seulement dispatch if/else + caps ; Phase 1 introduit le registre sans changer le comportement EL.

---

## 10. Critères de fin Phase 0

- [x] Inventaire routes / vues / caps  
- [x] Frontière core vs plugins écrite  
- [x] Contrat `DeskPlugin` esquissé  
- [x] Schéma minimal + décision `article_id`  
- [x] Prérequis rollback (git + dump) notés  

**Phase 0 et migration identité terminées.** Prochaine étape : **Phase 1** (modularisation in-place).
