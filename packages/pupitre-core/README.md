# @electronlibre/pupitre-core

Cœur CMS **Pupitre** (registry plugins, lifecycle, helpers articles).

## Statut (important)

Ce dossier est une **façade** dans le monorepo ElectronLibre.

- Le code source vit dans `../../server/lib/desk/core/`
- Ce n’est **pas** encore un package npm publiable autonome
- Les tables SQL utilisent encore le préfixe host `el_*`
- Le host EL reste `server/lib/desk.mjs` + `server/lib/desk/el/`

Objectif Phase 4 : extraire un vrai package installable. Aujourd’hui : frontière claire pour les dév qui lisent le repo.

## Surface exportée

```js
import {
  createPluginRegistry,
  emitDeskLifecycle,
  bumpContentGen,
  getContentGen,
  canEditArticle,
  nextArticleId,
  uniqueSlug,
  resolveArticleSlug,
} from '../../server/lib/desk/core/index.mjs';
```

## Licence

MIT — voir `LICENSE`.
