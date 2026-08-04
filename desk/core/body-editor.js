import { cleanHtml as cleanArticleHtml } from "../html-clean.js";
import { stripLeadingChapoHtml } from "../excerpt.js";
import { state } from "./state.js";
import {
  escapeHtml,
  toDatetimeLocalValue,
  fromDatetimeLocalValue,
  updateDateLabel,
} from "./format.js";
import { catLabel } from "./rubrics.js";
import { ctx } from "./ctx.js";
import { isPastEditorialUpdateGrace } from "../editorial-update.js";
import { normalizeAccess } from "../article-row.js";

/** Corps article : toujours via contexte desk (styles collés, data-pm, etc.). */
export function cleanBody(html) {
  return cleanArticleHtml(html, "desk");
}

export function exec(cmd, value) {
  document.execCommand(cmd, false, value);
}

/** formatBlock cross-browser (Chrome préfère `<h2>`). */
export function execFormatBlock(tag) {
  const t = String(tag || "p").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!t) return;
  if (!document.execCommand("formatBlock", false, `<${t}>`)) {
    document.execCommand("formatBlock", false, t);
  }
}

export function getVisualEditor() {
  return document.getElementById("visual-editor");
}

export function getHtmlEditor() {
  return document.getElementById("html-editor");
}

/** Lit le corps depuis l’UI et le normalise (visuel + HTML). */
export function getBodyFromDom() {
  if (state.mode === "visual") {
    const el = getVisualEditor();
    return el ? cleanBody(el.innerHTML) : state.article?.body || "";
  }
  if (state.mode === "html") {
    const el = getHtmlEditor();
    return el ? cleanBody(el.value) : state.article?.body || "";
  }
  return state.article?.body || "";
}

/** Applique Nettoyer dans l’éditeur courant (sans save). */
export function applyBodyClean() {
  if (state.mode === "visual") {
    const ed = getVisualEditor();
    if (!ed) return;
    const next = cleanBody(ed.innerHTML) || "<p><br></p>";
    ed.innerHTML = next;
    if (state.article) state.article.body = next === "<p><br></p>" ? "" : next;
  } else if (state.mode === "html") {
    const el = getHtmlEditor();
    if (!el) return;
    el.value = cleanBody(el.value);
    if (state.article) state.article.body = el.value;
  }
  syncPublishButton();
}

/**
 * Colle du HTML / texte déjà nettoyé (évite color:rgb noir-sur-noir).
 * @param {ClipboardEvent} e
 */
export function onVisualPaste(e) {
  const ed = getVisualEditor();
  if (!ed) return;
  const clip = e.clipboardData;
  if (!clip) return;
  e.preventDefault();
  const html = clip.getData("text/html");
  const plain = clip.getData("text/plain");
  let insert = "";
  if (html && /<[a-z][\s\S]*>/i.test(html)) {
    insert = cleanBody(html);
  } else if (plain) {
    insert = plain
      .split(/\n{2,}/)
      .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
      .join("");
  }
  if (!insert) return;
  exec("insertHTML", insert);
  if (state.article) state.article.body = cleanBody(ed.innerHTML);
  syncPublishButton();
}

/** Date comparable (datetime-local local, à la minute). */
export function fingerprintDate(d) {
  if (d == null || d === "") return "";
  const raw = String(d);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    return raw.slice(0, 16);
  }
  return toDatetimeLocalValue(d) || "";
}

export function normalizeKeywordList(list) {
  return [...(list || [])]
    .map((k) => String(k || "").trim())
    .filter(Boolean);
}

/**
 * Empreinte éditoriale : titre, corps, auteur, date, rubriques, accès, mots-clés IA.
 * @param {object} p
 * @param {{ includeAccess?: boolean }} [opts]
 */
export function editFingerprint(p = {}, opts = {}) {
  const includeAccess = opts.includeAccess !== false;
  const cats = [...(p.categories || [])].map(String).filter(Boolean).sort();
  const kws = normalizeKeywordList(p.ia_keywords);
  const base = {
    title: String(p.title || "").trim(),
    body: cleanBody(p.body || ""),
    author: String(p.author || "").trim(),
    date: fingerprintDate(p.date),
    categories: cats,
    ia_keywords: kws,
  };
  if (includeAccess) base.access = normalizeAccess(p.access);
  return JSON.stringify(base);
}

export function editFingerprintFromArticle(article) {
  if (!article) return "";
  const d = article.data || {};
  return editFingerprint({
    title: d.title,
    body: article.body,
    author: d.author,
    date: d.date,
    categories: d.categories,
    access: d.access,
    ia_keywords: d.ia_keywords,
  });
}

export function setEditBaselineFromArticle(article = state.article) {
  if (!article) {
    state.editBaseline = "";
    state.editDirty = false;
    return;
  }
  state.editBaseline = editFingerprintFromArticle(article);
  state.editDirty = false;
}

export function currentEditFingerprint() {
  if (!state.article) return "";
  if (state.view !== "edit") return editFingerprintFromArticle(state.article);
  const a = state.article;
  const titleEl = document.getElementById("f-title");
  const authorEl = document.getElementById("f-author");
  const accessEl = document.getElementById("f-access");
  const dateEl = document.getElementById("f-date");
  const iaEl = document.getElementById("f-ia");
  const chipsRoot = document.getElementById("chips");
  const cats = chipsRoot
    ? [...chipsRoot.querySelectorAll(".chip.on")].map((el) => el.dataset.value)
    : a.data.categories || [];
  const access = accessEl?.value || a.data.access || "subscribers";
  const ia_keywords =
    access === "granted"
      ? []
      : iaEl
        ? iaEl.value
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : a.data.ia_keywords || [];
  // Brouillon : date conservée en BDD (champ désactivé) — utiliser state.
  let date = a.data.date;
  if (!a.data.draft && dateEl && !dateEl.disabled && dateEl.value) {
    date = fromDatetimeLocalValue(dateEl.value) || date;
  }
  return editFingerprint({
    title: titleEl != null ? titleEl.value : a.data.title,
    body: getBodyFromDom(),
    author: authorEl != null ? authorEl.value : a.data.author,
    date,
    categories: cats,
    access,
    ia_keywords,
  });
}

/** Titre / corps / metas modifiés depuis le dernier save / chargement. */
export function isEditContentDirty() {
  if (!state.article || state.view !== "edit") return false;
  if (!state.editBaseline) return false;
  return currentEditFingerprint() !== state.editBaseline;
}

/**
 * Contenu éditorial dirty hors Accès (abonné/gratuit).
 * Un seul changement d’accès ne compte pas comme « Mis à jour ».
 */
export function isEditorialContentDirty() {
  if (!state.article || state.view !== "edit") return false;
  if (!state.editBaseline) return false;
  const a = state.article;
  const d = a.data || {};
  const baselineNoAccess = editFingerprint(
    {
      title: d.title,
      body: a.body,
      author: d.author,
      date: d.date,
      categories: d.categories,
      ia_keywords: d.ia_keywords,
    },
    { includeAccess: false }
  );
  const titleEl = document.getElementById("f-title");
  const authorEl = document.getElementById("f-author");
  const dateEl = document.getElementById("f-date");
  const iaEl = document.getElementById("f-ia");
  const accessEl = document.getElementById("f-access");
  const chipsRoot = document.getElementById("chips");
  const cats = chipsRoot
    ? [...chipsRoot.querySelectorAll(".chip.on")].map((el) => el.dataset.value)
    : d.categories || [];
  const access = accessEl?.value || d.access || "subscribers";
  const accessChanged = normalizeAccess(access) !== normalizeAccess(d.access);
  // Effet Accès → gratuit : mots-clés vidés — ne pas compter comme MAJ éditoriale.
  const ia_keywords =
    access === "granted"
      ? accessChanged
        ? d.ia_keywords || []
        : []
      : iaEl
        ? iaEl.value
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : d.ia_keywords || [];
  let date = d.date;
  if (!d.draft && dateEl && !dateEl.disabled && dateEl.value) {
    date = fromDatetimeLocalValue(dateEl.value) || date;
  }
  const currentNoAccess = editFingerprint(
    {
      title: titleEl != null ? titleEl.value : d.title,
      body: getBodyFromDom(),
      author: authorEl != null ? authorEl.value : d.author,
      date,
      categories: cats,
      ia_keywords,
    },
    { includeAccess: false }
  );
  return currentNoAccess !== baselineNoAccess;
}

export function refreshEditDirty() {
  if (!state.article || state.article.data.draft) {
    state.editDirty = false;
    return;
  }
  state.editDirty = isEditContentDirty();
}

/** Quitter l’édition : confirm si dirty (texte ou metas). */
export function confirmLeaveEdit() {
  if (!isEditContentDirty()) return true;
  return confirm(
    "Modifications non enregistrées. Quitter sans enregistrer ?"
  );
}

/** Publier actif : brouillon, ou article en ligne dont texte/metas ont changé. */
export function canClickPublish() {
  if (!state.article || !state.caps.publish || state.saving) return false;
  if (state.article.data.draft) return true;
  return Boolean(state.editDirty);
}

/** Article en ligne hors délai de grâce → une validation compte comme mise à jour. */
export function isPublishUpdateAction() {
  return Boolean(
    state.article &&
      !state.article.data.draft &&
      isPastEditorialUpdateGrace(state.article.data.date) &&
      isEditorialContentDirty()
  );
}

/** Libellé Publier : « Mis à jour » si en ligne, dirty éditorial, et ≥ 45 min après publication. */
export function publishButtonLabel() {
  if (!state.article) return "Publier";
  if (state.article.data.draft) return "Publier";
  if (!isEditContentDirty()) return "Publier";
  return isPublishUpdateAction() ? "Mis à jour" : "Publier";
}

export function syncPublishButton() {
  refreshEditDirty();
  const btn = document.getElementById("btn-publish");
  if (!btn) return;
  const ok = canClickPublish();
  const label = publishButtonLabel();
  btn.disabled = !ok || state.saving;
  btn.textContent = label;
  btn.title = ok
    ? label
    : "Déjà publié — modifiez le texte ou les métas pour mettre à jour";
}

/** Messages sous l’éditeur — sans reconstruire le DOM. */
export function paintEditMessages() {
  const err = document.getElementById("edit-error");
  const ok = document.getElementById("edit-status");
  if (err) {
    err.hidden = !state.error;
    err.textContent = state.error || "";
  }
  if (ok) {
    ok.hidden = !state.status;
    ok.textContent = state.status || "";
  }
}

/**
 * Busy save/publish : désactive les actions, garde l’éditeur (curseur/scroll).
 * @param {boolean} busy
 */
export function setEditBusy(busy) {
  state.saving = busy;
  const ids = [
    "btn-save",
    "btn-draft",
    "btn-push-now",
    "btn-translate-uk",
    "btn-retranslate",
    "btn-x-generate",
    "btn-x-copy",
    "btn-x-intent",
  ];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.disabled = busy;
  }
  document.querySelectorAll("[data-assist]").forEach((btn) => {
    btn.disabled = busy || state.assisting;
  });
  const ia = document.getElementById("f-ia");
  if (ia) ia.disabled = busy || state.generatingKeywords;
  if (!busy) syncPublishButton();
  else {
    const pub = document.getElementById("btn-publish");
    if (pub) pub.disabled = true;
  }
  paintEditMessages();
}

export function paintEditTopMeta() {
  const meta = document.querySelector(".main-edit .topbar .meta");
  if (!meta || !state.article) return;
  const d = state.article.data;
  meta.textContent = `#${d.article_id} · ${d.draft ? "brouillon" : "en ligne"}`;
}

export function paintModifiedLabel() {
  const el = document.getElementById("f-modified");
  if (!el || !state.article) return;
  const d = state.article.data;
  if (d.draft) {
    el.innerHTML =
      '— <span class="sub">après publication, si l’article est modifié</span>';
    return;
  }
  const label = updateDateLabel(d);
  el.innerHTML = label
    ? escapeHtml(label)
    : '— <span class="sub">renseignée automatiquement à l’enregistrement</span>';
}

/** Champ date + aide selon draft / date conservée. */
export function paintDateField() {
  const dateEl = document.getElementById("f-date");
  const help = document.getElementById("date-help");
  if (!dateEl || !state.article) return;
  const d = state.article.data;
  if (d.draft) {
    dateEl.disabled = true;
    dateEl.value = d.date ? toDatetimeLocalValue(d.date) : "";
    if (help) {
      help.textContent = d.date
        ? "Conservée — restaurée à la remise en ligne (pas de nouvelle date)."
        : "Fixée automatiquement à la première publication.";
    }
  } else {
    dateEl.disabled = false;
    dateEl.value = d.date ? toDatetimeLocalValue(d.date) : "";
    if (help) {
      help.textContent = "Fait foi pour le tri et l’affichage principal.";
    }
  }
}

export function paintDraftButton() {
  const btn = document.getElementById("btn-draft");
  const help = document.getElementById("draft-help");
  if (!btn || !state.article) return;
  const d = state.article.data;
  btn.classList.toggle("is-pressed", Boolean(d.draft));
  btn.setAttribute("aria-pressed", d.draft ? "true" : "false");
  btn.disabled = state.saving || state.translating;
  if (help) {
    help.textContent = d.draft
      ? "Enfoncé = hors ligne. Effet immédiat."
      : state.caps.publish
        ? "Appuyer pour passer en brouillon tout de suite."
        : "Appuyer pour passer en brouillon. Remise en ligne : éditeur.";
  }
}

export function paintKeywordsFromArticle() {
  const ia = document.getElementById("f-ia");
  if (!ia || !state.article) return;
  if (state.article.data.access === "granted") return;
  const kws = state.article.data.ia_keywords || [];
  ia.value = kws.join(", ");
  ia.style.height = "auto";
  ia.style.height = `${Math.max(120, ia.scrollHeight)}px`;
}

/**
 * Après save / draft : met à jour chrome sans détruire l’éditeur.
 * @param {{ fullIfDraftFlip?: boolean, wasDraft?: boolean }} [opts]
 * @returns {boolean} true si un render() complet a été fait
 */
export function paintEditAfterMutation({ fullIfDraftFlip = false, wasDraft = false } = {}) {
  const nowDraft = Boolean(state.article?.data?.draft);
  if (fullIfDraftFlip && wasDraft && !nowDraft) {
    // brouillon → en ligne : bouton push, date éditable, etc.
    ctx.render();
    return true;
  }
  paintEditTopMeta();
  paintModifiedLabel();
  paintDateField();
  paintDraftButton();
  paintKeywordsFromArticle();
  setEditBusy(false);
  paintEditMessages();
  syncPublishButton();
  return false;
}

/** Chapô WP-style : 1er `<p><strong>…</strong></p>` en tête de corps. */
export function extractLeadingChapo(html) {
  const m = String(html || "").match(
    /^\s*<p[^>]*>\s*<strong>([\s\S]*?)<\/strong>\s*<\/p>/i
  );
  return m ? stripTagsPlain(m[1]) : "";
}

export function insertChapoAtTop(chapoPlain) {
  const plain = stripTagsPlain(chapoPlain) || String(chapoPlain || "").trim();
  if (!plain || !state.article) return;
  const lead = `<p><strong>${escapeHtml(plain)}</strong></p>`;
  let body = getBodyFromDom();
  body = stripLeadingChapoHtml(body);
  const next = cleanBody(`${lead}\n${body}`);
  if (state.mode === "html") {
    const el = getHtmlEditor();
    if (el) el.value = next;
  } else if (state.mode === "visual") {
    const ed = getVisualEditor();
    if (ed) ed.innerHTML = next;
  } else {
    // aperçu : bascule en écriture pour afficher le chapô
    state.mode = "visual";
    state.article.body = next;
    ctx.render();
    return;
  }
  state.article.body = next;
}

/** Texte source pour Corriger / Reformuler (sélection ou corps entier). */
export function getAssistSourceText() {
  if (state.mode === "html") {
    const el = document.getElementById("html-editor");
    if (el && el.selectionStart !== el.selectionEnd) {
      return el.value.slice(el.selectionStart, el.selectionEnd);
    }
  }
  if (state.mode === "visual") {
    const ed = document.getElementById("visual-editor");
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && ed && ed.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      const div = document.createElement("div");
      div.appendChild(range.cloneContents());
      const html = div.innerHTML.trim();
      return html || sel.toString();
    }
  }
  return getBodyFromDom();
}

export function assistResultToHtml(text) {
  const t = String(text || "").trim();
  if (!t) return "";
  if (/<[a-z][\s\S]*>/i.test(t)) return cleanBody(t);
  return t
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function replaceSelectionOrBody(html) {
  if (state.mode === "html") {
    const el = document.getElementById("html-editor");
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start !== end) {
      el.setRangeText(html, start, end, "end");
    } else {
      el.value = html;
    }
    state.article.body = el.value;
    return;
  }
  const ed = document.getElementById("visual-editor");
  if (!ed) return;
  const sel = window.getSelection();
  if (sel && sel.rangeCount && !sel.isCollapsed && ed.contains(sel.anchorNode)) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    const frag = document.createDocumentFragment();
    let last = null;
    while (tmp.firstChild) {
      last = tmp.firstChild;
      frag.appendChild(last);
    }
    range.insertNode(frag);
    if (last) {
      sel.removeAllRanges();
      const after = document.createRange();
      after.setStartAfter(last);
      after.collapse(true);
      sel.addRange(after);
    }
  } else {
    ed.innerHTML = html;
  }
  state.article.body = cleanBody(ed.innerHTML);
}

export function stripTagsPlain(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Flush champs édition vers state avant re-render (changement d’onglet). */
export function flushEditFormToState() {
  if (!state.article) return;
  if (state.mode === "visual" || state.mode === "html") {
    state.article.body = getBodyFromDom();
  }
  const titleEl = document.getElementById("f-title");
  if (titleEl) {
    state.article.data.title =
      titleEl.value.trim() || state.article.data.title || "";
  }
  const authorEl = document.getElementById("f-author");
  if (authorEl) {
    state.article.data.author =
      authorEl.value.trim() || state.article.data.author || "";
  }
  const chips = [...document.querySelectorAll("#chips .chip.on")].map(
    (el) => el.dataset.value
  );
  if (chips.length) {
    state.article.data.categories = chips;
    state.article.data.category_names = chips.map(catLabel);
  }
  const dateEl = document.getElementById("f-date");
  if (dateEl && !dateEl.disabled && dateEl.value) {
    const iso = fromDatetimeLocalValue(dateEl.value);
    if (iso) state.article.data.date = iso;
  }
}
