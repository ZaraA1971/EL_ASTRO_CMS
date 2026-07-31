import { state } from "../core/state.js";
import { api } from "../core/api.js";
import { escapeHtml, formatDate, filterChips, brandBlock } from "../core/format.js";
import {
  rangeLabel,
  pagerHtml,
  bindPager,
  patchPagerHosts,
} from "../core/pager.js";
import { createAutocomplete } from "../core/autocomplete.js";
import { ctx } from "../core/ctx.js";
import { logout } from "./login.js";
import { openArticle, createArticle } from "./edit.js";

const app = document.getElementById("app");

/** Autocomplete + recherche liste articles. */
const listAc = createAutocomplete({
  key: "listAc",
  wrapId: "list-search-wrap",
  suggestId: "list-suggest",
  limit: 8,
  minChars: 0,
  suggestMinChars: 1,
  openOnFocus: false,
  debounceMs: 200,
  fetchItems: async (q) => {
    state.q = q;
    state.page = 1;
    await loadList({ soft: true, fromAc: true });
    return state.articles;
  },
  mapItem: (a) => {
    const d = a.data;
    return {
      title: d.title,
      sub: `${d.draft ? "Brouillon" : formatDate(d.date) || "Sans date"} · ${d.author || ""}`,
    };
  },
  onPick: (a) => openArticle(a.data.article_id),
  onInput: (q) => {
    state.q = q;
    state.page = 1;
  },
});

function articlesItemsHtml(articles) {
  return (articles || [])
    .map((a) => {
      const d = a.data;
      const badge = d.draft
        ? `<span class="badge draft">Brouillon</span>`
        : `<span class="badge live">En ligne</span>`;
      return `
        <button class="list-item" type="button" data-open="${d.article_id}">
          <div class="row" style="justify-content:space-between">
            ${badge}
            <span class="sub">${escapeHtml(
              d.draft ? "—" : formatDate(d.date) || "—"
            )} · ${escapeHtml(d.lang || "fr")}</span>
          </div>
          <h2>${escapeHtml(d.title)}</h2>
          <div class="sub">${escapeHtml(d.author || "")}</div>
        </button>`;
    })
    .join("");
}

function bindListResultClicks(root = app) {
  root.querySelectorAll("[data-open]").forEach((btn) => {
    btn.onclick = () => openArticle(btn.dataset.open);
  });
}

function listRangeLabel() {
  return rangeLabel({
    total: state.total,
    page: state.page,
    limit: state.limit,
    singular: "article",
  });
}

function listPagerHtml() {
  return pagerHtml({
    page: state.page,
    pages: state.pages,
    total: state.total,
    limit: state.limit,
    ariaLabel: "Pagination articles",
    dataAttr: "page",
  });
}

async function goListPage(next) {
  const page = Number(next);
  if (!Number.isFinite(page) || page < 1 || page === state.page) return;
  state.page = page;
  listAc.close();
  await loadList({ soft: true });
  document.getElementById("list-results")?.scrollIntoView({ block: "start" });
}

function bindListPager(root = app) {
  bindPager(root, "page", goListPage);
}

function patchListResults() {
  const count = document.getElementById("list-count");
  if (count) count.textContent = listRangeLabel();
  const list = document.getElementById("list-results");
  if (list) {
    list.innerHTML =
      articlesItemsHtml(state.articles) || `<div class="empty">Aucun article</div>`;
    bindListResultClicks(list);
  }
  patchPagerHosts(
    ["list-pager-host", "list-pager-host-bottom"],
    listPagerHtml(),
    bindListPager
  );
}

export async function loadList({ soft = false, fromAc = false } = {}) {
  const seq = (state._searchSeq.list += 1);
  const page = Math.max(1, Number(state.page || 1));
  const limit = Math.min(50, Math.max(10, Number(state.limit || 25)));
  const params = new URLSearchParams({
    limit: String(limit),
    page: String(page),
  });
  const q = String(state.q || "").trim();
  if (q) params.set("q", q);
  if (state.filterDraft !== "") params.set("draft", state.filterDraft);
  try {
    const data = await api(`/api/desk/articles?${params}`);
    if (seq !== state._searchSeq.list) return;
    state.articles = data.articles || [];
    state.total = data.total || 0;
    state.limit = data.limit || limit;
    state.pages = data.pages || Math.max(1, Math.ceil(state.total / state.limit) || 1);
    state.page = Math.min(data.page || page, state.pages);
    state.error = "";
    if (soft && state.view === "list" && document.getElementById("list-results")) {
      patchListResults();
      if (!fromAc) listAc.syncItems(state.articles, state.q);
    } else if (!fromAc) {
      renderList();
    } else {
      patchListResults();
    }
  } catch (err) {
    if (seq !== state._searchSeq.list) return;
    state.error = err.message || "Erreur recherche";
    if (soft && state.view === "list" && document.getElementById("list-results")) {
      patchListResults();
      if (!fromAc) listAc.syncItems([], state.q);
    } else if (!fromAc) {
      renderList();
    } else {
      patchListResults();
    }
  }
}

export function renderList() {
  const items =
    articlesItemsHtml(state.articles) || `<div class="empty">Aucun article</div>`;

  app.innerHTML = `
    <header class="topbar">
      ${brandBlock("Pupitre", `${escapeHtml(state.user?.name || "")} · ${escapeHtml(state.user?.role || "")}`)}
      <button class="btn btn-ghost" type="button" id="btn-logout">Sortir</button>
    </header>
    ${ctx.navTabs("list")}
    <main class="main stack">
      <div class="toolbar-list">
        <div class="search-wrap" id="list-search-wrap">
          <input class="search-input search-input--compact" id="q" type="search" placeholder="Rechercher un article…" value="${escapeHtml(state.q)}" autocomplete="off" />
          ${listAc.html()}
        </div>
        ${filterChips(
          "Statut publication",
          [
            ["", "Tous"],
            ["1", "Brouillons"],
            ["0", "Publiés"],
          ],
          state.filterDraft,
          "draft"
        )}
      </div>
      <div class="list-meta">
        <p class="count-line" id="list-count">${listRangeLabel()}</p>
        <div id="list-pager-host">${listPagerHtml()}</div>
      </div>
      ${state.error ? `<p class="err">${escapeHtml(state.error)}</p>` : ""}
      <div id="list-results">${items}</div>
      <div id="list-pager-host-bottom" class="list-pager-bottom">${listPagerHtml()}</div>
    </main>
    <button class="fab" type="button" id="btn-new" title="Nouvel article" aria-label="Nouvel article">+</button>`;

  document.getElementById("btn-logout").onclick = logout;
  document.getElementById("btn-new").onclick = () => createArticle();
  ctx.bindNav();
  listAc.bindInput(document.getElementById("q"));
  app.querySelectorAll("[data-draft]").forEach((btn) => {
    btn.onclick = async () => {
      state.filterDraft = btn.dataset.draft;
      state.page = 1;
      listAc.close();
      await loadList({ soft: true });
    };
  });
  bindListPager();
  bindListResultClicks();
}
