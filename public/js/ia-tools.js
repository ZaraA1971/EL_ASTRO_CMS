const IATools = window.IATools || {};
window.IATools = IATools;

IATools.toggleSpinner = function (show, spinnerElement) {
  if (!spinnerElement) return;
  spinnerElement.classList.toggle('hidden', !show);
  spinnerElement.classList.toggle('visible', show);
};

IATools.cleanAIHTML = function (html) {
  if (typeof DOMPurify === 'undefined' || !DOMPurify || !DOMPurify.sanitize) {
    return String(html || '');
  }
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
      'sup',
    ],
    ALLOWED_ATTR: { a: ['href', 'title', 'target', 'rel', 'class'] },
  });
};

window.toggleSpinner = IATools.toggleSpinner;

const LS_KEY = 'el_compagnon_last_session';

IATools.getRoot = function () {
  return document.getElementById('el-compagnon');
};

IATools.findElement = function (sel) {
  const root = IATools.getRoot();
  return root ? root.querySelector(sel) : null;
};

/** @deprecated alias */
IATools.findDrawerElement = IATools.findElement;

IATools.restoreFromLocalStorage = function () {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY));
    if (!saved) return;

    const q = IATools.findElement('#question');
    if (q && saved.question) q.value = saved.question;

    const content = document.getElementById('el-compagnon-content');
    if (!content) return;

    if (saved.answerHTML) {
      let ansBox = content.querySelector('#final-answer');
      if (!ansBox) {
        ansBox = document.createElement('div');
        ansBox.id = 'final-answer';
        ansBox.classList.add('final-answer');
        content.appendChild(ansBox);
      }
      ansBox.innerHTML = saved.answerHTML;
      if (!ansBox.innerHTML.trim().startsWith('<')) {
        ansBox.innerHTML = `<p>${ansBox.innerHTML}</p>`;
      }
      ansBox.classList.add('final-answer');
    }

    if (saved.sourcesHTML) {
      const existing = content.querySelector('.rag-sources');
      if (existing) existing.remove();
      const temp = document.createElement('div');
      temp.innerHTML = saved.sourcesHTML;
      const sourcesEl = temp.firstElementChild;
      if (sourcesEl) {
        const finalBox = content.querySelector('#final-answer');
        if (finalBox && finalBox.parentNode) {
          finalBox.parentNode.insertBefore(sourcesEl, finalBox.nextSibling);
        } else {
          content.appendChild(sourcesEl);
        }
      }
    }

    const tools = document.getElementById('ia-tools-actions');
    if (tools && (saved.answerHTML || saved.sourcesHTML)) {
      tools.classList.remove('hidden');
    }
  } catch (e) {
    console.warn('LS restore error', e);
  }
};

IATools.persistToLocalStorage = function () {
  const question = (IATools.findElement('#question')?.value || '').trim();
  const answerHTML = IATools.findElement('#final-answer')?.innerHTML || '';
  const sourcesEl = IATools.findElement('.rag-sources');
  const sourcesHTML = sourcesEl ? sourcesEl.outerHTML : '';
  localStorage.setItem(LS_KEY, JSON.stringify({ question, answerHTML, sourcesHTML }));
};

IATools.getShareableAIResult = function () {
  let question = '';
  let answer = '';
  let sourcesText = '';

  const q = IATools.findElement('#question');
  if (q && q.value.trim() !== '') {
    question = q.value.trim();
  }

  const ans = document.querySelector('#el-compagnon #final-answer');
  const stream = document.querySelector('#el-compagnon #gpt-stream');
  if (ans && ans.innerText.trim()) {
    answer = ans.innerText.trim();
  } else if (stream && stream.innerText.trim()) {
    answer = stream.innerText.trim();
  }

  const sources = document.querySelectorAll('#el-compagnon .rag-sources li');
  if (sources.length > 0) {
    const list = [];
    sources.forEach((li) => {
      const link = li.querySelector('a');
      if (link) {
        list.push(`– ${link.textContent.trim()} — ${link.getAttribute('href')}`);
      } else {
        list.push(`– ${li.textContent.trim()}`);
      }
    });
    sourcesText = list.join('\n');
  }

  let result = '';
  if (question) result += 'Question :\n' + question + '\n\n';
  if (answer) result += 'Réponse EL Compagnon :\n' + answer + '\n\n';
  if (sourcesText) result += 'Sources :\n' + sourcesText + '\n';
  return result.trim();
};

IATools.getFinalAnswerText = function () {
  return IATools.getShareableAIResult();
};

document.addEventListener('click', (e) => {
  if (e.target.matches('#reset-question') || e.target.closest('#reset-question')) {
    const input = IATools.findElement('#question');
    if (input) {
      input.value = '';
      input.style.height = 'auto';
      input.focus();
    }
    const stream = document.getElementById('gpt-stream');
    if (stream) stream.innerHTML = '';
    const finalEl = document.getElementById('final-answer');
    if (finalEl) finalEl.innerHTML = '';
    const root = IATools.getRoot();
    if (root) {
      root.querySelectorAll('.rag-sources').forEach((el) => el.remove());
    }
    const tools = document.getElementById('ia-tools-actions');
    if (tools) tools.classList.add('hidden');
    localStorage.removeItem(LS_KEY);
    try {
      localStorage.removeItem('rag_answer');
    } catch (_) {
      /* ignore */
    }
    return;
  }

  const actionBtn = e.target.closest('[data-ia-action]');
  if (!actionBtn || !IATools.getRoot()?.contains(actionBtn)) return;

  const action = actionBtn.dataset.iaAction;
  const text = IATools.getFinalAnswerText();
  if (!text) return;

  if (action === 'copy') {
    navigator.clipboard.writeText(text);
  }
  if (action === 'email') {
    window.open(
      `mailto:?subject=Réponse EL Compagnon&body=${encodeURIComponent(text)}`,
      '_blank'
    );
  }
  if (action === 'share-x') {
    window.open(
      `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`,
      '_blank'
    );
  }

  IATools.persistToLocalStorage();
});

document.addEventListener('ai-answer-updated', () => {
  IATools.persistToLocalStorage();
});

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('el-compagnon')) {
    IATools.restoreFromLocalStorage();
  }
});

window.IATools = IATools;
