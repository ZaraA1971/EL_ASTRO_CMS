import { state } from "../core/state.js";
import { api, apiForm } from "../core/api.js";
import { escapeHtml, brandBlock } from "../core/format.js";
import { ctx } from "../core/ctx.js";
import { getVisualEditor, exec, getBodyFromDom } from "../core/body-editor.js";
import { logout } from "./login.js";

const app = document.getElementById("app");

/** Types acceptés à l’upload (aligné serveur). */
const MEDIA_ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,text/csv," +
  ".doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,application/zip,.zip";

function mediaPickerRoot() {
  return document.getElementById("media-picker");
}

export function closeMediaPicker() {
  state.mediaPicker.open = false;
  const el = mediaPickerRoot();
  if (el) el.remove();
}

function isMediaImage(item) {
  return String(item?.mime || "").startsWith("image/");
}

function mediaKindLabel(item) {
  const mime = String(item?.mime || "").toLowerCase();
  const name = String(item?.filename || "").toLowerCase();
  if (mime.startsWith("image/")) return "IMG";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "PDF";
  if (mime === "application/zip" || name.endsWith(".zip")) return "ZIP";
  if (
    mime.includes("spreadsheet") ||
    mime.includes("excel") ||
    /\.(xlsx?|ods|csv)$/.test(name)
  )
    return "XLS";
  if (
    mime.includes("presentation") ||
    mime.includes("powerpoint") ||
    /\.(pptx?|odp)$/.test(name)
  )
    return "PPT";
  if (
    mime.includes("word") ||
    mime.includes("opendocument.text") ||
    /\.(docx?|odt)$/.test(name)
  )
    return "DOC";
  if (mime.startsWith("text/") || name.endsWith(".txt")) return "TXT";
  return "FICHIER";
}

function formatBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} o`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} Ko`;
  return `${(b / (1024 * 1024)).toFixed(1)} Mo`;
}

function mediaPreviewHtml(item) {
  if (isMediaImage(item) && (item.thumbUrl || item.url)) {
    return `<img src="${escapeHtml(item.thumbUrl || item.url)}" alt="" loading="lazy" />`;
  }
  return `<span class="media-type-badge" aria-hidden="true">${escapeHtml(mediaKindLabel(item))}</span>`;
}

function mediaGridHtml(items, { selectedId = null, emptyHint = "" } = {}) {
  if (!items.length) {
    return `<p class="media-empty">Aucun document${emptyHint}.</p>`;
  }
  return `<div class="media-grid">
    ${items
      .map((it) => {
        const sel =
          selectedId != null && Number(selectedId) === Number(it.id)
            ? " is-selected"
            : "";
        return `<button type="button" class="media-card${sel}" data-media-id="${it.id}" title="${escapeHtml(it.filename)}">
          ${mediaPreviewHtml(it)}
          <span class="media-card-name">${escapeHtml(it.filename)}</span>
          <span class="media-card-kind">${escapeHtml(mediaKindLabel(it))}</span>
        </button>`;
      })
      .join("")}
  </div>`;
}

function mediaToolbarHtml(mp, { idPrefix = "media" } = {}) {
  return `
    <div class="media-picker-toolbar">
      <input type="search" id="${idPrefix}-q" class="search-input" placeholder="Rechercher un fichier…" value="${escapeHtml(mp.q)}" />
      <label class="btn media-upload-btn ${mp.uploading ? "is-busy" : ""}">
        ${mp.uploading ? "Envoi…" : "Uploader"}
        <input type="file" id="${idPrefix}-file" accept="${MEDIA_ACCEPT}" hidden ${
          mp.uploading ? "disabled" : ""
        } />
      </label>
    </div>
    <div class="field media-alt-field">
      <label for="${idPrefix}-alt">Libellé (lien / upload)</label>
      <input id="${idPrefix}-alt" type="text" value="${escapeHtml(mp.alt)}" placeholder="Ex. Jugement du 12 juin 2026" />
    </div>`;
}

function mediaPagerHtml(mp) {
  return `
    <span class="sub">${mp.total} fichier${mp.total > 1 ? "s" : ""}</span>
    <div class="media-pager">
      <button type="button" class="btn" data-media-page="${mp.page - 1}" ${
        mp.page <= 1 || mp.loading ? "disabled" : ""
      }>Préc.</button>
      <span class="sub">${mp.page} / ${mp.pages}</span>
      <button type="button" class="btn" data-media-page="${mp.page + 1}" ${
        mp.page >= mp.pages || mp.loading ? "disabled" : ""
      }>Suiv.</button>
    </div>`;
}

function refreshMediaUi() {
  if (state.view === "media") {
    renderMedia();
    return;
  }
  if (state.mediaPicker.open) paintMediaPicker();
}

export async function loadMediaPage(page = 1) {
  const mp = state.mediaPicker;
  mp.loading = true;
  mp.error = "";
  mp.status = "";
  mp.page = page;
  refreshMediaUi();
  try {
    const params = new URLSearchParams({
      page: String(page),
      per_page: "24",
    });
    if (mp.q.trim()) params.set("q", mp.q.trim());
    const data = await api(`/api/desk/media?${params}`);
    mp.items = data.items || [];
    mp.page = data.page || page;
    mp.pages = data.pages || 1;
    mp.total = data.total || 0;
    if (
      mp.selectedId != null &&
      !mp.items.some((i) => Number(i.id) === Number(mp.selectedId))
    ) {
      mp.selectedId = null;
    }
  } catch (err) {
    mp.error = err.message || "Chargement impossible";
    mp.items = [];
  } finally {
    mp.loading = false;
    refreshMediaUi();
  }
}

export async function loadMediaLibrary() {
  state.mediaPicker.open = false;
  closeMediaPicker();
  state.error = "";
  await loadMediaPage(state.mediaPicker.page || 1);
}

async function uploadMediaFile(file) {
  const mp = state.mediaPicker;
  if (!file) return;
  mp.uploading = true;
  mp.error = "";
  mp.status = "";
  refreshMediaUi();
  try {
    const fd = new FormData();
    fd.append("file", file);
    if (mp.alt.trim()) fd.append("alt", mp.alt.trim());
    const data = await apiForm("/api/desk/media", fd);
    if (data.item) {
      mp.items = [data.item, ...mp.items.filter((i) => i.id !== data.item.id)];
      mp.total += 1;
      mp.selectedId = data.item.id;
      mp.status = `Uploadé : ${data.item.filename}`;
    }
  } catch (err) {
    mp.error = err.message || "Upload impossible";
  } finally {
    mp.uploading = false;
    refreshMediaUi();
  }
}

async function deleteMediaItem(id) {
  const mp = state.mediaPicker;
  const item = mp.items.find((i) => Number(i.id) === Number(id));
  if (!item) return;
  if (!confirm(`Supprimer « ${item.filename} » ?`)) return;
  try {
    await api(`/api/desk/media/${id}`, { method: "DELETE" });
    mp.items = mp.items.filter((i) => Number(i.id) !== Number(id));
    mp.total = Math.max(0, mp.total - 1);
    if (Number(mp.selectedId) === Number(id)) mp.selectedId = null;
    mp.status = "Fichier supprimé.";
  } catch (err) {
    mp.error = err.message || "Suppression impossible";
  }
  refreshMediaUi();
}

async function saveMediaAlt(id, alt) {
  const mp = state.mediaPicker;
  try {
    const data = await api(`/api/desk/media/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ alt: String(alt || "").trim() }),
    });
    if (data.item) {
      mp.items = mp.items.map((i) =>
        Number(i.id) === Number(id) ? data.item : i
      );
      mp.status = "Libellé enregistré.";
    }
  } catch (err) {
    mp.error = err.message || "Enregistrement impossible";
  }
  refreshMediaUi();
}

async function copyMediaUrl(url) {
  const mp = state.mediaPicker;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
    } else {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    mp.status = "Lien copié.";
  } catch {
    mp.error = "Copie impossible";
  }
  refreshMediaUi();
}

function insertMediaIntoEditor(item) {
  // Pièces jointes / documents — pas d’illustration site (pas de <img> décoratif).
  const url = item.url;
  const label = String(
    state.mediaPicker.alt || item.alt || item.filename || "Document"
  ).trim();
  const html = `<p><a class="el-doc" href="${escapeHtml(url)}">${escapeHtml(label)}</a></p>`;
  const ed = getVisualEditor();
  if (ed) {
    ed.focus();
    exec("insertHTML", html);
    if (state.article) state.article.body = getBodyFromDom();
  }
  closeMediaPicker();
}

function bindMediaControls(root, { idPrefix = "media", mode = "picker" } = {}) {
  const mp = state.mediaPicker;
  const canDelete = Boolean(state.caps.mediaDelete);
  const qInput = root.querySelector(`#${idPrefix}-q`);
  if (qInput) {
    qInput.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        mp.q = qInput.value;
        loadMediaPage(1);
      }
    };
    qInput.onchange = () => {
      mp.q = qInput.value;
    };
  }
  const altInput = root.querySelector(`#${idPrefix}-alt`);
  if (altInput) {
    altInput.oninput = () => {
      mp.alt = altInput.value;
    };
  }
  const fileInput = root.querySelector(`#${idPrefix}-file`);
  if (fileInput) {
    fileInput.onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      uploadMediaFile(file);
    };
  }
  root.querySelectorAll("[data-media-page]").forEach((btn) => {
    btn.onclick = () => {
      const p = Number(btn.dataset.mediaPage) || 1;
      if (p >= 1 && p <= mp.pages) loadMediaPage(p);
    };
  });
  root.querySelectorAll("[data-media-id]").forEach((btn) => {
    btn.onclick = async (e) => {
      const id = Number(btn.dataset.mediaId);
      const item = mp.items.find((i) => Number(i.id) === id);
      if (!item) return;
      if (mode === "picker") {
        if (e.shiftKey && canDelete) {
          await deleteMediaItem(id);
          return;
        }
        insertMediaIntoEditor(item);
        return;
      }
      mp.selectedId = id;
      mp.error = "";
      mp.status = "";
      mp.alt = item.alt || mp.alt;
      refreshMediaUi();
    };
  });
}

function paintMediaPicker() {
  const mp = state.mediaPicker;
  if (!mp.open) return;
  let root = mediaPickerRoot();
  if (!root) {
    root = document.createElement("div");
    root.id = "media-picker";
    root.className = "media-picker";
    document.body.appendChild(root);
  }
  const canDelete = Boolean(state.caps.mediaDelete);
  const grid = mp.loading
    ? `<p class="media-empty">Chargement…</p>`
    : mediaGridHtml(mp.items, {
        emptyHint: mp.q ? " pour cette recherche" : "",
      });

  root.innerHTML = `
    <div class="media-picker-backdrop" data-media-close></div>
    <div class="media-picker-panel" role="dialog" aria-modal="true" aria-label="Documents">
      <header class="media-picker-head">
        <h2>Documents</h2>
        <button type="button" class="btn" data-media-close>Fermer</button>
      </header>
      <p class="uk-help media-picker-help">Pièces jointes (images, PDF, Office…). Pas d’illustrations pour le site — insertion = lien fichier.</p>
      ${mediaToolbarHtml(mp, { idPrefix: "media" })}
      ${mp.error ? `<p class="err">${escapeHtml(mp.error)}</p>` : ""}
      <div class="media-picker-body">${grid}</div>
      <footer class="media-picker-foot">
        ${mediaPagerHtml(mp)}
        ${
          canDelete
            ? `<p class="uk-help">Clic = insérer le lien. Shift+clic = supprimer (éditeurs).</p>`
            : `<p class="uk-help">Clic = insérer le lien document dans l’article.</p>`
        }
      </footer>
    </div>`;

  root.querySelectorAll("[data-media-close]").forEach((el) => {
    el.onclick = () => closeMediaPicker();
  });
  bindMediaControls(root, { idPrefix: "media", mode: "picker" });
}

export function openMediaPicker() {
  state.mediaPicker.open = true;
  state.mediaPicker.error = "";
  state.mediaPicker.status = "";
  state.mediaPicker.alt = "";
  state.mediaPicker.selectedId = null;
  paintMediaPicker();
  loadMediaPage(1);
}

export function renderMedia() {
  const mp = state.mediaPicker;
  const canDelete = Boolean(state.caps.mediaDelete);
  const selected =
    mp.selectedId != null
      ? mp.items.find((i) => Number(i.id) === Number(mp.selectedId))
      : null;

  const grid = mp.loading
    ? `<p class="media-empty">Chargement…</p>`
    : mediaGridHtml(mp.items, {
        selectedId: mp.selectedId,
        emptyHint: mp.q ? " pour cette recherche" : "",
      });

  const detail = selected
    ? `<div class="media-lib-detail-inner">
        <div class="media-lib-preview">${mediaPreviewHtml(selected)}</div>
        <h2 class="media-lib-title">${escapeHtml(selected.filename)}</h2>
        <p class="sub">${escapeHtml(mediaKindLabel(selected))} · ${escapeHtml(formatBytes(selected.bytes))}${
          selected.width && selected.height
            ? ` · ${selected.width}×${selected.height}`
            : ""
        }</p>
        <p class="sub media-lib-url"><a href="${escapeHtml(selected.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(selected.url)}</a></p>
        <div class="field">
          <label for="mlib-alt-edit">Libellé</label>
          <input id="mlib-alt-edit" type="text" value="${escapeHtml(selected.alt || "")}" placeholder="Libellé du lien" />
        </div>
        <div class="media-lib-actions">
          <button type="button" class="btn" id="mlib-save-alt">Enregistrer le libellé</button>
          <button type="button" class="btn" id="mlib-copy">Copier le lien</button>
          <a class="btn" href="${escapeHtml(selected.url)}" target="_blank" rel="noopener noreferrer">Ouvrir</a>
          ${
            canDelete
              ? `<button type="button" class="btn btn-danger" id="mlib-delete">Supprimer</button>`
              : ""
          }
        </div>
      </div>`
    : `<p class="media-empty">Sélectionnez un fichier pour voir le détail, copier le lien ou modifier le libellé.</p>`;

  app.innerHTML = `
    <header class="topbar">
      ${brandBlock("Documents", `${escapeHtml(state.user?.name || "")} · ${escapeHtml(state.user?.role || "")}`)}
      <button class="btn btn-ghost" type="button" id="btn-logout">Sortir</button>
    </header>
    ${ctx.navTabs("media")}
    <main class="main stack">
      <p class="uk-help">Bibliothèque de pièces jointes (images, PDF, Office, zip). Insertion dans un article via le bouton Document de l’éditeur.</p>
      ${mediaToolbarHtml(mp, { idPrefix: "mlib" })}
      ${mp.status ? `<p class="status-line">${escapeHtml(mp.status)}</p>` : ""}
      ${mp.error ? `<p class="err">${escapeHtml(mp.error)}</p>` : ""}
      ${state.error ? `<p class="err">${escapeHtml(state.error)}</p>` : ""}
      <div class="media-lib">
        <div class="media-lib-grid-wrap">
          ${grid}
        </div>
        <aside class="media-lib-detail" aria-label="Détail du fichier">
          ${detail}
        </aside>
      </div>
      <footer class="media-picker-foot media-lib-foot">
        ${mediaPagerHtml(mp)}
      </footer>
    </main>`;

  document.getElementById("btn-logout").onclick = logout;
  ctx.bindNav();
  bindMediaControls(app, { idPrefix: "mlib", mode: "library" });

  const saveBtn = document.getElementById("mlib-save-alt");
  if (saveBtn && selected) {
    saveBtn.onclick = () => {
      const input = document.getElementById("mlib-alt-edit");
      saveMediaAlt(selected.id, input?.value || "");
    };
  }
  const copyBtn = document.getElementById("mlib-copy");
  if (copyBtn && selected) {
    copyBtn.onclick = () => copyMediaUrl(selected.url);
  }
  const delBtn = document.getElementById("mlib-delete");
  if (delBtn && selected) {
    delBtn.onclick = () => deleteMediaItem(selected.id);
  }
}
