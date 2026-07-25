/**
 * EL Compagnon — ouverture / fermeture du panneau Outils (home).
 */
(function () {
  'use strict';

  if (window.__elCompagnonPanelInit) return;
  window.__elCompagnonPanelInit = true;

  var root = document.getElementById('el-compagnon');
  if (!root) return;

  var toggle = document.getElementById('el-compagnon-toggle');
  var content = document.getElementById('el-compagnon-content');
  var cta = root.querySelector('[data-compagnon-cta]');
  var isEn = String(window.currentLanguage || 'FR').toUpperCase() === 'EN';
  var labelOpen = isEn ? 'Open EL Compagnon' : 'Ouvrir EL Compagnon';
  var labelClose = isEn ? 'Close EL Compagnon' : 'Fermer EL Compagnon';

  function isOpen() {
    return root.classList.contains('is-open');
  }

  function setCta(open) {
    if (!cta) return;
    cta.innerHTML =
      (open ? labelClose : labelOpen) +
      ' <span aria-hidden="true">' +
      (open ? '×' : '→') +
      '</span>';
  }

  function setOpen(open) {
    open = !!open;
    root.classList.toggle('is-open', open);
    root.setAttribute('data-open', open ? 'true' : 'false');
    if (content) {
      content.hidden = !open;
      content.setAttribute('aria-hidden', open ? 'false' : 'true');
    }
    if (toggle) {
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    setCta(open);
    if (open) {
      var q = document.getElementById('question');
      if (q) {
        try {
          q.focus({ preventScroll: true });
        } catch (_) {
          q.focus();
        }
      }
      if (typeof root.scrollIntoView === 'function') {
        root.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  function openPanel() {
    var ready = window.elAuthReady;
    var go = function () {
      if (typeof window.elRequirePremium === 'function' && !window.elRequirePremium()) {
        return;
      }
      setOpen(true);
    };
    if (ready && typeof ready.then === 'function') {
      ready.then(go);
      return;
    }
    go();
  }

  function closePanel() {
    setOpen(false);
  }

  function togglePanel() {
    if (isOpen()) closePanel();
    else openPanel();
  }

  window.ELCompagnon = {
    open: openPanel,
    close: closePanel,
    toggle: togglePanel,
    isOpen: isOpen,
  };

  setOpen(false);

  if (toggle) {
    toggle.addEventListener('click', function (e) {
      e.preventDefault();
      togglePanel();
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen()) {
      closePanel();
    }
  });
})();
