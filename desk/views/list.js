import { state } from "../core/state.js";
import { api } from "../core/api.js";
import {
  escapeHtml,
  formatDate,
  formatDateTime,
  filterChips,
  brandBlock,
  listMetaRowHtml,
  calendarDayKey,
  updateDateLabel,
} from "../core/format.js";
import { createAutocomplete } from "../core/autocomplete.js";
import {
  createPagedList,
  listSplitCardHtml,
  listDismissHtml,
  roleBadgeHtml,
  statusBadgeHtml,
} from "../core/list-resource.js";
import { ctx } from "../core/ctx.js";
import { logout } from "./login.js";
import { openArticle, createArticle } from "./edit.js";

const app = document.getElementById("app");

/** Sélecteur des liens filtre (ne doit pas ouvrir l’article). */
const FILTER_HIT =
  "[data-filter-category],[data-filter-author],[data-filter-date],[data-filter-modified]";

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

function filterLinkHtml({ className, active, attrs, label, title }) {
  const data = Object.entries(attrs)
    .map(([k, v]) => `data-${k}="${escapeHtml(String(v))}"`)
    .join(" ");
  return `<span class="${escapeHtml(className)}${active ? " is-active" : ""}" ${data} role="link" tabindex="0" title="${escapeHtml(title)}">${escapeHtml(label)}</span>`;
}

function articleCatsHtml(d) {
  const slugs = d.categories || [];
  if (!slugs.length) return "";
  const names = d.category_names || [];
  const links = slugs
    .map((slug, i) => {
      const s = String(slug || "").trim();
      if (!s) return "";
      const name = String(names[i] || s).trim() || s;
      return filterLinkHtml({
        className: "list-cat",
        active: state.filterCategory === s,
        attrs: {
          "filter-category": s,
          "filter-category-name": name,
        },
        label: name,
        title: `Articles · ${name}`,
      });
    })
    .filter(Boolean)
    .join('<span class="list-cat-sep" aria-hidden="true">·</span>');
  if (!links) return "";
  return `<div class="list-item-cats" role="group" aria-label="Rubriques">${links}</div>`;
}

function articleAuthorBylineHtml(d) {
  const name = String(d.author || "").trim();
  if (!name) {
    return `<span class="list-author list-author--empty">Sans auteur</span>`;
  }
  return filterLinkHtml({
    className: "list-author",
    active: state.filterAuthor === name,
    attrs: { "filter-author": name },
    label: name,
    title: `Articles · ${name}`,
  });
}

/** Date cliquable → filtre jour (kind: date | modified). */
function clickableDayHtml(iso, label, kind) {
  const text = String(label || "").trim();
  if (!text) return "";
  const day = calendarDayKey(iso);
  if (!day) return escapeHtml(text);
  const attr = kind === "modified" ? "modified" : "date";
  const active =
    kind === "modified"
      ? state.filterModified === day
      : state.filterDate === day;
  return filterLinkHtml({
    className: "list-date",
    active,
    attrs: {
      [`filter-${attr}`]: day,
      [`filter-${attr}-label`]: text,
    },
    label: text,
    title: `Articles · ${text}`,
  });
}

function articlesItemsHtml(articles) {
  const canDelete = canDeleteArticles();
  return (articles || [])
    .map((a) => {
      const d = a.data;
      const pubLabel = d.draft
        ? "Brouillon"
        : formatDate(d.date) || "Sans date";
      const pubValue = d.draft
        ? escapeHtml(pubLabel)
        : d.date
          ? clickableDayHtml(d.date, pubLabel, "date")
          : escapeHtml(pubLabel);
      // En ligne : maj seulement si ≠ date de pub. Brouillon : dernière édition si dispo.
      const majLabel =
        updateDateLabel(d) ||
        (d.draft && d.modified ? formatDateTime(d.modified) : "");
      const majValue = majLabel
        ? clickableDayHtml(d.modified, majLabel, "modified")
        : "";
      return listSplitCardHtml({
        itemClass: "list-item--article",
        dataAttrs: { open: d.article_id },
        title: d.title,
        bylineHtml: articleAuthorBylineHtml(d),
        metaClass: `list-item-meta--article${majLabel ? " has-maj" : ""}`,
        metaHtml: [
          listMetaRowHtml(d.draft ? "Statut" : "Publication", pubValue),
          majValue ? listMetaRowHtml("Mis à jour", majValue) : "",
          articleCatsHtml(d),
        ].join(""),
        topBadgeHtml: roleBadgeHtml(String(d.lang || "fr").toUpperCase()),
        statusBadgeHtml: `<span class="list-item-status">${
          d.draft
            ? statusBadgeHtml("draft", "Brouillon")
            : statusBadgeHtml("live", "En ligne")
        }${d.pinned ? statusBadgeHtml("pinned", "Épinglé") : ""}</span>`,
        actionsHtml: canDelete
          ? listDismissHtml({
              dataAttr: "delete-article",
              id: d.article_id,
              title: d.title || "",
              ariaLabel: "Supprimer l’article",
            })
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

/** Toggle filtre simple (valeur unique) puis recharge la liste. */
async function toggleFilter(key, next, labelKey = "", label = "") {
  const value = String(next || "").trim();
  if (state[key] === value) {
    state[key] = "";
    if (labelKey) state[labelKey] = "";
  } else {
    state[key] = value;
    if (labelKey) state[labelKey] = String(label || value).trim();
  }
  state.page = 1;
  listAc.close();
  await loadList();
}

function bindFilterLinks(root, attr, apply) {
  root.querySelectorAll(`[${attr}]`).forEach((el) => {
    const go = (e) => {
      e.preventDefault();
      e.stopPropagation();
      apply(el);
    };
    el.onclick = go;
    el.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") go(e);
    };
  });
}

function bindListResultClicks(root = app) {
  root.querySelectorAll("[data-open]").forEach((btn) => {
    btn.onclick = (e) => {
      if (e.target.closest(FILTER_HIT)) return;
      openArticle(btn.dataset.open);
    };
  });
  bindFilterLinks(root, "data-filter-category", (el) =>
    toggleFilter(
      "filterCategory",
      el.dataset.filterCategory,
      "filterCategoryName",
      el.dataset.filterCategoryName
    )
  );
  bindFilterLinks(root, "data-filter-author", (el) =>
    toggleFilter("filterAuthor", el.dataset.filterAuthor)
  );
  bindFilterLinks(root, "data-filter-date", (el) =>
    toggleFilter(
      "filterDate",
      el.dataset.filterDate,
      "filterDateLabel",
      el.dataset.filterDateLabel
    )
  );
  bindFilterLinks(root, "data-filter-modified", (el) =>
    toggleFilter(
      "filterModified",
      el.dataset.filterModified,
      "filterModifiedLabel",
      el.dataset.filterModifiedLabel
    )
  );
  root.querySelectorAll("[data-delete-article]").forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      deleteArticleFromList(btn.dataset.deleteArticle, btn.dataset.deleteTitle);
    };
  });
}

function metaFilterChip({ aria, clearAttr, label }) {
  return `<div class="filter-chips filter-chips--meta" role="group" aria-label="${escapeHtml(aria)}">
    <button type="button" class="chip is-active" data-clear-${clearAttr}="1" aria-pressed="true" title="Retirer le filtre">
      ${escapeHtml(label)} ×
    </button>
  </div>`;
}

function activeMetaFilterChipsHtml() {
  const chips = [];
  if (state.filterCategory) {
    chips.push(
      metaFilterChip({
        aria: "Filtre rubrique",
        clearAttr: "category",
        label: state.filterCategoryName || state.filterCategory,
      })
    );
  }
  if (state.filterAuthor) {
    chips.push(
      metaFilterChip({
        aria: "Filtre auteur",
        clearAttr: "author",
        label: state.filterAuthor,
      })
    );
  }
  if (state.filterDate) {
    chips.push(
      metaFilterChip({
        aria: "Filtre publication",
        clearAttr: "date",
        label: `Pub. ${state.filterDateLabel || state.filterDate}`,
      })
    );
  }
  if (state.filterModified) {
    chips.push(
      metaFilterChip({
        aria: "Filtre mise à jour",
        clearAttr: "modified",
        label: `Maj ${state.filterModifiedLabel || state.filterModified}`,
      })
    );
  }
  return chips.join("");
}

async function clearMetaFilter(clear) {
  clear();
  state.page = 1;
  listAc.close();
  await loadList({ soft: true });
  renderList();
}

function bindClearMetaFilters(root = app) {
  const clears = [
    [
      "data-clear-category",
      () => {
        state.filterCategory = "";
        state.filterCategoryName = "";
      },
    ],
    ["data-clear-author", () => { state.filterAuthor = ""; }],
    [
      "data-clear-date",
      () => {
        state.filterDate = "";
        state.filterDateLabel = "";
      },
    ],
    [
      "data-clear-modified",
      () => {
        state.filterModified = "";
        state.filterModifiedLabel = "";
      },
    ],
  ];
  for (const [attr, clear] of clears) {
    root.querySelectorAll(`[${attr}]`).forEach((btn) => {
      btn.onclick = () => clearMetaFilter(clear);
    });
  }
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
    if (state.filterCategory) params.set("category", state.filterCategory);
    if (state.filterAuthor) params.set("author", state.filterAuthor);
    if (state.filterDate) params.set("date", state.filterDate);
    if (state.filterModified) params.set("modified", state.filterModified);
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
        ${activeMetaFilterChipsHtml()}
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
  bindClearMetaFilters();
  listCtl.bindPager();
  bindListResultClicks();
}
