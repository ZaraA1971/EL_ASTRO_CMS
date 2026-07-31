# Exemple Pupitre minimal

Démo **exécutable** du slice core (registry, lifecycle, helpers injectés) — sans MySQL ni ElectronLibre.

```bash
# depuis la racine du monorepo
node examples/pupitre-minimal/demo.mjs
```

Sortie attendue : ligne `OK pupitre-minimal …` (exit 0).

Pour un vrai host : auth + CRUD SQL + SPA `desk/` + `createPluginRegistry([...])`.  
Chez ElectronLibre : `server/api.mjs` → `handleDesk` + `createElDeskRegistry()`.
