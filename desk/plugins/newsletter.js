import { state } from "../core/state.js";
import { api } from "../core/api.js";
import { escapeHtml, brandBlock } from "../core/format.js";
import { ctx } from "../core/ctx.js";
import { logout } from "../views/login.js";

const app = document.getElementById("app");

const NL_GROUP_LABELS = {
  admin: "Admin",
  redacteurs: "Rédacteurs",
  abonnes: "Abonnés",
};

function selectedNlGroups() {
  return Object.entries(state.nlGroups)
    .filter(([, on]) => on)
    .map(([k]) => k);
}

export async function loadNewsletter() {
  state.error = "";
  state.nlHistoryView = null;
  try {
    const data = await api("/api/desk/newsletter");
    state.nlHistory = data.newsletters || [];
    state.nlDryRun = Boolean(data.brevoDryRun);
    await generateNewsletter({ silent: true });
  } catch (err) {
    state.error = err.message || "Erreur newsletter";
    renderNewsletter();
  }
}

/** Compose HTML + compteurs destinataires depuis el_articles. */
async function generateNewsletter({ silent = false } = {}) {
  state.error = "";
  const groupsList = selectedNlGroups();
  if (!groupsList.length) {
    state.nlPreview = null;
    state.error = "Sélectionnez au moins un groupe destinataire.";
    state.status = "";
    state.saving = false;
    renderNewsletter();
    return;
  }
  if (!silent) state.status = "Génération…";
  state.saving = true;
  if (!silent) renderNewsletter();
  try {
    const params = new URLSearchParams({
      date: state.nlDate,
      groups: groupsList.join(","),
    });
    state.nlPreview = await api(`/api/desk/newsletter/preview?${params}`);
    const gl = (state.nlPreview.groups || groupsList)
      .map((x) => NL_GROUP_LABELS[x] || x)
      .join(" + ");
    state.status = `${state.nlPreview.counts?.today || 0} article(s) · ${state.nlPreview.recipientTotal || 0} destinataire(s) [${gl}]`;
  } catch (err) {
    state.error = err.message || "Génération impossible";
    state.nlPreview = null;
    if (silent) state.status = "";
  } finally {
    state.saving = false;
    renderNewsletter();
  }
}

async function draftAndSendNewsletter() {
  if (!state.nlPreview) {
    await generateNewsletter();
    if (!state.nlPreview) return;
  }
  const groups = selectedNlGroups();
  if (!groups.length) {
    state.error = "Sélectionnez au moins un groupe.";
    renderNewsletter();
    return;
  }
  // Recalcule toujours avant envoi (évite aperçu obsolète / mauvais groupes)
  await generateNewsletter({ silent: true });
  if (!state.nlPreview) return;
  const previewGroups = state.nlPreview.groups || groups;
  const total = Number(state.nlPreview.recipientTotal || 0);
  const groupLabel = previewGroups
    .map((g) => NL_GROUP_LABELS[g] || g)
    .join(" + ");
  const dry = state.nlDryRun ? " (dry-run Brevo — aucun e-mail réel)" : " — ENVOI RÉEL";
  if (
    !confirm(
      `Envoyer « ${state.nlPreview.subject} »\n\nGroupes : ${groupLabel}\nDestinataires : ${total}${dry}\n\nConfirmer ?`
    )
  ) {
    return;
  }
  state.saving = true;
  state.error = "";
  state.status = "Enregistrement + envoi…";
  renderNewsletter();
  try {
    const draft = await api("/api/desk/newsletter/draft", {
      method: "POST",
      body: JSON.stringify({ date: state.nlDate, groups: previewGroups }),
    });
    const sent = await api(`/api/desk/newsletter/${draft.id}/send`, {
      method: "POST",
      body: JSON.stringify({
        groups: previewGroups,
        confirmTotal: total,
      }),
    });
    const st = sent.stats || {};
    state.status = `Envoyé${sent.brevoDryRun ? " (dry-run)" : ""} : ${st.sent || 0} ok · ${st.skipped || 0} skip · ${st.errors || 0} erreurs`;
    state.nlPreview = null;
    await loadNewsletter();
  } catch (err) {
    state.error = err.message || "Échec envoi";
    state.saving = false;
    renderNewsletter();
  }
}

function closeHistoryNewsletter() {
  state.nlHistoryView = null;
  state.status = "";
  renderNewsletter();
}

async function openHistoryNewsletter(id) {
  const nid = Number(id);
  if (!Number.isFinite(nid) || nid < 1) return;
  // Reclic sur l’envoi ouvert → replier.
  if (state.nlHistoryView && Number(state.nlHistoryView.id) === nid) {
    closeHistoryNewsletter();
    return;
  }
  state.error = "";
  state.status = "Chargement de l’envoi…";
  renderNewsletter();
  try {
    const data = await api(`/api/desk/newsletter/${nid}`);
    const n = data.newsletter || {};
    state.nlHistoryView = {
      id: nid,
      subject: n.subject || "",
      html: n.html || "",
    };
    state.status = "";
  } catch (err) {
    state.error = err.message || "Impossible d’ouvrir cet envoi";
    state.nlHistoryView = null;
  }
  renderNewsletter();
}

export function renderNewsletter() {
  const g = state.nlGroups;
  const preview = state.nlPreview;
  const histView = state.nlHistoryView;
  const historyAll = state.nlHistory || [];
  const hist = historyAll
    .map((n) => {
      const st = n.status || "draft";
      const badge =
        st === "sent" ? "live" : st === "failed" ? "draft" : "warn";
      const stats = n.stats
        ? ` · ${n.stats.sent || 0}/${n.stats.total || 0}`
        : "";
      const active =
        histView && Number(histView.id) === Number(n.id) ? " is-active" : "";
      return `<li class="nl-history-item${active}">
        <button type="button" class="nl-history-btn" data-nl-open="${Number(n.id)}">
          <span class="badge ${badge}">${escapeHtml(st)}</span>
          <strong>${escapeHtml(n.subject || "")}</strong>
          <span class="sub">${escapeHtml(n.date || "")}${stats}</span>
        </button>
      </li>`;
    })
    .join("");

  app.innerHTML = `
    <header class="topbar">
      ${brandBlock("Newsletter", `${escapeHtml(state.user?.name || "")} · ${escapeHtml(state.user?.role || "")}`)}
      <button class="btn btn-ghost" type="button" id="btn-logout">Sortir</button>
    </header>
    ${ctx.navTabs("newsletter")}
    <main class="main stack nl-page">
      ${state.nlDryRun ? `<p class="nl-banner">Brevo dry-run actif — aucun e-mail réel ne partira.</p>` : ""}
      <section class="nl-panel nl-panel--compose" aria-labelledby="nl-compose-title">
        <h2 class="nl-compose-title" id="nl-compose-title">Newsletter du jour</h2>
        <div class="toolbar-list nl-row">
          <label class="nl-date-field">
            <span class="nl-date-label">Date</span>
            <input type="date" class="search-input search-input--compact" id="nl-date" value="${escapeHtml(state.nlDate)}" />
          </label>
          <div class="filter-chips" role="group" aria-label="Groupes destinataires">
            <button type="button" class="chip${g.admin ? " is-active" : ""}" data-nl-group="admin" aria-pressed="${g.admin ? "true" : "false"}">Admin</button>
            <button type="button" class="chip${g.redacteurs ? " is-active" : ""}" data-nl-group="redacteurs" aria-pressed="${g.redacteurs ? "true" : "false"}">Rédacteurs</button>
            <button type="button" class="chip${g.abonnes ? " is-active" : ""}" data-nl-group="abonnes" aria-pressed="${g.abonnes ? "true" : "false"}">Abonnés</button>
          </div>
          <p class="sub nl-groups-hint">Cochez uniquement les groupes ciblés (défaut : Admin).</p>
        </div>
        <div class="nl-actions toolbar-list">
          <button class="btn btn-primary" type="button" id="nl-generate" ${state.saving ? "disabled" : ""}>Générer</button>
          <button class="btn" type="button" id="nl-send" ${state.saving || !preview ? "disabled" : ""}>Envoyer</button>
        </div>
        ${state.status ? `<p class="status-line">${escapeHtml(state.status)}</p>` : ""}
        ${state.error ? `<p class="err">${escapeHtml(state.error)}</p>` : ""}
        ${
          preview
            ? `<div class="nl-meta">
                <p><strong>${escapeHtml(preview.subject)}</strong></p>
                <p class="sub">Aujourd’hui : ${preview.counts?.today || 0} (éditos ${preview.counts?.editorial || 0} · brèves ${preview.counts?.briefs || 0}) · manqués ${preview.counts?.missed || 0} · groupes <strong>${escapeHtml(
                  (preview.groups || selectedNlGroups())
                    .map((x) => NL_GROUP_LABELS[x] || x)
                    .join(" + ") || "—"
                )}</strong> · <strong>${preview.recipientTotal || 0}</strong> destinataire(s)${
                  g.admin ? ` · admin ${preview.recipientCounts?.admin || 0}` : ""
                }${
                  g.redacteurs
                    ? ` · rédacteurs ${preview.recipientCounts?.redacteurs || 0}`
                    : ""
                }${
                  g.abonnes
                    ? ` · abonnés ${preview.recipientCounts?.abonnes || 0}`
                    : ""
                }</p>
              </div>
              <iframe class="nl-iframe" id="nl-iframe" title="Aperçu newsletter" sandbox=""></iframe>`
            : `<p class="empty">Choisissez une date et prévisualisez.</p>`
        }
      </section>
      <section class="nl-panel nl-panel--history" aria-labelledby="nl-hist-title">
        <div class="nl-hist-head">
          <h2 class="nl-hist-title" id="nl-hist-title">Déjà envoyées${
            historyAll.length ? ` <span class="sub">(${historyAll.length})</span>` : ""
          }</h2>
          <p class="sub nl-hist-hint">${
            histView
              ? "Replier via le bouton ou en recliquant la ligne."
              : "Cliquez une ligne pour afficher l’envoi."
          }</p>
        </div>
        <ul class="nl-history">${hist || `<li class="sub">Aucune campagne</li>`}</ul>
        ${
          histView
            ? `<div class="nl-hist-view">
                <div class="nl-hist-view-bar">
                  <p class="nl-hist-view-title"><strong>${escapeHtml(histView.subject || "Envoi")}</strong></p>
                  <button type="button" class="btn" id="nl-hist-close">Replier</button>
                </div>
                <iframe class="nl-iframe nl-iframe--history" id="nl-hist-iframe" title="Newsletter envoyée" sandbox=""></iframe>
              </div>`
            : ""
        }
      </section>
    </main>`;

  document.getElementById("btn-logout").onclick = logout;
  ctx.bindNav();
  const iframe = document.getElementById("nl-iframe");
  if (iframe && preview?.html) {
    iframe.srcdoc = preview.html;
  }
  const histIframe = document.getElementById("nl-hist-iframe");
  if (histIframe && histView?.html) {
    histIframe.srcdoc = histView.html;
  }
  document.getElementById("nl-date").onchange = async (e) => {
    state.nlDate = e.target.value;
    state.nlPreview = null;
    await generateNewsletter();
  };
  app.querySelectorAll("[data-nl-group]").forEach((el) => {
    el.onclick = async () => {
      const key = el.dataset.nlGroup;
      state.nlGroups[key] = !state.nlGroups[key];
      state.nlPreview = null;
      await generateNewsletter();
    };
  });
  app.querySelectorAll("[data-nl-open]").forEach((el) => {
    el.onclick = () => openHistoryNewsletter(el.dataset.nlOpen);
  });
  const histClose = document.getElementById("nl-hist-close");
  if (histClose) {
    histClose.onclick = () => closeHistoryNewsletter();
  }
  document.getElementById("nl-generate").onclick = () => generateNewsletter();
  document.getElementById("nl-send").onclick = () => draftAndSendNewsletter();
}
