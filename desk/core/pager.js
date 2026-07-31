/**
 * Pagination liste desk (articles, comptes, …) — HTML + binding partagés.
 */

/**
 * @param {{ total: number, page: number, limit: number, singular: string, plural?: string }} opts
 */
export function rangeLabel({ total, page, limit, singular, plural }) {
  const t = Number(total || 0);
  const word = t > 1 ? plural || `${singular}s` : singular;
  if (!t) return `0 ${singular}`;
  const p = Math.max(1, Number(page || 1));
  const lim = Math.max(1, Number(limit || 1));
  const from = (p - 1) * lim + 1;
  const to = Math.min(p * lim, t);
  return `${from}–${to} sur ${t} ${word}`;
}

/**
 * @param {{
 *   page: number,
 *   pages: number,
 *   total: number,
 *   limit: number,
 *   ariaLabel: string,
 *   dataAttr?: string,
 *   windowSize?: number,
 * }} opts
 */
export function pagerHtml({
  page: pageIn,
  pages: pagesIn,
  total,
  limit,
  ariaLabel,
  dataAttr = "page",
  windowSize = 5,
}) {
  const pages = Math.max(1, Number(pagesIn || 1));
  const page = Math.min(Math.max(1, Number(pageIn || 1)), pages);
  if (pages <= 1 && Number(total || 0) <= Number(limit || 0)) {
    return `<div class="pager" hidden></div>`;
  }
  let start = Math.max(1, page - Math.floor(windowSize / 2));
  let end = Math.min(pages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  const nums = [];
  for (let i = start; i <= end; i++) nums.push(i);
  const attr = dataAttr;
  return `
    <nav class="pager" aria-label="${ariaLabel}">
      <button type="button" class="pager__btn" data-${attr}="1" ${page <= 1 ? "disabled" : ""} aria-label="Première page">«</button>
      <button type="button" class="pager__btn" data-${attr}="${page - 1}" ${page <= 1 ? "disabled" : ""} aria-label="Page précédente">‹</button>
      ${nums
        .map(
          (n) =>
            `<button type="button" class="pager__btn${n === page ? " is-active" : ""}" data-${attr}="${n}" ${
              n === page ? 'aria-current="page"' : ""
            }>${n}</button>`
        )
        .join("")}
      <button type="button" class="pager__btn" data-${attr}="${page + 1}" ${page >= pages ? "disabled" : ""} aria-label="Page suivante">›</button>
      <button type="button" class="pager__btn" data-${attr}="${pages}" ${page >= pages ? "disabled" : ""} aria-label="Dernière page">»</button>
      <span class="pager__meta">p. ${page}/${pages}</span>
    </nav>`;
}

/**
 * @param {ParentNode} root
 * @param {string} dataAttr — ex. "page" ou "users-page"
 * @param {(page: number) => void | Promise<void>} onPage
 */
export function bindPager(root, dataAttr, onPage) {
  const sel = `.pager [data-${dataAttr}]`;
  root.querySelectorAll(sel).forEach((btn) => {
    btn.onclick = () => {
      const raw = btn.getAttribute(`data-${dataAttr}`);
      const page = Number(raw);
      if (!Number.isFinite(page) || page < 1) return;
      onPage(page);
    };
  });
}

/**
 * Remplit des hôtes pager et rebind.
 * @param {string[]} hostIds
 * @param {string} html
 * @param {(host: HTMLElement) => void} bindHost
 */
export function patchPagerHosts(hostIds, html, bindHost) {
  for (const id of hostIds) {
    const host = document.getElementById(id);
    if (!host) continue;
    host.innerHTML = html;
    bindHost(host);
  }
}
