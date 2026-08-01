import { state } from "../core/state.js";
import { api } from "../core/api.js";
import {
  escapeHtml,
  formatDate,
  formatDateTime,
  filterChips,
  brandBlock,
  listMetaRow,
  updateDateLabel,
} from "../core/format.js";
import { createAutocomplete } from "../core/autocomplete.js";
import {
  createPagedList,
  listSplitCardHtml,
  roleBadgeHtml,
  statusBadgeHtml,
} from "../core/list-resource.js";
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
    const maj =
      updateDateLabel(d) ||
      (d.draft && d.modified ? formatDateTime(d.modified) : "");
    return {
      title: d.title,
      sub: [
        d.draft ? "Brouillon" : formatDate(d.date) || "Sans date",
        maj ? `maj ${maj}` : "",
        d.author || "",
      ]
        .filter(Boolean)
        .join(" · "),
    };
  },
  onPick: (a) => openArticle(a.data.article_id),
  onInput: (q) => {
    state.q = q;
    state.page = 1;
  },
});

function canDeleteArticles() {
  return Boolean(state.caps?.editAll);
}

function articlesItemsHtml(articles) {
  const canDelete = canDeleteArticles();
  return (articles || [])
    .map((a) => {
      const d = a.data;
      const pubLabel = d.draft
        ? "Brouillon"
        : formatDate(d.date) || "Sans date";
      // En ligne : maj seulement si ≠ date de pub. Brouillon : dernière édition si dispo.
      const majLabel =
        updateDateLabel(d) ||
        (d.draft && d.modified ? formatDateTime(d.modified) : "");
      return listSplitCardHtml({
        itemClass: "list-item--article",
        dataAttrs: { open: d.article_id },
        title: d.title,
        byline: d.author || "Sans auteur",
        metaClass: `list-item-meta--article${majLabel ? " has-maj" : ""}`,
        metaHtml: [
          listMetaRow(d.draft ? "Statut" : "Publication", pubLabel),
          majLabel ? listMetaRow("Mis à jour", majLabel) : "",
        ].join(""),
        topBadgeHtml: roleBadgeHtml(String(d.lang || "fr").toUpperCase()),
        statusBadgeHtml: d.draft
          ? statusBadgeHtml("draft", "Brouillon")
          : statusBadgeHtml("live", "En ligne"),
        actionsHtml: canDelete
          ? `<button type="button" class="list-item-dismiss" data-delete-article="${escapeHtml(
              String(d.article_id)
            )}" data-delete-title="${escapeHtml(
              d.title || ""
            )}" title="Supprimer" aria-label="Supprimer l’article">×</button>`
          : "",
      });
    })
    .join("");
}

async function deleteArticleFromList(id, title) {
  const label = String(title || id).trim() || String(id);
  if (!confirm(`Supprimer définitivement « ${label} » ?`)) return;
  try {
    state.error = "";
    await api(`/api/desk/articles/${id}`, { method: "DELETE" });
    await loadList({ soft: true });
  } catch (err) {
    state.error = err.message || "Suppression impossible";
    if (state.view === "list") renderList();
  }
}

function bindListResultClicks(root = app) {
  root.querySelectorAll("[data-open]").forEach((btn) => {
    btn.onclick = () => openArticle(btn.dataset.open);
  });
  root.querySelectorAll("[data-delete-article]").forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      deleteArticleFromList(btn.dataset.deleteArticle, btn.dataset.deleteTitle);
    };
  });
}

const listCtl = createPagedList({
  seqKey: "list",
  view: "list",
  resultsId: "list-results",
  countId: "list-count",
  pagerHostIds: ["list-pager-host", "list-pager-host-bottom"],
  pageDataAttr: "page",
  emptyMessage: "Aucun article",
  singular: "article",
  pagerAriaLabel: "Pagination articles",
  endpoint: "/api/desk/articles",
  itemsResponseKey: "articles",
  fields: {
    page: "page",
    limit: "limit",
    pages: "pages",
    total: "total",
    q: "q",
    items: "articles",
  },
  extraParams(params) {
    if (state.filterDraft !== "") params.set("draft", state.filterDraft);
  },
  itemsHtml: articlesItemsHtml,
  bindResultClicks: bindListResultClicks,
  getAc: () => listAc,
  renderFull: () => renderList(),
  root: app,
});

export const loadList = listCtl.load;

export function renderList() {
  const items =
    articlesItemsHtml(state.articles) || `<div class="empty">Aucun article</div>`;
  const chrome = listCtl.chromeHtml();

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
      ${chrome.top}
      ${state.error ? `<p class="err">${escapeHtml(state.error)}</p>` : ""}
      <div id="list-results">${items}</div>
      ${chrome.bottom}
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
  listCtl.bindPager();
  bindListResultClicks();
}
