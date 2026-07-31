# @electronlibre/pupitre-core

Cœur portable **Pupitre** — registry de plugins, hooks de cycle de vie, helpers articles injectables.

Licence **MIT** — voir [`LICENSE`](./LICENSE).

## Statut

Façade dans le monorepo ElectronLibre (`private: true`).

| Oui | Non (encore) |
|-----|----------------|
| Code source sous `server/lib/desk/core/` | Package npm publié |
| Aucun import `roles.mjs` / `keywords.mjs` / tables `el_*` | Hash mots de passe / Brevo / newsletter |
| CRUD articles + catégories + médias + authors + users | UI desk (`desk/`) |
| Exemple exécutable `examples/pupitre-minimal/` | Plugins EL (Brevo, OneSignal, RAG, …) |

Doc d’architecture : [`docs/pupitre-core.md`](../../docs/pupitre-core.md).

## Install (monorepo)

```js
import {
  createPluginRegistry,
  emitDeskLifecycle,
  createArticleHelpers,
  bumpContentGen,
  getContentGen,
} from '../../server/lib/desk/core/index.mjs';
```

Ou via le package local :

```js
import { createPluginRegistry } from '@electronlibre/pupitre-core';
```

(`package.json` → `exports` pointe vers `server/lib/desk/core`.)

## Surface

| Export | Rôle |
|--------|------|
| `createPluginRegistry` / `resolveEnabledPluginIds` | Plugins, caps, routes, hooks |
| `emitDeskLifecycle` | bump `contentGen` + hooks (`onPublish`, …) |
| `bumpContentGen` / `getContentGen` | Génération de cache |
| `createArticleHelpers({ tableName, canAccessDesk, canEditAll })` | Helpers SQL/droits liés au host |
| `createCategoriesStore({ tableName, defaults })` | Rubriques |
| `createMediaStore` / `handleCoreMedia` | Médiathèque (`ctx.mediaFs`) |
| `handleCoreAuthors` | Autocomplete auteurs |
| `createUsersStore` / `handleCoreUsers` | Comptes (`ctx.userPolicy` + hooks) |
| `tryHandleCoreCrud` | Toutes les routes CRUD ci-dessus |

**Users — contrat de sécurité :** le host doit fournir `userPolicy.hashPassword` (chez EL : phpass WordPress). Le core refuse de démarrer sans policy complète. Side-effects (mails, newsletter) = `afterUserCreate` / `afterUserDelete` uniquement.
| `slugify`, `asJson`, `nowMysql`, `toMysqlDate`, `PLACEHOLDER_SLUGS` | Utils purs |

Le host fournit predicates de rôles, tables, `rowToArticle`, et hooks optionnels (`beforeArticleRoute`, `afterPublish`, RAG/twins). Chez ElectronLibre : `server/lib/desk.mjs` + `desk/el/article-host.mjs`.

## Exemple

```bash
node examples/pupitre-minimal/demo.mjs
```

## Ce qui reste hors package

- `server/lib/desk.mjs` — host HTTP CRUD EL
- `server/lib/desk/el/` — adapters produit
- `desk/` — SPA éditoriale
