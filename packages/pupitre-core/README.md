# @electronlibre/pupitre-core

Cœur portable **Pupitre** — registry de plugins, hooks de cycle de vie, CRUD HTTP injectable (articles, catégories, médias, authors, users).

Licence **MIT** — voir [`LICENSE`](./LICENSE).

## Statut (lire avant toute extraction)

Façade dans le monorepo ElectronLibre (`private: true`).

| Oui | Non |
|-----|-----|
| Sources sous [`server/lib/desk/core/`](../../server/lib/desk/core/) | Hash mots de passe, mails, newsletter |
| Aucun import host (`roles`, `keywords`, `wordpress-hash`, Brevo…) | UI SPA `desk/`, adapters `desk/el/` |
| CRUD via `tryHandleCoreCrud` + stores injectés | Secrets / `.env` / billing Stripe |
| Publié sur npm : [`@electronlibre/pupitre-core`](https://www.npmjs.com/package/@electronlibre/pupitre-core) | |

**Repo public :** [github.com/ZaraA1971/pupitre-core](https://github.com/ZaraA1971/pupitre-core)  
**Install :** `npm install @electronlibre/pupitre-core busboy`

**Ne jamais publier** `desk/el/`, `server/lib/users.mjs` (hooks Brevo), ni le monorepo entier.

Dépendance runtime médias : peer `busboy` (déclarée ici ; fournie par le monorepo).

Doc : [`docs/pupitre-core.md`](../../docs/pupitre-core.md).

## Install (monorepo)

```js
import {
  createPluginRegistry,
  emitDeskLifecycle,
  createArticleHelpers,
  tryHandleCoreCrud,
} from '../../server/lib/desk/core/index.mjs';
```

## Surface

| Export | Rôle |
|--------|------|
| `createPluginRegistry` / `resolveEnabledPluginIds` | Plugins, caps, routes, hooks |
| `emitDeskLifecycle` | bump `contentGen` + hooks |
| `bumpContentGen` / `getContentGen` | Génération de cache |
| `createArticleHelpers({ tableName, canAccessDesk, canEditAll })` | Helpers articles |
| `createCategoriesStore` / `handleCoreCategories` | Rubriques |
| `createMediaStore` / `handleCoreMedia` | Médiathèque (`ctx.mediaFs`, peer `busboy`) |
| `handleCoreAuthors` | Autocomplete auteurs |
| `createUsersStore` / `handleCoreUsers` | Comptes (`ctx.userPolicy` + hooks) |
| `tryHandleCoreCrud` | Toutes les routes CRUD ci-dessus |
| `slugify`, `asJson`, `nowMysql`, `toMysqlDate`, `PLACEHOLDER_SLUGS` | Utils purs |

### Users — contrat de sécurité

Le host **doit** fournir `userPolicy.hashPassword` (chez EL : phpass WordPress `$P$`).  
Le core refuse de démarrer sans policy complète.  
Side-effects (mails, newsletter, tokens reset) = `afterUserCreate` / `afterUserDelete` uniquement.  
Colonnes `wp_role` / `newsletter_opt_in` = schéma CMS opinionné, pas un import WordPress.

## Exemple

```bash
node examples/pupitre-minimal/demo.mjs
```

## Hors package

- `server/lib/desk.mjs` — host auth / `/me` / câblage EL
- `server/lib/desk/el/` — adapters produit
- `desk/` — SPA éditoriale ElectronLibre
