# Pupitre — architecture & contrats

État au **2026-07-31** — phases 0–4 + extract CRUD (articles, catégories, médias, authors, users).  
Nettoyage pré–repo public fait ; **repo GitHub dédié / npm publish encore hors scope**.

## Décisions

| Sujet | Choix |
|-------|--------|
| Identité article | PK `article_id` (ex-`wp_id`, valeurs inchangées) |
| URLs | `/articles/{id}-{slug}/` inchangé |
| Open source | Slice MIT (`desk/core` + exemple) ; pas de repo séparé ni `npm publish` encore |
| Tables | Injectées par le host (`el_*` chez EL) |
| Mots de passe | Hash **uniquement** via `userPolicy.hashPassword` (EL = phpass `$P$`) |

## Layout

```
server/lib/desk/
  core/          # PORTABLE (OSS envisagé)
    plugin-registry, lifecycle, content-gen, article-helpers
    articles/ categories/ media/ authors/ users/  # CRUD HTTP
    crud.mjs     # tryHandleCoreCrud
  el/            # HORS OSS — adapters produit EL
desk/            # HORS OSS — SPA EL (marque via /me)
server/lib/
  desk.mjs       # host : auth, /me, câblage stores/policy/hooks
  users.mjs      # hash WP + elUserPolicy + hooks mails/newsletter
packages/pupitre-core/   # façade + LICENSE MIT + README
packages/pupitre-el/     # façade EL — ne pas publier
examples/pupitre-minimal/
```

## Core vs host EL

| Core | Host EL |
|------|---------|
| Registry, lifecycle, contentGen | `desk.mjs` auth + `/me` |
| `tryHandleCoreCrud` | Câble stores, `userPolicy`, `mediaFs`, hooks |
| Stores (tables injectées) | `hashUserPassword`, Brevo, newsletter, tokens reset |
| Aucun secret, aucun `wordpress-hash` | Plugins X / OneSignal / DeepL / RAG / front-cache |

## Caps UI

Onglets plugin **uniquement** si la cap est vraie (`newsletter`, `audience`, …).

Marque : `DESK_BRAND_*` → `GET /api/desk/me` → `state.brand`.

## Extract CRUD

1. Articles + catégories  
2. Médias (`busboy` peer)  
3. Authors + users — hash/mails restent EL  

## Avant repo public (checklist)

- [x] Core sans import host / secrets  
- [x] Tests sécurité `handleCoreUsers` (mocks)  
- [x] README périmètre + `pupitre-el` hors OSS  
- [ ] Copier/extraire `desk/core` + exemple + MIT dans un repo dédié  
- [ ] Ne pas inclure `.env`, `desk/el`, billing, SPA  

## Suite

1. Repo public `pupitre-core`  
2. Plugins UI assist / keywords / translate (optionnel)  
3. `npm publish` (lever `private`, sources dans le package)

## Ops prod EL

Relire [`CURSOR.md`](../CURSOR.md).

```bash
npm test
./scripts/deploy.sh api
curl -sI http://127.0.0.1:4322/
curl -sS http://127.0.0.1:8787/api/health
```
