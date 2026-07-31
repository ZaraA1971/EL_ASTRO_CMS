# @electronlibre/pupitre-core

Cœur portable du CMS **Pupitre** (Phase 3).

## Source of truth (aujourd’hui)

Le code vit encore dans le monorepo EL :

```
../../server/lib/desk/core/
```

Ce package expose la surface publique via `exports` → `index.mjs`.

## Contenu core

| Module | Rôle |
|--------|------|
| `plugin-registry` | Registry plugins + `runHooks` |
| `lifecycle` | `emitDeskLifecycle` (bump + hooks) |
| `content-gen` | Compteur cache HTTP (sans side-effects host) |
| `article-helpers` | slug, ids, droits édition, sync mots-clés jumeau |

## Hors core (package `pupitre-el`)

Newsletter, audience, X, OneSignal, DeepL, RAG keywords, assist, purge nginx.

## UI

SPA sous `/desk/` (`desk/core`, `desk/views`, `desk/plugins`) — même produit, couche navigateur.
