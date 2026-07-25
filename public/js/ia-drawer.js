/**
 * EL Compagnon — tiroir IA (bouton + overlay).
 */
(function () {
  'use strict';

  if (window.__elDrawerInit) return;
  window.__elDrawerInit = true;

  var drawer = document.getElementById('ia-drawer');
  var overlay = document.getElementById('ia-drawer-overlay');
  var btn = document.getElementById('ia-drawer-toggle');
  if (!drawer || !btn || !overlay) return;

  var api = (window.IATools = window.IATools || {});

  function isOpen() {
    return drawer.classList.contains('is-open');
  }

  function setOpen(open) {
    open = !!open;
    drawer.classList.toggle('is-open', open);
    overlay.classList.toggle('is-open', open);
    overlay.setAttribute('aria-hidden', open ? 'false' : 'true');
    drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.setAttribute(
      'aria-label',
      open ? 'Fermer EL Compagnon' : 'Ouvrir EL Compagnon'
    );
    document.body.classList.toggle('ia-drawer-open', open);

    if (open && typeof api.restoreFromLocalStorage === 'function') {
      try {
        api.restoreFromLocalStorage();
      } catch (err) {
        /* ignore */
      }
    }
  }

  api.isDrawerOpen = isOpen;
  api.openDrawer = function () { setOpen(true); };
  api.closeDrawer = function () { setOpen(false); };
  api.toggleDrawer = function () { setOpen(!isOpen()); };

  // Toujours fermé au chargement (évite un tiroir ouvert par un ancien état / cache JS)
  setOpen(false);

  btn.addEventListener('click', function (event) {
    event.preventDefault();
    event.stopPropagation();
    api.toggleDrawer();
  });

  overlay.addEventListener('click', function () {
    api.closeDrawer();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && isOpen()) {
      api.closeDrawer();
    }
  });
})();
