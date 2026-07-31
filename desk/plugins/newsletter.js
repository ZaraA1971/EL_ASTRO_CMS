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
  try {
    const data = await api("/api/desk/newsletter");
    state.nlHistory = data.newsletters || [];
    state.nlDryRun = Boolean(data.brevoDryRun);
    // Génère tout de suite (plus besoin de l’ancienne page WP)
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

export function renderNewsletter() {
  const g = state.nlGroups;
  const preview = state.nlPreview;
  const hist = (state.nlHistory || [])
    .map((n) => {
      const st = n.status || "draft";
      const badge =
        st === "sent" ? "live" : st === "failed" ? "draft" : "warn";
      const stats = n.stats
        ? ` · ${n.stats.sent || 0}/${n.stats.total || 0}`
        : "";
      return `<li class="nl-history-item">
        <span class="badge ${badge}">${escapeHtml(st)}</span>
        <strong>${escapeHtml(n.subject || "")}</strong>
        <span class="sub">${escapeHtml(n.date || "")}${stats}</span>
      </li>`;
    })
    .join("");

  app.innerHTML = `
    <header class="topbar">
      ${brandBlock("Newsletter", `${escapeHtml(state.user?.name || "")} · ${escapeHtml(state.user?.role || "")}`)}
      <button class="btn btn-ghost" type="button" id="btn-logout">Sortir</button>
    </header>
    ${ctx.navTabs("newsletter")}
    <main class="main stack">
      ${state.nlDryRun ? `<p class="nl-banner">Brevo dry-run actif — aucun e-mail réel ne partira.</p>` : ""}
      <section class="nl-panel">
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
                <p class="sub">Aujourd’hui : ${preview.counts?.today || 0} (éditos ${preview.counts?.editorial || 0} · brèves ${preview.counts?.briefs || 0}) · manqués ${preview.counts?.missed || 0}</p>
                <p class="sub">Groupes actifs : <strong>${escapeHtml(
                  (preview.groups || selectedNlGroups())
                    .map((x) => NL_GROUP_LABELS[x] || x)
                    .join(" + ") || "—"
                )}</strong></p>
                <p class="sub">Dans la sélection → <strong>${preview.recipientTotal || 0}</strong> destinataire(s)${
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
      <section class="nl-panel">
        <h2 class="nl-hist-title">Historique</h2>
        <ul class="nl-history">${hist || `<li class="sub">Aucune campagne</li>`}</ul>
      </section>
    </main>`;

  document.getElementById("btn-logout").onclick = logout;
  ctx.bindNav();
  const iframe = document.getElementById("nl-iframe");
  if (iframe && preview?.html) {
    iframe.srcdoc = preview.html;
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
  document.getElementById("nl-generate").onclick = () => generateNewsletter();
  document.getElementById("nl-send").onclick = () => draftAndSendNewsletter();
}
