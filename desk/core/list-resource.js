/**
 * Listes paginées desk (articles, comptes, documents) — cartouche + load/patch/pager.
 */
import { state } from "./state.js";
import { api } from "./api.js";
import { escapeHtml } from "./format.js";
import {
  rangeLabel,
  pagerHtml,
  bindPager,
  patchPagerHosts,
  listMetaBarHtml,
  listPagerBottomHtml,
} from "./pager.js";

export { listMetaBarHtml, listPagerBottomHtml };

export function statusBadgeHtml(kind, label) {
  return `<span class="badge ${kind}">${escapeHtml(label)}</span>`;
}

export function roleBadgeHtml(label) {
  return `<span class="badge badge-role">${escapeHtml(label)}</span>`;
}

/**
 * Cartouche split : corps à gauche, badge haut droit + état bas droit.
 * @param {{
 *   itemClass: string,
 *   dataAttrs: Record<string, string|number>,
 *   title: string,
 *   byline?: string|null,
 *   metaHtml: string,
 *   metaClass?: string,
 *   topBadgeHtml: string,
 *   statusBadgeHtml: string,
 * }} opts
 */
export function listSplitCardHtml({
  itemClass,
  dataAttrs,
  title,
  byline = null,
  metaHtml,
  metaClass = "",
  topBadgeHtml,
  statusBadgeHtml: statusHtml,
}) {
  const attrs = Object.entries(dataAttrs || {})
    .map(([k, v]) => `data-${k}="${escapeHtml(String(v))}"`)
    .join(" ");
  return `
    <button class="list-item ${itemClass}" type="button" ${attrs}>
      <div class="list-item-split">
        <div class="list-item-split__body">
          <h2>${escapeHtml(title)}</h2>
          ${
            byline != null && byline !== ""
              ? `<p class="list-item-byline">${escapeHtml(byline)}</p>`
              : ""
          }
          <div class="list-item-meta${metaClass ? ` ${metaClass}` : ""}">${metaHtml}</div>
        </div>
        <aside class="list-item-split__aside" aria-label="Métadonnées">
          ${topBadgeHtml}
          ${statusHtml}
        </aside>
      </div>
    </button>`;
}

/**
 * Contrôleur liste paginée (recherche, soft patch, pagination, autocomplete).
 *
 * @param {{
 *   seqKey: string,
 *   view?: string,
 *   resultsId?: string,
 *   countId?: string,
 *   pagerHostIds?: string[],
 *   pageDataAttr: string,
 *   emptyMessage?: string,
 *   singular: string,
 *   pagerAriaLabel: string,
 *   endpoint: string,
 *   fields: { page: string, limit: string, pages: string, total: string, q: string, items: string },
 *   itemsResponseKey: string,
 *   stateBag?: () => object,
 *   limitParam?: string,
 *   defaultLimit?: number,
 *   minLimit?: number,
 *   maxLimit?: number,
 *   alwaysRenderFull?: boolean,
 *   extraParams?: (params: URLSearchParams) => void,
 *   afterApply?: (data: object) => void,
 *   onLoading?: (loading: boolean) => void,
 *   itemsHtml?: (items: any[]) => string,
 *   bindResultClicks?: (root?: ParentNode) => void,
 *   getAc?: () => { close: () => void, syncItems: (items: any[], q: string) => void } | null,
 *   renderFull: () => void,
 *   errorElId?: string,
 *   root?: ParentNode,
 * }} cfg
 */
export function createPagedList(cfg) {
  const f = cfg.fields;
  const defaultLimit = cfg.defaultLimit ?? 25;
  const minLimit = cfg.minLimit ?? 10;
  const maxLimit = cfg.maxLimit ?? 50;
  const limitParam = cfg.limitParam || "limit";
  const root = cfg.root || document.getElementById("app");

  function bag() {
    return cfg.stateBag ? cfg.stateBag() : state;
  }

  function get(key) {
    return bag()[f[key]];
  }

  function set(key, value) {
    bag()[f[key]] = value;
  }

  function rangeHtml() {
    return rangeLabel({
      total: get("total"),
      page: get("page"),
      limit: get("limit"),
      singular: cfg.singular,
    });
  }

  function pagerMarkup() {
    return pagerHtml({
      page: get("page"),
      pages: get("pages"),
      total: get("total"),
      limit: get("limit"),
      ariaLabel: cfg.pagerAriaLabel,
      dataAttr: cfg.pageDataAttr,
    });
  }

  /** Chrome haut + bas (articles / comptes / documents). */
  function chromeHtml({
    countId = cfg.countId,
    topHostId,
    bottomHostId,
  } = {}) {
    const top = topHostId || cfg.pagerHostIds?.[0];
    const bottom = bottomHostId || cfg.pagerHostIds?.[1];
    const markup = pagerMarkup();
    return {
      top: listMetaBarHtml({
        countId,
        countHtml: rangeHtml(),
        pagerHostId: top,
        pagerMarkup: markup,
      }),
      bottom: listPagerBottomHtml({
        hostId: bottom,
        pagerMarkup: markup,
      }),
    };
  }

  function bindListPager(host = root) {
    bindPager(host, cfg.pageDataAttr, goPage);
  }

  async function goPage(next) {
    const page = Number(next);
    if (!Number.isFinite(page) || page < 1 || page === get("page")) return;
    set("page", page);
    cfg.getAc?.()?.close();
    await load({ soft: !cfg.alwaysRenderFull });
    if (cfg.resultsId) {
      document
        .getElementById(cfg.resultsId)
        ?.scrollIntoView({ block: "start" });
    }
  }

  function patchErrorEl() {
    if (!cfg.errorElId) return;
    const err = document.getElementById(cfg.errorElId);
    if (!err) return;
    if (state.error) {
      err.hidden = false;
      err.textContent = state.error;
    } else {
      err.hidden = true;
      err.textContent = "";
    }
  }

  function patchResults() {
    if (cfg.countId) {
      const count = document.getElementById(cfg.countId);
      if (count) count.textContent = rangeHtml();
    }
    if (cfg.resultsId && cfg.itemsHtml) {
      const list = document.getElementById(cfg.resultsId);
      if (list) {
        list.innerHTML =
          cfg.itemsHtml(get("items")) ||
          `<div class="empty">${escapeHtml(cfg.emptyMessage || "Aucun élément")}</div>`;
        cfg.bindResultClicks?.(list);
      }
    }
    if (cfg.pagerHostIds?.length) {
      patchPagerHosts(cfg.pagerHostIds, pagerMarkup(), bindListPager);
    }
    patchErrorEl();
  }

  async function load({ soft = false, fromAc = false } = {}) {
    if (!state._searchSeq[cfg.seqKey]) state._searchSeq[cfg.seqKey] = 0;
    const seq = (state._searchSeq[cfg.seqKey] += 1);
    const page = Math.max(1, Number(get("page") || 1));
    const limit = Math.min(
      maxLimit,
      Math.max(minLimit, Number(get("limit") || defaultLimit))
    );
    const params = new URLSearchParams({
      [limitParam]: String(limit),
      page: String(page),
    });
    const q = String(get("q") || "").trim();
    if (q) params.set("q", q);
    cfg.extraParams?.(params);
    cfg.onLoading?.(true);
    const finish = (itemsForAc) => {
      cfg.onLoading?.(false);
      if (cfg.alwaysRenderFull) {
        cfg.renderFull();
        return;
      }
      const softOk =
        soft &&
        state.view === cfg.view &&
        cfg.resultsId &&
        document.getElementById(cfg.resultsId);
      if (softOk) {
        patchResults();
        if (!fromAc) cfg.getAc?.()?.syncItems(itemsForAc, get("q"));
      } else if (!fromAc) {
        cfg.renderFull();
      } else {
        patchResults();
      }
    };
    try {
      const data = await api(`${cfg.endpoint}?${params}`);
      if (seq !== state._searchSeq[cfg.seqKey]) return;
      set("items", data[cfg.itemsResponseKey] || []);
      set("total", data.total || 0);
      set("limit", data.limit || data.perPage || limit);
      set(
        "pages",
        data.pages ||
          Math.max(1, Math.ceil(get("total") / get("limit")) || 1)
      );
      set("page", Math.min(data.page || page, get("pages")));
      cfg.afterApply?.(data);
      if (cfg.stateBag) bag().error = "";
      else state.error = "";
      finish(get("items"));
    } catch (err) {
      if (seq !== state._searchSeq[cfg.seqKey]) return;
      if (cfg.stateBag) {
        bag().error = err.message || "Erreur recherche";
        set("items", []);
      } else {
        state.error = err.message || "Erreur recherche";
      }
      finish([]);
    }
  }

  return {
    load,
    patchResults,
    goPage,
    bindPager: bindListPager,
    rangeHtml,
    pagerHtml: pagerMarkup,
    chromeHtml,
  };
}
