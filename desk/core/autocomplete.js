import { state } from "./state.js";
import { escapeHtml } from "./format.js";

export function debounceSearch(key, fn, waitMs = 220) {
  clearTimeout(state._searchTimers[key]);
  state._searchTimers[key] = setTimeout(fn, waitMs);
}

/**
 * Dropdown suggestions partagé (liste articles, comptes, champs…).
 * mapItem → { title, sub?, attrs? } (attrs = data-* additionnels)
 */
export function suggestDropdownHtml(id, items, activeIndex, mapItem, { limit = 8 } = {}) {
  if (!items?.length) return "";
  const rows = items.slice(0, limit).map((item, i) => {
    const m = mapItem(item, i) || {};
    const active = i === activeIndex ? " is-active" : "";
    return `<button type="button" class="search-suggest__item${active}" ${m.attrs || ""} role="option" aria-selected="${
      i === activeIndex ? "true" : "false"
    }">
      <strong>${escapeHtml(m.title || "")}</strong>
      ${m.sub ? `<span>${escapeHtml(m.sub)}</span>` : ""}
    </button>`;
  });
  return `<div class="search-suggest" id="${escapeHtml(id)}" role="listbox">${rows.join("")}</div>`;
}

export function bindSuggestKeyboard(input, {
  getOpen,
  setOpen,
  getIndex,
  setIndex,
  getItems,
  onPick,
  onClose,
}) {
  input.setAttribute("autocomplete", "off");
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("spellcheck", "false");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.onkeydown = (e) => {
    const items = getItems() || [];
    if (!getOpen() || !items.length) {
      if (e.key === "Escape") onClose?.();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex(Math.min(items.length - 1, getIndex() + 1));
      onClose?.("refresh");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex(Math.max(-1, getIndex() - 1));
      onClose?.("refresh");
    } else if (e.key === "Enter" && getIndex() >= 0 && items[getIndex()]) {
      e.preventDefault();
      onPick(items[getIndex()]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setIndex(-1);
      onClose?.("refresh");
    }
  };
  input.onblur = () => {
    setTimeout(() => {
      setOpen(false);
      setIndex(-1);
      onClose?.("refresh");
    }, 150);
  };
}

/**
 * Autocomplétion générique selon le contexte (fetch + clavier + dropdown).
 *
 * opts:
 * - key, wrapId, suggestId?, limit?, minChars?, suggestMinChars?, debounceMs?, openOnFocus?
 * - fetchItems(q) → items
 * - mapItem(item, i) → { title, sub?, attrs? }
 * - onPick(item)
 * - onInput?(q)
 * - afterFetch?(items, q)
 */
export function createAutocomplete(opts) {
  const key = opts.key;
  const suggestId = opts.suggestId || `${key}-suggest`;
  const limit = opts.limit ?? 10;
  const minChars = opts.minChars ?? 0;
  const suggestMinChars = opts.suggestMinChars ?? minChars;
  const debounceMs = opts.debounceMs ?? 180;
  const openOnFocus = opts.openOnFocus !== false;

  if (!state._ac[key]) {
    state._ac[key] = { open: false, index: -1, items: [], q: "" };
  }
  const ac = () => state._ac[key];

  function shouldOpen(q, items) {
    return Boolean(items?.length) && String(q || "").trim().length >= suggestMinChars;
  }

  function html() {
    const s = ac();
    if (!s.open || !s.items.length) return "";
    return suggestDropdownHtml(
      suggestId,
      s.items,
      s.index,
      (item, i) => {
        const m = opts.mapItem(item, i) || {};
        return {
          title: m.title,
          sub: m.sub,
          attrs: `data-ac-key="${escapeHtml(key)}" data-ac-pick="${i}" ${m.attrs || ""}`,
        };
      },
      { limit }
    );
  }

  function bindPicks(root) {
    root?.querySelectorAll(`[data-ac-key="${key}"][data-ac-pick]`).forEach((btn) => {
      btn.onmousedown = (e) => e.preventDefault();
      btn.onclick = () => pick(Number(btn.dataset.acPick));
    });
  }

  function patch() {
    const wrap = document.getElementById(opts.wrapId);
    if (!wrap) return;
    document.getElementById(suggestId)?.remove();
    const markup = html();
    if (markup) {
      wrap.insertAdjacentHTML("beforeend", markup);
      bindPicks(wrap);
    }
  }

  function pick(index) {
    const item = ac().items[index];
    if (!item) return;
    ac().open = false;
    ac().index = -1;
    opts.onPick(item);
    patch();
  }

  function prepare(items, q = "") {
    ac().q = String(q || "");
    ac().items = items || [];
    ac().open = shouldOpen(ac().q, ac().items);
    ac().index = -1;
  }

  function syncItems(items, q = ac().q) {
    prepare(items, q);
    patch();
  }

  function close() {
    ac().open = false;
    ac().index = -1;
    patch();
  }

  async function load(raw) {
    if (state._searchSeq[key] == null) state._searchSeq[key] = 0;
    const seq = (state._searchSeq[key] += 1);
    const q = String(raw || "").trim();
    ac().q = q;
    if (q.length < minChars) {
      ac().items = [];
      ac().open = false;
      ac().index = -1;
      patch();
      opts.afterFetch?.([], q);
      return;
    }
    try {
      const items = (await opts.fetchItems(q)) || [];
      if (seq !== state._searchSeq[key]) return;
      ac().items = items;
      ac().open = shouldOpen(q, items);
      ac().index = -1;
      opts.afterFetch?.(items, q);
      patch();
    } catch {
      if (seq !== state._searchSeq[key]) return;
      ac().items = [];
      ac().open = false;
      ac().index = -1;
      opts.afterFetch?.([], q);
      patch();
    }
  }

  function schedule(raw) {
    opts.onInput?.(String(raw || ""));
    debounceSearch(key, () => load(raw), debounceMs);
  }

  function reset() {
    ac().items = [];
    ac().open = false;
    ac().index = -1;
    ac().q = "";
  }

  function bindInput(input) {
    if (!input) return;
    bindSuggestKeyboard(input, {
      getOpen: () => ac().open,
      setOpen: (v) => {
        ac().open = v;
      },
      getIndex: () => ac().index,
      setIndex: (v) => {
        ac().index = v;
      },
      getItems: () => ac().items.slice(0, limit),
      onPick: (item) => {
        const idx = ac().items.indexOf(item);
        pick(idx >= 0 ? idx : 0);
      },
      onClose: () => patch(),
    });
    input.oninput = (e) => schedule(e.target.value);
    if (openOnFocus) {
      input.onfocus = () => {
        load(input.value);
      };
    }
    bindPicks(document.getElementById(opts.wrapId));
  }

  return {
    html,
    patch,
    pick,
    load,
    schedule,
    bindInput,
    reset,
    close,
    prepare,
    syncItems,
  };
}
