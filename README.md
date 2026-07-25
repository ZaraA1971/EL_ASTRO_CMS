# ElectronLibre — front Astro (prod)

**Site** : https://electronlibre.info  
**Pupitre** : https://electronlibre.info/desk/  
WordPress **gelé** (plus utilisé pour le runtime).

| Ressource | Emplacement |
|-----------|-------------|
| Médias | `/var/www/el-media/uploads` → URL `/wp-content/uploads/` |
| Articles / comptes | MySQL `el_articles` / `el_users` |
| RAG | indexe `el_articles` (FAISS IDs = `wp_id`) |
| Backup BDD | `/var/backups/electronlibre-db/` (glissant 7j, cron 22:00) |
| Code WP archivé | `/var/backups/electronlibre-astro/wordpress-code-frozen-*.tar.gz` |

## Accès

| Surface | URL |
|---------|-----|
| Site | https://electronlibre.info/ |
| Login | `/login/` · oublié `/login/forgot/` · reset `/login/reset/` |
| Abonnement | `/abonnement/` |
| Pupitre | https://electronlibre.info/desk/ |

Rôles : `admin` / `editor` · `author` · `subscriber` · `other`.  
**Publier = immédiat** (MySQL) — pas de rebuild Astro à chaque article.

## Architecture

| Service | Rôle |
|---------|------|
| `el-astro-web.service` | Astro Node SSR `:4322` |
| `el-astro-rag-proxy.service` | API `:8787` (auth, content, desk, newsletter, RAG proxy) |
| `rag.service` | RAG upstream `:8080` — cron index `el_articles` 03:00 |
| MySQL `el_*` | Source de vérité Astro |
| Médias | nginx → `/var/www/el-media/uploads` |

Env : `/etc/electronlibre/el-astro-api.env` (**jamais** dans git).

## Comptes

Gérés au pupitre uniquement. Sync WP **off** (`EL_SYNC_USERS_FORCE=1` pour un import one-shot historique).

## Auth / API

- Auth : `/api/auth/*` (login, logout, me, forgot, reset)
- Contenu abonné : `/api/content/:wpId`
- Desk : `/api/desk/*`
- Compagnon : `/api/rag/askWeb` (entitled)

## Sitemaps / SEO

- `/wp-sitemap.xml` (+ chunks posts)
- `/news-sitemap.xml` · `/news-sitemap.xml.php`
- GA4 : `G-Q3W21V1KB5`

## Ops

```bash
cd /var/www/el-astro
npm test
npm run build
sudo systemctl restart el-astro-web.service el-astro-rag-proxy.service
sudo find /var/cache/nginx/el-astro-prod -type f -delete
```

OneSignal : `ONESIGNAL_DRY_RUN=1` jusqu’au premier push contrôlé.

Archive MD d’import : backup `/var/backups/electronlibre-astro/articles-md-import-*.tar.gz` (hors live).

Health : `GET /api/health` · RAG `GET http://127.0.0.1:8080/health/index`

## Hors scope

`rag` / `dash` / `désinfo` code métier · secrets `/etc/electronlibre/*` · drop tables `eaxgw_*` (legacy, encore en BDD).
