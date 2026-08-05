/**
 * Session + paywall client + outils premium (dont RAG / Compagnon).
 *
 * Contrat unique :
 *   authenticated — cookie session valide
 *   entitled      — accès premium (abonné/staff) ; alias window.isSubscriber
 *
 * Source de vérité droits = API (/api/auth/me, /api/content) → MySQL.
 * Le cookie ne sert qu’à l’identité ; jamais pour autoriser côté client.
 *
 * Événement `el:access` (+ BroadcastChannel `el-access`) quand les droits changent.
 */
(function () {
  'use strict';

  var CHANNEL = 'el-access';
  var FOCUS_THROTTLE_MS = 2000;

  var resolveAuthReady;
  var authReadySettled = false;
  if (!window.elAuthReady) {
    window.elAuthReady = new Promise(function (resolve) {
      resolveAuthReady = resolve;
    });
  }

  var state = {
    authenticated: false,
    entitled: false,
    accessRev: null,
    user: null,
  };
  var meInFlight = null;
  var contentInFlight = null;
  var lastFocusCheck = 0;
  var bootStarted = false;

  function normalizeMe(me) {
    var authenticated = !!(me && me.authenticated);
    var entitled = !!(
      me &&
      (me.entitled === true ||
        (authenticated && me.user && me.user.entitled === true))
    );
    var accessRev =
      me && me.accessRev != null
        ? me.accessRev
        : me && me.user && me.user.accessRev != null
          ? me.user.accessRev
          : null;
    return {
      authenticated: authenticated,
      entitled: entitled,
      accessRev: accessRev,
      user: (me && me.user) || null,
      raw: me || { authenticated: false, entitled: false },
    };
  }

  function applyAccess(next, opts) {
    var emit = !opts || opts.emit !== false;
    var prevAuth = state.authenticated;
    var prevEnt = state.entitled;
    var prevRev = state.accessRev;
    state = {
      authenticated: !!next.authenticated,
      entitled: !!next.entitled,
      accessRev: next.accessRev != null ? next.accessRev : null,
      user: next.user || null,
    };
    window.isSubscriber = state.entitled;
    window.elEntitled = state.entitled;
    window.elAuthenticated = state.authenticated;
    window.elAccess = {
      authenticated: state.authenticated,
      entitled: state.entitled,
      accessRev: state.accessRev,
      user: state.user,
    };
    var changed =
      prevAuth !== state.authenticated ||
      prevEnt !== state.entitled ||
      prevRev !== state.accessRev;
    if (emit && changed) {
      var detail = {
        authenticated: state.authenticated,
        entitled: state.entitled,
        accessRev: state.accessRev,
      };
      try {
        window.dispatchEvent(new CustomEvent('el:access', { detail: detail }));
      } catch (_) {
        /* ignore */
      }
      try {
        if (typeof BroadcastChannel !== 'undefined') {
          var bc = new BroadcastChannel(CHANNEL);
          bc.postMessage({ type: 'access', detail: detail });
          bc.close();
        }
      } catch (_) {
        /* ignore */
      }
    }
    return changed;
  }

  async function fetchMe() {
    try {
      var res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!res.ok) return { authenticated: false, entitled: false };
      return await res.json();
    } catch (_) {
      return { authenticated: false, entitled: false };
    }
  }

  function updateHeader(me) {
    var box = document.getElementById('el-login');
    if (!box) return;
    if (me && me.authenticated) {
      box.innerHTML =
        '<a href="/compte/" class="icon-btn login-icon" aria-label="Mon compte">' +
        '<div class="ia-header-icon-wrapper">' +
        '<img src="/icons/sf/loginEL.svg" alt="" width="20" height="20">' +
        '<span class="ia-header-label">Compte</span></div></a>';
    } else {
      var redirect = encodeURIComponent(location.pathname + location.search);
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
    document.querySelectorAll('.el-sub-lock').forEach(function (el) {
      el.hidden = !!entitled;
    });
  }

  /**
   * Accès outil premium : entitled → true ;
   * sinon redirection login (anonyme) ou abonnement (connecté non abonné).
   */
  window.elRequirePremium = function elRequirePremium() {
    if (window.elEntitled) return true;
    var redirect = encodeURIComponent(location.pathname + location.search);
    if (window.elAuthenticated) {
      location.href = '/abonnement/';
    } else {
      location.href = '/login/?redirect=' + redirect;
    }
    return false;
  };

  /**
   * Revalide /me (focus, login, billing). Résout aussi elAuthReady au premier passage.
   */
  window.elRefreshAccess = function elRefreshAccess() {
    return refreshAccess({ reason: 'manual' });
  };

  /** Signal inter-onglets après login/logout (pages sans attendre le cycle focus). */
  window.elNotifyAccessChanged = function elNotifyAccessChanged() {
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        var bc = new BroadcastChannel(CHANNEL);
        bc.postMessage({ type: 'invalidate' });
        bc.close();
      }
    } catch (_) {
      /* ignore */
    }
  };

  /**
   * Tente le corps paywall sans attendre /me.
   * Fetch silencieux : le teaser SSR reste jusqu’au 200.
   */
  async function tryHydratePaywall() {
    var root = document.getElementById('el-paywall-root');
    if (!root) return { ok: false, skipped: true };
    if (root.querySelector('.el-article__body')) {
      return { ok: true, already: true };
    }
    var articleId = root.getAttribute('data-article-id');
    if (!articleId) return { ok: false, skipped: true };
    if (contentInFlight) return contentInFlight;

    contentInFlight = (async function () {
      try {
        var res = await fetch('/api/content/' + articleId, {
          credentials: 'same-origin',
        });
        var data = {};
        try {
          data = await res.json();
        } catch (_) {
          data = {};
        }
        if (!res.ok) {
          return { ok: false, status: res.status };
        }
        var raw = String(data.html || '');
        var safe =
          typeof DOMPurify !== 'undefined'
            ? DOMPurify.sanitize(raw, { ADD_ATTR: ['target', 'rel'] })
            : raw;
        root.innerHTML =
          '<div class="el-article__body entry-content">' + safe + '</div>';
        if (!state.entitled) {
          applyAccess(
            {
              authenticated: true,
              entitled: true,
              accessRev: state.accessRev,
              user: state.user,
            },
            { emit: true }
          );
          updateLockIcons(true);
        }
        return { ok: true };
      } catch (_) {
        return { ok: false, error: true };
      } finally {
        contentInFlight = null;
      }
    })();
    return contentInFlight;
  }

  function restorePaywallTeaserIfNeeded() {
    var root = document.getElementById('el-paywall-root');
    if (!root) return;
    if (!root.querySelector('.el-article__body')) return;
    // Corps injecté alors que les droits ont disparu → recharger le teaser SSR.
    location.reload();
  }

  async function refreshAccess(opts) {
    opts = opts || {};
    if (meInFlight) return meInFlight;
    meInFlight = (async function () {
      var me = await fetchMe();
      var next = normalizeMe(me);
      var changed = applyAccess(next);
      updateHeader(next.raw);
      updateLockIcons(next.entitled);
      if (next.entitled) {
        await tryHydratePaywall();
      } else if (changed && opts.reason !== 'boot') {
        restorePaywallTeaserIfNeeded();
      }
      if (!authReadySettled && typeof resolveAuthReady === 'function') {
        authReadySettled = true;
        resolveAuthReady(next.raw);
      }
      return next;
    })();
    try {
      return await meInFlight;
    } finally {
      meInFlight = null;
    }
  }

  function onFocusRevalidate() {
    if (document.visibilityState && document.visibilityState !== 'visible') {
      return;
    }
    var now = Date.now();
    if (now - lastFocusCheck < FOCUS_THROTTLE_MS) return;
    lastFocusCheck = now;
    refreshAccess({ reason: 'focus' });
  }

  function boot() {
    if (bootStarted) return;
    bootStarted = true;
    // Parallèle : content (si paywall) + /me (chrome).
    tryHydratePaywall();
    refreshAccess({ reason: 'boot' });
  }

  document.addEventListener('visibilitychange', onFocusRevalidate);
  window.addEventListener('focus', onFocusRevalidate);

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      var listener = new BroadcastChannel(CHANNEL);
      listener.onmessage = function (ev) {
        var msg = ev && ev.data;
        if (!msg) return;
        if (msg.type === 'invalidate' || msg.type === 'access') {
          refreshAccess({ reason: 'broadcast' });
        }
      };
    }
  } catch (_) {
    /* ignore */
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
