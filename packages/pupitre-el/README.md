# @electronlibre/pupitre-el

Adapters **ElectronLibre** pour Pupitre (plugins + helpers RAG/jumeaux).

## Contenu

- `el-plugins.mjs` — registre préconfiguré (`DESK_PLUGINS`)
- `plugins/*` — newsletter, audience, x, push, keywords, translate, assist, content-gen, front-cache
- `article-el.mjs` — sync mots-clés jumeau, auto-keywords RAG

## Statut

Façade monorepo → `../../server/lib/desk/el/`. Non publiée sur npm.
Reste liée au produit EL (Brevo, OneSignal, GoatCounter, DeepL, marque).
