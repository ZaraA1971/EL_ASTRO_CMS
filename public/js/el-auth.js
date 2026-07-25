/**
 * Session + paywall client + Compagnon.
 * `entitled` = accès premium (abonné/staff actif non expiré).
 */
(function () {
  'use strict';

  async function fetchMe() {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!res.ok) return { authenticated: false, entitled: false };
      return await res.json();
    } catch {
      return { authenticated: false, entitled: false };
    }
  }

  function setSubscriberFlag(entitled) {
    window.isSubscriber = !!entitled;
    window.elEntitled = !!entitled;
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

  function lockCompagnonIfNeeded(entitled) {
    if (entitled) return;
    const container = document.querySelector('.ia-drawer-content');
    if (!container || container.querySelector('.ia-locked')) return;
    if (!container.querySelector('#gpt4o-rag-form')) return;
    container.innerHTML =
      '<div class="ia-locked">' +
      '<p>🔒 Accès réservé aux abonnés ElectronLibre.</p>' +
      '<a href="/login/?redirect=' +
      encodeURIComponent(location.pathname) +
      '" class="btn-subscribe">Connexion</a>' +
      '<a href="/abonnement/" class="btn-subscribe" style="margin-left:8px">Je m’abonne</a>' +
      '</div>';
  }

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
    const entitled = !!(me.entitled ?? (me.authenticated && me.user?.entitled));
    setSubscriberFlag(entitled);
    updateHeader(me);
    updateLockIcons(entitled);
    lockCompagnonIfNeeded(entitled);
    await hydratePaywall(entitled);
  });
})();
