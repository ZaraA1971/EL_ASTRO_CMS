import { cleanHtml as cleanArticleHtml } from "../html-clean.js";
import { stripLeadingChapoHtml } from "../excerpt.js";
import { hrefFrom } from "../paste-link.js";
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

/** Collage extérieur — contexte paste (plus strict que desk). */
export function cleanPaste(html) {
  return cleanArticleHtml(html, "paste");
}

let editorCmdsReady = false;

function ensureEditorCommands() {
  if (editorCmdsReady) return;
  try {
    document.execCommand("styleWithCSS", false, false);
    document.execCommand("defaultParagraphSeparator", false, "p");
  } catch {
    /* older engines */
  }
  editorCmdsReady = true;
}

export function exec(cmd, value) {
  ensureEditorCommands();
  document.execCommand(cmd, false, value);
}

function unwrapElement(el) {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

/** Déplie spans vides / gras dans gras — sans réécrire tout le HTML (curseur conservé). */
function tidyVisualInline(ed = getVisualEditor()) {
  if (!ed) return;
  for (const span of [...ed.querySelectorAll("span")]) {
    if (span.hasAttributes()) continue;
    unwrapElement(span);
  }
  for (const inner of [...ed.querySelectorAll("b b, strong strong, i i, em em")]) {
    unwrapElement(inner);
  }
}

/** Gras / italique / liste / alignement — puis rangement léger. */
export function runEditorCommand(cmd, value) {
  exec(cmd, value);
  if (cmd !== "undo" && cmd !== "redo") tidyVisualInline();
}

/** formatBlock cross-browser (Chrome préfère `<h2>`). */
export function execFormatBlock(tag) {
  const t = String(tag || "p").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!t) return;
  ensureEditorCommands();
  if (!document.execCommand("formatBlock", false, `<${t}>`)) {
    document.execCommand("formatBlock", false, t);
  }
  tidyVisualInline();
}

/** Bouton Lien : le prompt vole la sélection — on la restitue. */
export function applyLinkFromPrompt() {
  rememberVisualSelection();
  const raw = prompt("URL du lien");
  restoreVisualSelectionIfNeeded();
  const href = hrefFrom(raw, "prompt");
  if (!href) return;
  const ed = getVisualEditor();
  ed?.focus();
  exec("createLink", href);
  tidyVisualInline(ed);
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

/** Dernière sélection dans l’éditeur — Safari/Chrome Mac peuvent la perdre au Cmd+V. */
let lastVisualRange = null;
/** Évite un 2e collage si beforeinput a déjà posé le lien. */
let pasteLinkJustApplied = false;

function nodeInEditor(ed, node) {
  return Boolean(ed && node && (node === ed || ed.contains(node)));
}

/** Sélection de texte dans l’éditeur visuel (pas un curseur seul). */
function hasVisualTextSelection() {
  const ed = getVisualEditor();
  const sel = window.getSelection();
  if (!ed || !sel || !sel.rangeCount || sel.isCollapsed) return false;
  if (!nodeInEditor(ed, sel.anchorNode)) return false;
  if (sel.focusNode && !nodeInEditor(ed, sel.focusNode)) return false;
  return Boolean(sel.toString());
}

function rememberVisualSelection() {
  const ed = getVisualEditor();
  const sel = window.getSelection();
  if (!ed || !sel || !sel.rangeCount || sel.isCollapsed) {
    lastVisualRange = null;
    return;
  }
  if (!nodeInEditor(ed, sel.anchorNode)) {
    lastVisualRange = null;
    return;
  }
  try {
    lastVisualRange = sel.getRangeAt(0).cloneRange();
  } catch {
    lastVisualRange = null;
  }
}

function restoreVisualSelectionIfNeeded() {
  if (hasVisualTextSelection()) return true;
  const ed = getVisualEditor();
  if (!ed || !lastVisualRange || lastVisualRange.collapsed) return false;
  try {
    if (!nodeInEditor(ed, lastVisualRange.commonAncestorContainer)) return false;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(lastVisualRange);
    return hasVisualTextSelection();
  } catch {
    return false;
  }
}

function readClipboardPayload(e) {
  const dt = e?.clipboardData || e?.dataTransfer;
  const uriList = dt?.getData?.("text/uri-list") || "";
  return {
    plain: dt?.getData?.("text/plain") || e?.data || "",
    html: dt?.getData?.("text/html") || "",
    uriList,
  };
}

/**
 * URL + sélection → pose le lien, sans remplacer le mot.
 * @param {Event} e
 * @param {{ plain?: string, html?: string, uriList?: string }} payload
 */
function applyPasteLink(e, payload) {
  restoreVisualSelectionIfNeeded();
  if (!hasVisualTextSelection()) return false;
  const href = hrefFrom(payload, "clipboard");
  if (!href) return false;
  e.preventDefault();
  e.stopImmediatePropagation();
  const ed = getVisualEditor();
  ed?.focus();
  exec("createLink", href);
  if (state.article && ed) state.article.body = cleanBody(ed.innerHTML);
  syncPublishButton();
  pasteLinkJustApplied = true;
  setTimeout(() => {
    pasteLinkJustApplied = false;
  }, 50);
  return true;
}

/**
 * Safari / Chrome Mac : le collage peut remplacer la sélection *avant* `paste`.
 * On pose le lien ici, ou on bloque le remplacement si une URL arrive ensuite.
 * @param {InputEvent} e
 */
function onVisualBeforeInput(e) {
  if (e.inputType !== "insertFromPaste" && e.inputType !== "insertFromDrop") {
    return;
  }
  rememberVisualSelection();
  const payload = readClipboardPayload(e);
  if (applyPasteLink(e, payload)) return;
  // Bloquer le collage natif seulement s’il y a une sélection vivante
  // (pas une ancienne plage : sinon le curseur recolle au mauvais endroit).
  if (hasVisualTextSelection()) {
    e.preventDefault();
  }
}

/**
 * Colle du HTML / texte déjà nettoyé (évite color:rgb noir-sur-noir).
 * URL (ou un seul lien copié) + sélection → applique le lien, sans remplacer le texte.
 * @param {ClipboardEvent} e
 */
function onVisualPaste(e) {
  const ed = getVisualEditor();
  if (!ed) return;
  if (pasteLinkJustApplied) {
    e.preventDefault();
    pasteLinkJustApplied = false;
    return;
  }
  const payload = readClipboardPayload(e);
  if (applyPasteLink(e, payload)) return;
  e.preventDefault();
  const { html, plain } = payload;
  let insert = "";
  if (html && /<[a-z][\s\S]*>/i.test(html)) {
    insert = cleanPaste(html);
  } else if (plain) {
    insert = plain
      .split(/\n{2,}/)
      .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
      .join("");
  }
  if (!insert) return;
  if (hasVisualTextSelection()) restoreVisualSelectionIfNeeded();
  exec("insertHTML", insert);
  if (state.article) state.article.body = cleanBody(ed.innerHTML);
  syncPublishButton();
}

/** Écouteurs collage / sélection — à brancher à chaque render visuel. */
export function bindVisualEditorClipboard(ed) {
  if (!ed) return;
  ensureEditorCommands();
  ed.addEventListener("input", () => syncPublishButton());
  ed.addEventListener("beforeinput", onVisualBeforeInput, true);
  ed.addEventListener("paste", onVisualPaste, true);
}

if (typeof document !== "undefined") {
  document.addEventListener("selectionchange", rememberVisualSelection);
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
 * @param {{
 *   includeAccess?: boolean,
 *   includeCategories?: boolean,
 *   includeAuthor?: boolean,
 *   includeIaKeywords?: boolean,
 * }} [opts]
 */
export function editFingerprint(p = {}, opts = {}) {
  const includeAccess = opts.includeAccess !== false;
  const includeCategories = opts.includeCategories !== false;
  const includeAuthor = opts.includeAuthor !== false;
  const includeIaKeywords = opts.includeIaKeywords !== false;
  const cats = [...(p.categories || [])].map(String).filter(Boolean).sort();
  const kws = normalizeKeywordList(p.ia_keywords);
  const base = {
    title: String(p.title || "").trim(),
    body: cleanBody(p.body || ""),
    date: fingerprintDate(p.date),
  };
  if (includeIaKeywords) base.ia_keywords = kws;
  if (includeAuthor) base.author = String(p.author || "").trim();
  if (includeCategories) base.categories = cats;
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
 * Contenu éditorial dirty (titre / corps / date).
 * Accès, rubriques, auteur, mots-clés IA, épingle : ne comptent pas
 * comme « Mis à jour ».
 */
export function isEditorialContentDirty() {
  if (!state.article || state.view !== "edit") return false;
  if (!state.editBaseline) return false;
  const a = state.article;
  const d = a.data || {};
  const fpOpts = {
    includeAccess: false,
    includeCategories: false,
    includeAuthor: false,
    includeIaKeywords: false,
  };
  const baselineEditorial = editFingerprint(
    {
      title: d.title,
      body: a.body,
      date: d.date,
    },
    fpOpts
  );
  const titleEl = document.getElementById("f-title");
  const dateEl = document.getElementById("f-date");
  let date = d.date;
  if (!d.draft && dateEl && !dateEl.disabled && dateEl.value) {
    date = fromDatetimeLocalValue(dateEl.value) || date;
  }
  const currentEditorial = editFingerprint(
    {
      title: titleEl != null ? titleEl.value : d.title,
      body: getBodyFromDom(),
      date,
    },
    fpOpts
  );
  return currentEditorial !== baselineEditorial;
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
    if (!el) continue;
    if (id === "btn-push-now" && state.article?.data?.draft) {
      el.disabled = true;
      continue;
    }
    el.disabled = busy;
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
