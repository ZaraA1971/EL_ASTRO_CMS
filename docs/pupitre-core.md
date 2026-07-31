# Pupitre — architecture & contrats

État au **2026-07-31** — phases **0–4** (slice OSS-ready dans le monorepo).

## Décisions

| Sujet | Choix |
|-------|--------|
| Identité article | PK `article_id` (ex-`wp_id`, valeurs inchangées) |
| URLs | `/articles/{id}-{slug}/` inchangé |
| Open source | Slice MIT dans le monorepo ; **pas** de repo séparé ni `npm publish` (encore) |
| Tables | Host EL : `el_articles` via `createArticleHelpers({ tableName })` |

## Layout

```
server/lib/desk/
  core/     # portable : registry, lifecycle, content-gen, article-helpers
  el/       # adapters EL : article-host, article-el, plugins/*
desk/       # SPA : core/ · views/ · plugins/ (UI)
packages/
  pupitre-core/   # façade npm + LICENSE MIT + README public
  pupitre-el/     # façade → desk/el
examples/pupitre-minimal/   # démo exécutable (registry + hooks)
```

## Core vs EL

| Core (`desk/core`) | Adapters EL (`desk/el`) |
|--------------------|-------------------------|
| Registry + hooks lifecycle | `article-host` (`el_articles` + rôles EL) |
| `createArticleHelpers` (table + predicates injectés) | Plugins Brevo / Goat / X / OneSignal / DeepL / RAG |
| `contentGen` | Assist éditorial, purge nginx (`front-cache`) |
| Utils purs (`slugify`, …) | Marque (`DESK_BRAND_*`) |
| | CRUD HTTP reste dans `desk.mjs` (host) |

## Registry & hooks

[`server/lib/desk/core/plugin-registry.mjs`](../server/lib/desk/core/plugin-registry.mjs) :

- `caps` · `match` / `handle` · `matchArticle` / `handleArticle`
- Hooks : `onPublish` · `onDraft` · `onMutate` · `onCategoryChange`
- `emitDeskLifecycle()` = bump `contentGen` + hooks

Env : `DESK_PLUGINS=front-cache,newsletter,audience,x,push,keywords,translate,assist,content-gen`  
Absent = tous ; vide = aucun plugin.

Marque host :

```bash
DESK_BRAND_NAME=ElectronLibre
DESK_BRAND_PRODUCT=ElectronLibre
DESK_BRAND_SHORT=Pupitre EL
DESK_ASSIST_PROFILE=electronlibre
```

`GET /api/desk/me` → `brand`, `capabilities`, `plugins`.

## Caps UI

Onglets plugin **uniquement** si la cap est vraie (`newsletter`, `audience`, …).

## Phase 4 (faite) — slice OSS-ready

Livré :

1. Core sans import `roles.mjs` / `keywords.mjs` / SQL `el_*` hardcodé
2. README + MIT dans [`packages/pupitre-core/`](../packages/pupitre-core/)
3. Démo exécutable [`examples/pupitre-minimal/demo.mjs`](../examples/pupitre-minimal/demo.mjs)

Hors scope Phase 4 :

- Repo GitHub public dédié / `npm publish`
- Extract du CRUD `handleDesk` hors monorepo
- Sortie assist / keywords / translate de `desk/views/edit.js`

## Suite éventuelle

1. Repo public ne contenant que `pupitre-core` (+ exemple)
2. Extraire routes articles/médias/users en module host-agnostic
3. Plugins UI desk pour assist / keywords / translate
4. `npm publish @electronlibre/pupitre-core` (lever `private`)

## Ops (prod EL)

Relire [`CURSOR.md`](../CURSOR.md) avant deploy.

```bash
npm test
./scripts/deploy.sh api
curl -sI http://127.0.0.1:4322/
curl -sS http://127.0.0.1:8787/api/health
```
