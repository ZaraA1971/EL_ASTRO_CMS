/**
 * Dialogues pupitre — source unique (confirm / alert / prompt).
 *
 * API principale : deskDialog(message, context, opts?)
 *   context = 'confirm' | 'alert' | 'prompt'
 *
 * Raccourcis : deskConfirm · deskAlert · deskPrompt
 */
import { escapeHtml } from './escape-html.mjs';

/** Libellés et comportement par type de dialogue. */
export const DIALOG_CONTEXTS = {
  confirm: {
    primaryLabel: 'Confirmer',
    cancelLabel: 'Annuler',
    showCancel: true,
    showInput: false,
  },
  alert: {
    primaryLabel: 'OK',
    cancelLabel: 'Annuler',
    showCancel: false,
    showInput: false,
  },
  prompt: {
    primaryLabel: 'Valider',
    cancelLabel: 'Annuler',
    showCancel: true,
    showInput: true,
  },
};

const HOST_ID = 'desk-dialog-host';
const Z_INDEX = 90;

/** @type {Promise<unknown>} */
let queue = Promise.resolve();

/**
 * @param {string} message
 * @param {'confirm'|'alert'|'prompt'|string} [context='confirm']
 * @param {{
 *   title?: string,
 *   confirmLabel?: string,
 *   cancelLabel?: string,
 *   danger?: boolean,
 *   defaultValue?: string,
 *   placeholder?: string,
 *   inputLabel?: string,
 * }} [opts]
 * @returns {Promise<boolean|string|null|void>}
 */
export function deskDialog(message, context = 'confirm', opts = {}) {
  const key = String(context || 'confirm').toLowerCase();
  const rules = DIALOG_CONTEXTS[key];
  if (!rules) {
    throw new Error(
      `deskDialog: contexte inconnu "${key}" (attendu: ${Object.keys(DIALOG_CONTEXTS).join(', ')})`
    );
  }
  const run = () =>
    new Promise((resolve) => {
      if (typeof document === 'undefined') {
        resolve(key === 'prompt' ? null : key === 'alert' ? undefined : false);
        return;
      }
      const host = ensureHost();
      const title = String(opts.title || '').trim();
      const primaryLabel = opts.confirmLabel || rules.primaryLabel;
      const cancelLabel = opts.cancelLabel || rules.cancelLabel;
      const danger = Boolean(opts.danger);
      const showInput = Boolean(rules.showInput);
      const inputLabel = String(opts.inputLabel || '').trim();
      const placeholder = String(opts.placeholder || '').trim();
      const defaultValue = opts.defaultValue != null ? String(opts.defaultValue) : '';

      host.innerHTML = `
        <div class="desk-dialog" role="presentation">
          <button type="button" class="desk-dialog__backdrop" data-desk-dialog-cancel aria-label="Fermer"></button>
          <div class="desk-dialog__panel" role="dialog" aria-modal="true"${
            title ? ' aria-labelledby="desk-dialog-title"' : ' aria-label="Dialogue"'
          }${showInput ? ' aria-describedby="desk-dialog-message"' : ''}>
            ${title ? `<h2 class="desk-dialog__title" id="desk-dialog-title">${escapeHtml(title)}</h2>` : ''}
            <div class="desk-dialog__message" id="desk-dialog-message">${escapeHtml(String(message || ''))}</div>
            ${
              showInput
                ? `<label class="desk-dialog__field">
                    ${inputLabel ? `<span class="desk-dialog__label">${escapeHtml(inputLabel)}</span>` : ''}
                    <input class="desk-dialog__input" type="text" id="desk-dialog-input" value="${escapeHtml(defaultValue)}"${
                      placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : ''
                    } autocomplete="off" />
                  </label>`
                : ''
            }
            <div class="desk-dialog__actions">
              ${
                rules.showCancel
                  ? `<button type="button" class="btn btn-ghost" data-desk-dialog-cancel>${escapeHtml(cancelLabel)}</button>`
                  : ''
              }
              <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-desk-dialog-confirm>${escapeHtml(primaryLabel)}</button>
            </div>
          </div>
        </div>`;

      host.hidden = false;
      document.body.classList.add('desk-dialog-open');

      const panel = host.querySelector('.desk-dialog__panel');
      const input = host.querySelector('#desk-dialog-input');
      const confirmBtn = host.querySelector('[data-desk-dialog-confirm]');
      const cancelBtns = host.querySelectorAll('[data-desk-dialog-cancel]');

      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKeyDown, true);
        host.hidden = true;
        host.innerHTML = '';
        document.body.classList.remove('desk-dialog-open');
        resolve(value);
      };

      const onKeyDown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          finish(key === 'prompt' ? null : key === 'alert' ? undefined : false);
          return;
        }
        if (e.key === 'Enter' && showInput && document.activeElement === input) {
          e.preventDefault();
          finish(input.value);
        }
      };

      confirmBtn?.addEventListener('click', () => {
        finish(showInput ? input?.value ?? '' : true);
      });
      cancelBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          finish(key === 'prompt' ? null : key === 'alert' ? undefined : false);
        });
      });

      document.addEventListener('keydown', onKeyDown, true);
      if (showInput && input) {
        input.focus();
        input.select();
      } else {
        confirmBtn?.focus();
      }
      panel?.scrollIntoView({ block: 'nearest' });
    });

  const next = queue.then(run);
  queue = next.catch(() => {});
  return next;
}

/** @param {string} message @param {Parameters<typeof deskDialog>[2]} [opts] */
export function deskConfirm(message, opts) {
  return deskDialog(message, 'confirm', opts).then(Boolean);
}

/** @param {string} message @param {Parameters<typeof deskDialog>[2]} [opts] */
export function deskAlert(message, opts) {
  return deskDialog(message, 'alert', opts);
}

/** @param {string} message @param {Parameters<typeof deskDialog>[2]} [opts] */
export function deskPrompt(message, opts) {
  return deskDialog(message, 'prompt', opts);
}

function ensureHost() {
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    host.hidden = true;
    document.body.appendChild(host);
  }
  return host;
}
