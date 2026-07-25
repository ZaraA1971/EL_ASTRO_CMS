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
        '<button type="button" id="el-logout-btn" class="icon-btn login-icon" aria-label="Déconnexion">' +
        '<div class="ia-header-icon-wrapper">' +
        '<img src="/icons/sf/logoutEL.svg" alt="" width="20" height="20">' +
        '<span class="ia-header-label">Déconnexion</span></div></button>';
      document.getElementById('el-logout-btn')?.addEventListener('click', async () => {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
        location.reload();
      });
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
    const wpId = root.getAttribute('data-wp-id');
    if (!wpId) return;

    if (!entitled) {
      return;
    }

    root.innerHTML = '<p class="el-home__sub">Chargement de l’article…</p>';
    try {
      const res = await fetch('/api/content/' + wpId, { credentials: 'same-origin' });
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
