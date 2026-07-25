/**
 * Navigation header EL — hamburger + sous-menus (vanilla, sans jQuery).
 */
(function () {
  'use strict';

  var MOBILE_MAX = 1200;

  function isMobileNav() {
    return window.matchMedia('(max-width: ' + MOBILE_MAX + 'px)').matches;
  }

  function getNav() {
    return document.getElementById('site-navigation');
  }

  function getToggle() {
    return document.querySelector('#site-navigation .menu-toggle');
  }

  function setNavOpen(open) {
    var nav = getNav();
    var toggle = getToggle();
    if (!nav || !toggle) {
      return;
    }

    nav.classList.toggle('toggled', open);
    toggle.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function closeAllSubmenus(except) {
    document.querySelectorAll('#site-navigation .menu-item-has-children.focus').forEach(function (item) {
      if (except && item === except) {
        return;
      }
      item.classList.remove('focus');
      item.setAttribute('aria-expanded', 'false');
    });
  }

  function toggleSubmenu(item) {
    var willOpen = !item.classList.contains('focus');
    closeAllSubmenus(item);
    item.classList.toggle('focus', willOpen);
    item.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  }

  function initMenuToggle() {
    var toggle = getToggle();
    if (!toggle) {
      return;
    }

    toggle.addEventListener('click', function () {
      var nav = getNav();
      if (!nav) {
        return;
      }
      setNavOpen(!nav.classList.contains('toggled'));
    });
  }

  function initSubmenus() {
    document.querySelectorAll('#site-navigation .menu-item-has-children').forEach(function (item) {
      item.setAttribute('aria-haspopup', 'true');
      item.setAttribute('aria-expanded', 'false');

      var link = item.querySelector(':scope > a');
      if (!link) {
        return;
      }

      link.addEventListener('click', function (event) {
        if (!isMobileNav()) {
          return;
        }

        if (!item.classList.contains('focus')) {
          event.preventDefault();
          toggleSubmenu(item);
        }
      });
    });
  }

  function initDocumentClose() {
    document.addEventListener('click', function (event) {
      var nav = getNav();
      if (!nav || nav.contains(event.target)) {
        return;
      }
      setNavOpen(false);
      closeAllSubmenus(null);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') {
        return;
      }
      setNavOpen(false);
      closeAllSubmenus(null);
    });
  }

  function initResize() {
    window.addEventListener('resize', function () {
      if (!isMobileNav()) {
        setNavOpen(false);
        closeAllSubmenus(null);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  function boot() {
    initMenuToggle();
    initSubmenus();
    initDocumentClose();
    initResize();
  }
})();
