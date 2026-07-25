/**
 * Mots-clés IA — charge le corps via /api/content (entitled), jamais depuis le HTML public.
 */
(function () {
  'use strict';

  const cache = new Map();

  function cleanAIHTML(html) {
    if (typeof DOMPurify === 'undefined') return String(html || '');
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [
        'p',
        'ul',
        'ol',
        'li',
        'strong',
        'em',
        'br',
        'a',
        'blockquote',
        'code',
        'pre',
        'h3',
        'h4',
      ],
      ALLOWED_ATTR: { a: ['href', 'title', 'target', 'rel'] },
    });
  }

  function toB64(str) {
    try {
      return btoa(unescape(encodeURIComponent(str)));
    } catch {
      return '';
    }
  }

  function ensureDefBox(listEl) {
    let box = document.getElementById('ai-definition-container');
    if (box) return box;
    box = document.createElement('div');
    box.id = 'ai-definition-container';
    box.className = 'el-ia-definition';
    box.setAttribute('aria-live', 'polite');
    listEl.parentElement?.appendChild(box);
    return box;
  }

  async function loadArticleHtml(wpId) {
    if (cache.has(wpId)) return cache.get(wpId);
    const res = await fetch('/api/content/' + wpId, { credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Accès article refusé');
      err.status = res.status;
      throw err;
    }
    const html = String(data.html || '');
    cache.set(wpId, html);
    return html;
  }

  async function fetchDefinition(keyword, articleHtml) {
    const res = await fetch('/api/rag/simple', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        question: keyword,
        article_b64: toB64(articleHtml),
        mode: 'definition',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erreur définition');
    return data?.answer || 'Définition indisponible.';
  }

  async function onKeywordClick(btn, listEl) {
    const keyword = btn.getAttribute('data-keyword') || btn.textContent?.trim();
    const wpId = listEl.getAttribute('data-wp-id');
    const defBox = ensureDefBox(listEl);
    if (!keyword || !wpId) return;

    defBox.innerHTML = '<p><em>Chargement…</em></p>';
    try {
      const articleHtml = await loadArticleHtml(wpId);
      const sessionKey = 'definition_' + wpId + '_' + keyword;
      const cached = sessionStorage.getItem(sessionKey);
      if (cached) {
        defBox.innerHTML = cleanAIHTML(cached);
        return;
      }
      const answer = await fetchDefinition(keyword, articleHtml);
      sessionStorage.setItem(sessionKey, answer);
      defBox.innerHTML = cleanAIHTML(answer);
    } catch (e) {
      if (e.status === 401) {
        defBox.innerHTML =
          '<p>Connexion abonné requise pour les définitions.</p>' +
          '<p><a class="btn-subscribe" href="/login/?redirect=' +
          encodeURIComponent(location.pathname) +
          '">Connexion</a></p>';
        return;
      }
      defBox.innerHTML = '<p>Erreur lors de la définition.</p>';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const list = document.querySelector('.el-ia-keywords[data-wp-id]');
    if (!list || list.dataset.bound) return;
    list.dataset.bound = '1';
    list.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.el-ia-keyword, .keyword-item, [data-keyword]');
      if (!btn || !list.contains(btn)) return;
      onKeywordClick(btn, list);
    });
  });
})();
