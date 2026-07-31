# Pupitre — architecture & contrats

État au **2026-07-31** (phases 0–3 faites). Document pour humains / agents avant Phase 4 (OSS optionnelle).

## Décisions

| Sujet | Choix |
|-------|--------|
| Identité article | PK `article_id` (ex-`wp_id`, valeurs inchangées) |
| URLs | `/articles/{id}-{slug}/` inchangé |
| Open source | Optionnel après ce nettoyage ; MIT envisagée |
| Tables | Convention host EL : `el_*` (pas encore abstrait) |

## Layout

```
server/lib/desk/
  core/     # registry, lifecycle, content-gen, article-helpers (portable)
  el/       # plugins EL + article-el (RAG, jumeaux) + el-plugins
desk/       # SPA : core/ · views/ · plugins/ (UI)
packages/
  pupitre-core/   # façade npm → server/lib/desk/core (pas encore un package isolé)
  pupitre-el/     # façade npm → server/lib/desk/el
examples/pupitre-minimal/   # esquisse d’un host minimal
```

## Core vs EL

| Core | Adapters EL (`desk/el`) |
|------|-------------------------|
| Auth session + rôles / caps | Stripe / billing fields UI |
| Articles CRUD, publish/draft | Newsletter Brevo |
| Catégories, auteurs, médias | Audience GoatCounter |
| Comptes staff (CRUD) | Studio X, OneSignal, DeepL, RAG keywords |
| `excerpt`, `html-clean`, desk-ui | Assist éditorial, purge nginx (`front-cache`) |
| Registry + hooks lifecycle | Marque (`DESK_BRAND_*`) |

## Registry & hooks

Implémentés (`server/lib/desk/core/plugin-registry.mjs`) :

- `caps` · `match` / `handle` · `matchArticle` / `handleArticle`
- Hooks : `onPublish` · `onDraft` · `onMutate` · `onCategoryChange`
- `emitDeskLifecycle()` = bump `contentGen` + hooks (sans side-effect nginx dans le core)

Env : `DESK_PLUGINS=front-cache,newsletter,audience,x,push,keywords,translate,assist,content-gen`  
Absent = tous ; vide = aucun plugin.

Marque host (API + UI) :

```bash
DESK_BRAND_NAME=ElectronLibre
DESK_BRAND_PRODUCT=ElectronLibre
DESK_BRAND_SHORT=Pupitre EL
DESK_ASSIST_PROFILE=electronlibre
```

`GET /api/desk/me` renvoie `brand`, `capabilities`, `plugins`.

## Caps UI

Onglets plugin **uniquement** si la cap est vraie (`newsletter`, `audience`, …) — plus de repli `|| publish`.

## Ops (prod EL)

Relire [`CURSOR.md`](../CURSOR.md) avant deploy.

```bash
npm test
./scripts/deploy.sh api   # ou web / all
curl -sI http://127.0.0.1:4322/
curl -sS http://127.0.0.1:8787/api/health
```

## Avant Phase 4 (OSS)

Encore à clarifier pour un dév externe :

1. Extraire vraiment le package (plus de dépendance monorepo `el_*` / `roles.mjs` durs)
2. Exemple host exécutable (pas seulement esquisse)
3. Découper le reste de l’éditeur UI (assist / keywords / translate encore dans `views/edit.js`)
4. LICENSE + README public Pupitre

Voir `examples/pupitre-minimal/` et `packages/pupitre-core/README.md`.
