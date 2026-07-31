/**
 * Session + paywall client + outils premium (dont RAG / Compagnon).
 * `entitled` = accès premium (abonné/staff actif non expiré).
 */
(function () {
  'use strict';

  let resolveAuthReady;
  if (!window.elAuthReady) {
    window.elAuthReady = new Promise((resolve) => {
      resolveAuthReady = resolve;
    });
  }

  async function fetchMe() {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!res.ok) return { authenticated: false, entitled: false };
      return await res.json();
    } catch {
      return { authenticated: false, entitled: false };
    }
  }

  function setSubscriberFlag(entitled, authenticated) {
    window.isSubscriber = !!entitled;
    window.elEntitled = !!entitled;
    window.elAuthenticated = !!authenticated;
  }

  function updateHeader(me) {
    const box = document.getElementById('el-login');
    if (!box) return;
    if (me.authenticated) {
      box.innerHTML =
        '<a href="/compte/" class="icon-btn login-icon" aria-label="Mon compte">' +
        '<div class="ia-header-icon-wrapper">' +
        '<img src="/icons/sf/loginEL.svg" alt="" width="20" height="20">' +
        '<span class="ia-header-label">Compte</span></div></a>';
    } else {
      const redirect = encodeURIComponent(location.pathname + location.search);
      box.innerHTML =
        '<a href="/login/?redirect=' +
        redirect +
        '" class="icon-btn login-icon" aria-label="Connexion">' +
        '<div class="ia-header-icon-wrapper">' +
        '<img src="/icons/sf/loginEL.svg" alt="" width="20" height="20">' +
        '<span class="ia-header-label">Connexion</span></div></a>';
    }
  }

  /** Cadenas : visibles seulement si non entitled */
  function updateLockIcons(entitled) {
    document.querySelectorAll('.el-sub-lock').forEach((el) => {
      el.hidden = !!entitled;
    });
  }

  /**
   * Accès outil premium : entitled → true ;
   * sinon redirection login (anonyme) ou abonnement (connecté non abonné).
   */
  window.elRequirePremium = function elRequirePremium() {
    if (window.elEntitled) return true;
    const redirect = encodeURIComponent(location.pathname + location.search);
    if (window.elAuthenticated) {
      location.href = '/abonnement/';
    } else {
      location.href = '/login/?redirect=' + redirect;
    }
    return false;
  };

  async function hydratePaywall(entitled) {
    const root = document.getElementById('el-paywall-root');
    if (!root) return;
    const articleId = root.getAttribute('data-article-id');
    if (!articleId) return;

    if (!entitled) {
      return;
    }

    root.innerHTML = '<p class="el-home__sub">Chargement de l’article…</p>';
    try {
      const res = await fetch('/api/content/' + articleId, { credentials: 'same-origin' });
      const data = await res.json();
      if (!res.ok) {
        root.innerHTML =
          '<div class="el-paywall"><p>' +
          (data.error || 'Accès refusé') +
          '</p></div>';
        return;
      }
      const raw = String(data.html || '');
      const safe =
        typeof DOMPurify !== 'undefined'
          ? DOMPurify.sanitize(raw, {
              ADD_ATTR: ['target', 'rel'],
            })
          : raw;
      root.innerHTML = '<div class="el-article__body entry-content">' + safe + '</div>';
    } catch {
      root.innerHTML = '<div class="el-paywall"><p>Erreur de chargement.</p></div>';
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const me = await fetchMe();
    const authenticated = !!me.authenticated;
    const entitled = !!(me.entitled ?? (authenticated && me.user?.entitled));
    setSubscriberFlag(entitled, authenticated);
    updateHeader(me);
    updateLockIcons(entitled);
    await hydratePaywall(entitled);
    if (typeof resolveAuthReady === 'function') resolveAuthReady(me);
  });
})();
