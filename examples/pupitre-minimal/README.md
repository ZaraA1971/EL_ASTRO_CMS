# Esquisse — host Pupitre minimal

Exemple **documentaire** (pas un serveur prêt à lancer). Montre comment un host externe brancherait le core sans plugins EL.

```js
import {
  createPluginRegistry,
  emitDeskLifecycle,
} from '../../server/lib/desk/core/index.mjs';

// Core seul : pas de newsletter / X / push
const plugins = createPluginRegistry([]);

// Après publish article :
await emitDeskLifecycle(plugins, 'onPublish', { article }, ctx);

// Caps renvoyées à l’UI (sans plugins) :
const capabilities = plugins.mergeCaps(
  {
    editAll: true,
    create: true,
    publish: true,
    manageUsers: true,
    media: true,
    mediaDelete: true,
  },
  ctx,
  session
);
// → pas de newsletter / audience / onesignal / xPost
```

Pour un vrai host :

1. Auth session + rôles
2. Routes CRUD articles / médias / users (voir `server/lib/desk.mjs`)
3. SPA `desk/` pointant vers cette API
4. Plugins optionnels via `createPluginRegistry([...])`

Chez ElectronLibre, le host est `server/api.mjs` → `handleDesk(..., deskCtx)` avec `createElDeskRegistry()`.
