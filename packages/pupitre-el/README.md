# @electronlibre/pupitre-el

Adapters **ElectronLibre** pour Pupitre (hors core OSS).

## Contenu

- `article-host.mjs` — `createArticleHelpers({ tableName: 'el_articles', …rôles EL })`
- `el-plugins.mjs` — registre `DESK_PLUGINS`
- `plugins/*` — newsletter, audience, x, push, keywords, translate, assist, content-gen, front-cache
- `article-el.mjs` — jumeaux bilingues, auto-keywords RAG

## Statut

Façade monorepo → `../../server/lib/desk/el/`. Non publiée. Liée au produit EL.
