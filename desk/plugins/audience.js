import { state } from "../core/state.js";
import { api } from "../core/api.js";
import { escapeHtml, formatInt, formatDateTime, brandBlock } from "../core/format.js";
import { ctx } from "../core/ctx.js";
import { logout } from "../views/login.js";

const app = document.getElementById("app");

export async function loadAudience({ refresh = false } = {}) {
  state.error = "";
  state.status = refresh ? "Rafraîchissement…" : "";
  state.saving = true;
  renderAudience();
  try {
    const data = refresh
      ? await api("/api/desk/audience/refresh", { method: "POST", body: "{}" })
      : await api("/api/desk/audience");
    state.audData = data;
    state.status = refresh ? "Données mises à jour." : "";
  } catch (err) {
    state.error = err.message || "Échec chargement audience";
    if (!state.audData) state.audData = null;
  } finally {
    state.saving = false;
    renderAudience();
  }
}

function destroyAudienceChart() {
  if (state.audChart) {
    try {
      state.audChart.destroy();
    } catch {
      /* ignore */
    }
    state.audChart = null;
  }
}

function mountAudienceChart(graph) {
  destroyAudienceChart();
  const canvas = document.getElementById("aud-chart");
  if (!canvas || typeof Chart === "undefined") return;
  if (!Array.isArray(graph) || !graph.length) return;
  state.audChart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels: graph.map((r) => r.day),
      datasets: [
        {
          label: "Pages vues",
          data: graph.map((r) => r.views),
          borderColor: "#2563eb",
          backgroundColor: "rgba(37,99,235,0.12)",
          tension: 0.3,
          fill: true,
          pointRadius: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxTicksLimit: 7 } },
        y: { beginAtZero: true },
      },
    },
  });
}

export function renderAudience() {
  const d = state.audData;
  const k = d?.kpis || {};
  const graph = d?.graph || [];
  const refs = d?.referrers || [];
  const top = d?.top || [];

  const kpiHtml = `
    <div class="aud-kpis">
      <div class="aud-kpi">
        <div class="aud-kpi-label">Pages vues (30j)</div>
        <div class="aud-kpi-value">${escapeHtml(formatInt(k.views30))}</div>
      </div>
      <div class="aud-kpi">
        <div class="aud-kpi-label">Pages vues (7j)</div>
        <div class="aud-kpi-value">${escapeHtml(formatInt(k.views7))}</div>
      </div>
      <div class="aud-kpi">
        <div class="aud-kpi-label">Concentration</div>
        <div class="aud-kpi-value">${
          k.concentrationPct != null
            ? escapeHtml(String(k.concentrationPct)) + "&nbsp;%"
            : "–"
        }</div>
        <div class="aud-kpi-hint">Part des vues des 5 pages les plus consultées</div>
      </div>
    </div>`;

  const refsRows = refs
    .map((r) => {
      const label = r.url
        ? `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.label)}</a>`
        : escapeHtml(r.label);
      const pct = r.pct != null ? `${escapeHtml(String(r.pct))} %` : "–";
      return `<tr>
        <td>${label}</td>
        <td><span class="aud-ref-badge aud-ref-${escapeHtml(r.scheme || "x")}">${escapeHtml(r.schemeLabel || "Autre")}</span></td>
        <td class="num">${escapeHtml(formatInt(r.count))}</td>
        <td class="num">${pct}</td>
      </tr>`;
    })
    .join("");

  const topRows = top
    .map((r) => {
      const title = escapeHtml(r.title || "(sans titre)");
      const link = r.href
        ? `<a href="${escapeHtml(r.href)}" target="_blank" rel="noopener noreferrer">${title}</a>`
        : title;
      const path = r.pathname || r.path || "";
      return `<tr>
        <td>
          <div>${link}</div>
          ${path ? `<div class="sub">${escapeHtml(path)}</div>` : ""}
        </td>
        <td class="num">${escapeHtml(formatInt(r.views))}</td>
      </tr>`;
    })
    .join("");

  app.innerHTML = `
    <header class="topbar">
      ${brandBlock("Audience", `${escapeHtml(state.user?.name || "")} · ${escapeHtml(state.user?.role || "")}`)}
      <button class="btn btn-ghost" type="button" id="btn-logout">Sortir</button>
    </header>
    ${ctx.navTabs("audience")}
    <main class="main stack">
      <section class="aud-panel">
        <div class="aud-toolbar">
          <p class="sub">Statistiques GoatCounter (30 derniers jours)${
            d?.fetchedAt
              ? ` · maj ${escapeHtml(formatDateTime(d.fetchedAt))}`
              : ""
          }</p>
          <button class="btn" type="button" id="aud-refresh" ${state.saving ? "disabled" : ""}>Rafraîchir</button>
        </div>
        ${state.status ? `<p class="status-line">${escapeHtml(state.status)}</p>` : ""}
        ${state.error ? `<p class="err">${escapeHtml(state.error)}</p>` : ""}
        ${
          !d && !state.saving
            ? `<p class="empty">Aucune donnée.</p>`
            : `${kpiHtml}
        <h2 class="aud-title">Évolution</h2>
        <div class="aud-chart-wrap">
          ${
            graph.length
              ? `<canvas id="aud-chart" height="120"></canvas>`
              : `<p class="empty">Pas de série temporelle.</p>`
          }
        </div>
        <h2 class="aud-title">Sources d’audience</h2>
        ${
          refsRows
            ? `<div class="aud-table-wrap"><table class="aud-table">
                <thead><tr><th>Source</th><th>Type</th><th class="num">Pages vues</th><th class="num">Part</th></tr></thead>
                <tbody>${refsRows}</tbody>
              </table></div>`
            : `<p class="empty">Sources indisponibles.</p>`
        }
        <h2 class="aud-title">Top pages</h2>
        ${
          topRows
            ? `<div class="aud-table-wrap"><table class="aud-table">
                <thead><tr><th>Page</th><th class="num">Pages vues</th></tr></thead>
                <tbody>${topRows}</tbody>
              </table></div>`
            : `<p class="empty">Top pages indisponible.</p>`
        }`
        }
      </section>
    </main>`;

  document.getElementById("btn-logout").onclick = logout;
  ctx.bindNav();
  const refreshBtn = document.getElementById("aud-refresh");
  if (refreshBtn) {
    refreshBtn.onclick = () => loadAudience({ refresh: true });
  }
  if (graph.length) {
    // Chart.js loaded via CDN in index.html
    requestAnimationFrame(() => mountAudienceChart(graph));
  } else {
    destroyAudienceChart();
  }
}
