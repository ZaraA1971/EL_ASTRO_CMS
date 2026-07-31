# Exemple Pupitre minimal

Démo **exécutable** du slice core (registry, lifecycle, helpers injectés) — sans MySQL ni ElectronLibre.

```bash
# depuis la racine du monorepo
node examples/pupitre-minimal/demo.mjs
```

Sortie attendue : ligne `OK pupitre-minimal …` (exit 0).

Pour un vrai host : auth + `tryHandleCoreCrud` (articles/catégories) + SPA `desk/` + plugins.  
Chez ElectronLibre : `server/lib/desk.mjs` → auth/media/users puis `tryHandleCoreCrud`.
