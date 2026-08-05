# Auth iOS — JWT & droits abonné

Surface unique : `/api/ios/v1/*` (Bearer JWT HS256).

## Contrat

| Champ | Où | Rôle |
|-------|-----|------|
| `data.user.id` | JWT | Identité |
| `isSubscriber` | JWT | **Hint UI** à l’émission / refresh — toujours `true` \| `false`, jamais omis |
| `entitled` / `isSubscriber` | `GET /auth/me` | Droits **live** MySQL (`canAccessPremium`) |

Règle unique : `entitled === isSubscriber === canAccessPremium(user)`.

Les gates serveur (corps articles, RAG) **ne font pas confiance** au claim JWT : elles relisent `el_users` à chaque requête.

## Émission

- `POST /auth/token` — login → JWT avec `isSubscriber` recalculé
- `POST /auth/refresh` — Bearer actuel → nouveau JWT, `isSubscriber` recalculé (Pupitre courant)
- Enveloppe inchangée : `{ "success": true, "data": { "token": "…" } }`

## Obligations app (propagation)

Le claim peut devenir faux si Pupitre / Stripe change le compte pendant la durée de vie du JWT (TTL défaut 30 j).

L’app **doit** appeler `POST /auth/refresh` :

1. Au **foreground** (retour app active)
2. Après **achat / restauration** d’abonnement
3. Après une réponse **403** contenu ou RAG
4. Avant d’afficher durablement un état UI basé sur `isSubscriber`

Puis remplacer le token stocké et aligner l’UI sur le nouveau claim (ou sur `GET /auth/me`).

`GET /auth/me` : `entitled` + `isSubscriber` (alias, même valeur).

## Champs articles (≠ token)

| Champ | Sens |
|-------|------|
| `isPublic` | Article gratuit (`access=granted`) — indépendant du JWT |
| `content` / excerpt | Vides si paywall et utilisateur non `entitled` |

## Universal Links (AASA)

Fichier : [`public/.well-known/apple-app-site-association`](../public/.well-known/apple-app-site-association)  
URL : `https://electronlibre.info/.well-known/apple-app-site-association`  
AppID : `LFR8RH8A7L.EL-Studio.ElectronLibre-Lecteur`.

## Cache

Bypass CF sur `/api/` (prod). Origin : `no-store` + `Vary: Authorization`.

## Ne pas faire

- Cacher `isSubscriber` plusieurs jours sans revalidation
- Autoriser le contenu premium uniquement depuis le claim JWT (le serveur refuse déjà si DB = non)
