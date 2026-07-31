# @electronlibre/pupitre-core

Cœur portable **Pupitre** — registry de plugins, hooks de cycle de vie, helpers articles injectables.

Licence **MIT** — voir [`LICENSE`](./LICENSE).

## Statut

Façade dans le monorepo ElectronLibre (`private: true`).

| Oui | Non (encore) |
|-----|----------------|
| Code source sous `server/lib/desk/core/` | Package npm publié |
| Aucun import `roles.mjs` / `keywords.mjs` / tables `el_*` | CRUD articles / médias / users |
| Exemple exécutable `examples/pupitre-minimal/` | UI desk (`desk/`) |
| | Plugins EL (Brevo, OneSignal, RAG, …) |

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
| `slugify`, `asJson`, `nowMysql`, `toMysqlDate`, `PLACEHOLDER_SLUGS` | Utils purs |

Le host fournit les predicates de rôles et le nom de table articles. Chez ElectronLibre : `server/lib/desk/el/article-host.mjs` (`el_articles`).

## Exemple

```bash
node examples/pupitre-minimal/demo.mjs
```

## Ce qui reste hors package

- `server/lib/desk.mjs` — host HTTP CRUD EL
- `server/lib/desk/el/` — adapters produit
- `desk/` — SPA éditoriale
