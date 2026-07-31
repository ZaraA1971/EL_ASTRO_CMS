# Exemple Pupitre minimal

Démo **exécutable** du slice core (registry, lifecycle, helpers injectés) — sans MySQL ni ElectronLibre.

```bash
# depuis la racine du monorepo
node examples/pupitre-minimal/demo.mjs
```

Sortie attendue : `OK pupitre-minimal …` (exit 0).

Ne couvre pas encore `tryHandleCoreCrud` (nécessite pool SQL + policy).  
Chez ElectronLibre le host est `server/lib/desk.mjs` : auth → `/me` → plugins → `tryHandleCoreCrud`.
