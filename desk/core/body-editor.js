import {
  cleanHtml as cleanArticleHtml,
  ALIGN_CONTEXTS,
  ALIGN_BLOCK_TAGS,
  ALIGN_INLINE_TAGS,
  normalizeTextAlign,
} from "../html-clean.js";
import { stripLeadingChapoHtml } from "../excerpt.js";
import { hrefFrom } from "../paste-link.js";
import { deskConfirm, deskPrompt } from "../desk-dialog.js";
import { state } from "./state.js";
import {
  escapeHtml,
  toDatetimeLocalValue,
  fromDatetimeLocalValue,
  updateDateLabel,
} from "./format.js";
import { ctx } from "./ctx.js";
import { isPastEditorialUpdateGrace } from "../editorial-update.js";
import { normalizeAccess } from "../article-row.js";

/** Dernier couple brut → nettoyé (évite 3–6 passes identiques d’affilée). */
let cleanBodyCacheRaw = null;
let cleanBodyCacheOut = "";
/** Corps déjà normalisé au dernier chargement / enregistrement. */
let baselineCleanedBody = "";
/** true dès qu’on a touché le corps depuis la baseline. */
let bodyDomDirty = false;
let publishSyncRaf = 0;

const EDITORIAL_FP_OPTS = {
  includeAccess: false,
  includeCategories: false,
  includeAuthor: false,
  includeIaKeywords: false,
};

function noteBodyMutated() {
  bodyDomDirty = true;
  if (state.article && !state.article.data.draft) state.editDirty = true;
  paintPublishButton({ content: true, editorial: true });
}

export function markLiveBodyDirty() {
  noteBodyMutated();
}

/** Corps article : toujours via contexte desk (styles collés, data-pm, etc.). */
export function cleanBody(html) {
  const raw = typeof html === "string" ? html : "";
  if (raw === cleanBodyCacheRaw || raw === cleanBodyCacheOut) {
    return cleanBodyCacheOut;
  }
  const out = cleanArticleHtml(raw, "desk");
  cleanBodyCacheRaw = raw;
  cleanBodyCacheOut = out;
  return out;
}

/** Bouton Nettoyer — texte brut remis en paragraphes simples. */
function resetBody(html) {
  return cleanArticleHtml(html, "reset");
}

/** Collage extérieur — contexte paste (plus strict que desk). */
function cleanPaste(html) {
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

const ALIGN_BLOCK_SELECTOR = [...ALIGN_BLOCK_TAGS].join(",");
const ALIGN_INLINE_SELECTOR = [...ALIGN_INLINE_TAGS].join(",");

function renameBToStrong(ed) {
  for (const b of [...ed.querySelectorAll("b")]) {
    const strong = document.createElement("strong");
    for (const attr of b.attributes) {
      strong.setAttribute(attr.name, attr.value);
    }
    while (b.firstChild) strong.appendChild(b.firstChild);
    b.replaceWith(strong);
  }
}

function clearEmptyStyle(el) {
  if (!el.getAttribute("style")?.trim()) el.removeAttribute("style");
}

function readBlockAlign(el) {
  return normalizeTextAlign(el.style?.textAlign || el.getAttribute("align") || "");
}

function setBlockAlignStyle(el, value) {
  const next = normalizeTextAlign(value);
  el.removeAttribute("align");
  if (!next) el.style.removeProperty("text-align");
  else el.style.textAlign = next;
  clearEmptyStyle(el);
}

function liftInlineAlignInDom(ed) {
  for (const inline of [...ed.querySelectorAll(ALIGN_INLINE_SELECTOR)]) {
    const ta = normalizeTextAlign(inline.style?.textAlign);
    if (!ta) continue;
    const block = closestAlignBlock(inline, ed);
    if (block && !readBlockAlign(block)) setBlockAlignStyle(block, ta);
  }
  stripInlineAlign(ed);
}

function closestAlignBlock(node, editor) {
  if (!node || !editor) return null;
  let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  while (el && el !== editor) {
    if (
      el.nodeType === Node.ELEMENT_NODE &&
      ALIGN_BLOCK_TAGS.has(el.tagName.toLowerCase())
    ) {
      return el;
    }
    el = el.parentElement;
  }
  if (
    el === editor &&
    editor !== getVisualEditor() &&
    ALIGN_BLOCK_TAGS.has(editor.tagName.toLowerCase())
  ) {
    return editor;
  }
  return null;
}

function blocksFromSelection(editor) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return [];
  const range = sel.getRangeAt(0);
  const root = range.commonAncestorContainer;
  if (root !== editor && !editor.contains(root)) return [];

  const found = new Set();
  const addFrom = (node) => {
    const block = closestAlignBlock(node, editor);
    if (block) found.add(block);
  };
  addFrom(range.startContainer);
  addFrom(range.endContainer);

  if (!range.collapsed) {
    try {
      const walkerRoot =
        root.nodeType === Node.ELEMENT_NODE ? root : root.parentElement;
      if (walkerRoot && (walkerRoot === editor || editor.contains(walkerRoot))) {
        const walker = document.createTreeWalker(
          walkerRoot,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode(node) {
              return range.intersectsNode(node)
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_REJECT;
            },
          }
        );
        let n = walker.nextNode();
        while (n) {
          addFrom(n);
          n = walker.nextNode();
        }
      }
    } catch {
      /* intersectsNode selon les moteurs */
    }
  }

  if (!found.size) {
    const fallback = editor.querySelector(ALIGN_BLOCK_SELECTOR);
    if (fallback) found.add(fallback);
  }

  const list = [...found];
  return list.filter(
    (el) => !list.some((other) => other !== el && el.contains(other))
  );
}

function effectiveAlign(el) {
  return readBlockAlign(el) || "left";
}

/**
 * Alignement du bloc (pas de execCommand justify*).
 * context = 'left' | 'center' | 'right' — même bouton = retour à l’alignement normal.
 */
export function applyBlockAlign(context) {
  const key = String(context || "").toLowerCase();
  const cfg = ALIGN_CONTEXTS[key];
  if (!cfg) {
    throw new Error(
      `applyBlockAlign: contexte inconnu "${key}" (attendu: ${Object.keys(ALIGN_CONTEXTS).join(", ")})`
    );
  }
  const ed = getVisualEditor();
  if (!ed) return;
  ed.focus();
  const blocks = blocksFromSelection(ed);
  if (!blocks.length) return;

  const want = cfg.css;
  const allMatch = blocks.every((el) => effectiveAlign(el) === want);
  for (const block of blocks) {
    if (allMatch) setBlockAlignStyle(block, "");
    else setBlockAlignStyle(block, want);
    stripInlineAlign(block);
    tidyVisualInline(block);
    renameBToStrong(block);
  }
  noteBodyMutated();
}

function stripInlineAlign(root) {
  for (const inline of root.querySelectorAll(ALIGN_INLINE_SELECTOR)) {
    if (!normalizeTextAlign(inline.style?.textAlign)) continue;
    inline.style.removeProperty("text-align");
    clearEmptyStyle(inline);
  }
}

/** Déplie spans vides / gras dans gras — sans réécrire tout le HTML (curseur conservé). */
function tidyVisualInline(root = getVisualEditor()) {
  if (!root) return;
  liftInlineAlignInDom(root);
  for (const span of [...root.querySelectorAll("span")]) {
    if (span.hasAttributes()) continue;
    unwrapElement(span);
  }
  for (const inner of [...root.querySelectorAll("b b, strong strong, i i, em em")]) {
    unwrapElement(inner);
  }
}

function tidySelectionOrEditor(ed = getVisualEditor()) {
  if (!ed) return;
  const blocks = blocksFromSelection(ed);
  if (!blocks.length) {
    tidyVisualInline(ed);
    return;
  }
  for (const block of blocks) tidyVisualInline(block);
}

/** Gras / italique / liste — puis rangement léger. */
export function runEditorCommand(cmd, value) {
  exec(cmd, value);
  if (cmd !== "undo" && cmd !== "redo") tidySelectionOrEditor();
  noteBodyMutated();
}

/** formatBlock cross-browser (Chrome préfère `<h2>`). */
export function execFormatBlock(tag) {
  const t = String(tag || "p").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!t) return;
  ensureEditorCommands();
  if (!document.execCommand("formatBlock", false, `<${t}>`)) {
    document.execCommand("formatBlock", false, t);
  }
  tidySelectionOrEditor();
  noteBodyMutated();
}

/** Actions du menu au clic sur un texte lié. */
const LINK_MENU_ACTIONS = {
  remove: { label: "Retirer" },
  change: { label: "Modifier" },
  open: { label: "Ouvrir" },
};

const LINK_MENU_ID = "desk-link-menu";
/** @type {HTMLAnchorElement|null} */
let linkMenuAnchor = null;

function closestEditorLink(node, ed) {
  if (!ed || !node) return null;
  const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  const a = el?.closest?.("a");
  if (!a || !ed.contains(a)) return null;
  return a;
}

function hideLinkMenu() {
  if (!linkMenuAnchor) return;
  linkMenuAnchor = null;
  document.getElementById(LINK_MENU_ID)?.remove();
}

function placeLinkMenu(menu, a) {
  const r = a.getBoundingClientRect();
  const gap = 8;
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let top = r.bottom + gap;
  if (top + mh > window.innerHeight - 8) {
    top = Math.max(8, r.top - mh - gap);
  }
  let left = r.left;
  if (left + mw > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - mw - 8);
  }
  menu.style.top = `${Math.round(top)}px`;
  menu.style.left = `${Math.round(left)}px`;
}

function markEditorBodyDirty() {
  const ed = getVisualEditor();
  tidyVisualInline(ed);
  noteBodyMutated();
}

function unwrapEditorLink(a) {
  if (!a?.parentNode) return;
  const last = a.lastChild;
  unwrapElement(a);
  if (last) {
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.setStartAfter(last);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {
      /* curseur optionnel */
    }
  }
}

async function changeEditorLink(a) {
  const current = a.getAttribute("href") || "";
  const raw = await deskPrompt("URL du lien", {
    title: "Modifier le lien",
    placeholder: "https://…",
    defaultValue: current || "https://",
  });
  if (raw == null) return;
  const href = hrefFrom(raw, "prompt");
  if (!href) unwrapEditorLink(a);
  else a.setAttribute("href", href);
  markEditorBodyDirty();
}

function openEditorLink(a) {
  const href = hrefFrom(a.getAttribute("href") || "", "prompt");
  if (!href) return;
  if (href.startsWith("#")) return;
  window.open(href, "_blank", "noopener,noreferrer");
}

async function runLinkMenuAction(context, a) {
  const key = String(context || "").toLowerCase();
  if (!LINK_MENU_ACTIONS[key] || !a) return;
  hideLinkMenu();
  if (key === "remove") {
    unwrapEditorLink(a);
    markEditorBodyDirty();
    return;
  }
  if (key === "change") {
    await changeEditorLink(a);
    return;
  }
  if (key === "open") {
    openEditorLink(a);
  }
}

function showLinkMenu(a) {
  hideLinkMenu();
  if (!a?.isConnected) return;
  linkMenuAnchor = a;
  const href = a.getAttribute("href") || "";
  const menu = document.createElement("div");
  menu.id = LINK_MENU_ID;
  menu.className = "desk-link-menu";
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-label", "Lien");
  const actions = Object.entries(LINK_MENU_ACTIONS)
    .map(
      ([key, { label }]) =>
        `<button type="button" class="btn${
          key === "remove" ? " desk-link-menu__remove" : ""
        }" data-link-act="${escapeHtml(key)}">${escapeHtml(label)}</button>`
    )
    .join("");
  menu.innerHTML = `
    <p class="desk-link-menu__url" title="${escapeHtml(href)}">${escapeHtml(href)}</p>
    <div class="desk-link-menu__actions">${actions}</div>
  `;
  menu.addEventListener("mousedown", (e) => e.preventDefault());
  menu.querySelectorAll("[data-link-act]").forEach((btn) => {
    btn.addEventListener("click", () => {
      void runLinkMenuAction(btn.getAttribute("data-link-act"), a);
    });
  });
  document.body.appendChild(menu);
  placeLinkMenu(menu, a);
}

function onVisualLinkClick(e) {
  const ed = getVisualEditor();
  const a = closestEditorLink(e.target, ed);
  if (!a) {
    hideLinkMenu();
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  showLinkMenu(a);
}

function onDocPointerDownLinkMenu(e) {
  const menu = document.getElementById(LINK_MENU_ID);
  if (!menu) return;
  if (menu.contains(e.target)) return;
  if (closestEditorLink(e.target, getVisualEditor())) return;
  hideLinkMenu();
}

function onDocKeydownLinkMenu(e) {
  if (e.key === "Escape") hideLinkMenu();
}

function onViewportLinkMenu() {
  const menu = document.getElementById(LINK_MENU_ID);
  if (!menu || !linkMenuAnchor?.isConnected) {
    if (menu) hideLinkMenu();
    return;
  }
  placeLinkMenu(menu, linkMenuAnchor);
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

/** Corps pour empreinte. En mode léger, on ne lit pas le DOM. */
function readBodyForDirty(precise) {
  if (!precise || !bodyDomDirty) return baselineCleanedBody || "";
  const cleaned = getBodyFromDom();
  if (cleaned === baselineCleanedBody) bodyDomDirty = false;
  return cleaned;
}

/** Applique Nettoyer dans l’éditeur courant (sans save). */
export function applyBodyClean() {
  hideLinkMenu();
  if (state.mode === "visual") {
    const ed = getVisualEditor();
    if (!ed) return;
    const next = resetBody(ed.innerHTML) || "<p><br></p>";
    ed.innerHTML = next;
    if (state.article) state.article.body = next === "<p><br></p>" ? "" : next;
  } else if (state.mode === "html") {
    const el = getHtmlEditor();
    if (!el) return;
    el.value = resetBody(el.value);
    if (state.article) state.article.body = el.value;
  }
  noteBodyMutated();
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
  if (state.view !== "edit" || state.mode !== "visual") {
    lastVisualRange = null;
    return;
  }
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
  hideLinkMenu();
  noteBodyMutated();
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
  noteBodyMutated();
}

/** Écouteurs collage / liens — une fois par nœud éditeur. */
export function bindVisualEditorClipboard(ed) {
  if (!ed) return;
  hideLinkMenu();
  ensureEditorCommands();
  if (ed.dataset.deskEditorBound === "1") return;
  ed.dataset.deskEditorBound = "1";
  ed.addEventListener("input", () => {
    hideLinkMenu();
    noteBodyMutated();
  });
  ed.addEventListener("beforeinput", onVisualBeforeInput, true);
  ed.addEventListener("paste", onVisualPaste, true);
  ed.addEventListener("click", onVisualLinkClick);
  ed.addEventListener("auxclick", (e) => {
    if (closestEditorLink(e.target, ed)) e.preventDefault();
  });
  ed.addEventListener("scroll", hideLinkMenu, { passive: true });
}

if (typeof document !== "undefined") {
  document.addEventListener("selectionchange", rememberVisualSelection);
  document.addEventListener("pointerdown", onDocPointerDownLinkMenu, true);
  document.addEventListener("keydown", onDocKeydownLinkMenu);
  window.addEventListener("resize", onViewportLinkMenu);
}

/** Date comparable (datetime-local local, à la minute). */
function fingerprintDate(d) {
  if (d == null || d === "") return "";
  const raw = String(d);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    return raw.slice(0, 16);
  }
  return toDatetimeLocalValue(d) || "";
}

function normalizeKeywordList(list) {
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
function editFingerprint(p = {}, opts = {}) {
  const includeAccess = opts.includeAccess !== false;
  const includeCategories = opts.includeCategories !== false;
  const includeAuthor = opts.includeAuthor !== false;
  const includeIaKeywords = opts.includeIaKeywords !== false;
  const cats = [...(p.categories || [])].map(String).filter(Boolean).sort();
  const kws = normalizeKeywordList(p.ia_keywords);
  const base = {
    title: String(p.title || "").trim(),
    body: String(p.body || ""),
    date: fingerprintDate(p.date),
  };
  if (includeIaKeywords) base.ia_keywords = kws;
  if (includeAuthor) base.author = String(p.author || "").trim();
  if (includeCategories) base.categories = cats;
  if (includeAccess) base.access = normalizeAccess(p.access);
  return JSON.stringify(base);
}

function editFingerprintFromArticle(article, cleanedBody = null) {
  if (!article) return "";
  const d = article.data || {};
  return editFingerprint({
    title: d.title,
    body: cleanedBody != null ? cleanedBody : cleanBody(article.body || ""),
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
    state.editEditorialBaseline = "";
    state.editDirty = false;
    baselineCleanedBody = "";
    bodyDomDirty = false;
    return;
  }
  const cleanedBody = cleanBody(article.body || "");
  baselineCleanedBody = cleanedBody;
  bodyDomDirty = false;
  state.editBaseline = editFingerprintFromArticle(article, cleanedBody);
  const d = article.data || {};
  state.editEditorialBaseline = editFingerprint(
    { title: d.title, body: cleanedBody, date: d.date },
    EDITORIAL_FP_OPTS
  );
  state.editDirty = false;
}

function collectEditFields(precise) {
  const a = state.article;
  if (!a) return null;
  if (state.view !== "edit") {
    return {
      title: a.data.title,
      body: precise ? cleanBody(a.body || "") : baselineCleanedBody || "",
      author: a.data.author,
      date: a.data.date,
      categories: a.data.categories,
      access: a.data.access,
      ia_keywords: a.data.ia_keywords,
    };
  }
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
  return {
    title: titleEl != null ? titleEl.value : a.data.title,
    body: readBodyForDirty(precise),
    author: authorEl != null ? authorEl.value : a.data.author,
    date,
    categories: cats,
    access,
    ia_keywords,
  };
}

function dirtyFromFields(fields) {
  if (!fields || !state.editBaseline) return { content: false, editorial: false };
  return {
    content: editFingerprint(fields) !== state.editBaseline,
    editorial:
      Boolean(state.editEditorialBaseline) &&
      editFingerprint(
        { title: fields.title, body: fields.body, date: fields.date },
        EDITORIAL_FP_OPTS
      ) !== state.editEditorialBaseline,
  };
}

function evaluateEditDirty({ precise = false } = {}) {
  if (!state.article || state.view !== "edit" || !state.editBaseline) {
    return { content: false, editorial: false };
  }
  if (bodyDomDirty && !precise) return { content: true, editorial: true };
  return dirtyFromFields(collectEditFields(precise));
}

/** Empreinte déjà lue (collectForm) — pas de 2e lecture du corps. */
export function editDirtyFromPayload(payload) {
  if (!state.article || !state.editBaseline || !payload) {
    return { content: false, editorial: false };
  }
  return dirtyFromFields({
    title: payload.title,
    body: payload.body || "",
    author: payload.author,
    date: payload.date,
    categories: payload.categories,
    access: payload.access,
    ia_keywords: payload.ia_keywords,
  });
}

/** Titre / corps / metas modifiés depuis le dernier save / chargement. */
export function isEditContentDirty() {
  return evaluateEditDirty({ precise: true }).content;
}

/** Quitter l’édition : confirm si dirty (texte ou metas). */
export async function confirmLeaveEdit() {
  if (!isEditContentDirty()) return true;
  return deskConfirm(
    "Modifications non enregistrées. Quitter sans enregistrer ?",
    { title: "Modifications non enregistrées" }
  );
}

/** Publier actif : brouillon, ou article en ligne dont texte/metas ont changé. */
export function canClickPublish() {
  if (!state.article || !state.caps.publish || state.saving) return false;
  if (state.article.data.draft) return true;
  return Boolean(state.editDirty);
}

/** Article en ligne hors délai de grâce → une validation compte comme mise à jour. */
export function isPublishUpdateAction(dirty) {
  const d = dirty || evaluateEditDirty({ precise: true });
  return Boolean(
    state.article &&
      !state.article.data.draft &&
      isPastEditorialUpdateGrace(state.article.data.date) &&
      d.editorial
  );
}

/** Libellé Publier : « Mis à jour » si en ligne, dirty éditorial, et ≥ 45 min après publication. */
export function publishButtonLabel(dirty) {
  const d = dirty || evaluateEditDirty({ precise: false });
  if (!state.article) return "Publier";
  if (state.article.data.draft) return "Publier";
  if (!d.content) return "Publier";
  return isPublishUpdateAction(d) ? "Mis à jour" : "Publier";
}

function paintPublishButton(dirty) {
  const btn = document.getElementById("btn-publish");
  if (!btn) return;
  const ok = canClickPublish();
  const label = publishButtonLabel(dirty);
  btn.disabled = !ok || state.saving;
  btn.textContent = label;
  btn.title = ok
    ? label
    : "Déjà publié — modifiez le texte ou les métas pour mettre à jour";
}

export function syncPublishButton({ precise = false, dirty } = {}) {
  if (publishSyncRaf) {
    cancelAnimationFrame(publishSyncRaf);
    publishSyncRaf = 0;
  }
  const next = dirty || evaluateEditDirty({ precise });
  if (!state.article || state.article.data.draft) {
    state.editDirty = false;
  } else {
    state.editDirty = next.content;
  }
  paintPublishButton(next);
}

/** Titre / metas : compare sans relire le corps. */
export function scheduleSyncPublishButton() {
  if (publishSyncRaf) return;
  publishSyncRaf = requestAnimationFrame(() => {
    publishSyncRaf = 0;
    syncPublishButton({ precise: false });
  });
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

function paintEditTopMeta() {
  const meta = document.querySelector(".main-edit .topbar .meta");
  if (!meta || !state.article) return;
  const d = state.article.data;
  meta.textContent = `#${d.article_id} · ${d.draft ? "brouillon" : "en ligne"}`;
}

function paintModifiedLabel() {
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
function paintDateField() {
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

function paintDraftButton() {
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

function paintKeywordsFromArticle() {
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
  noteBodyMutated();
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
    noteBodyMutated();
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
    if (state.article) state.article.body = html;
  }
  noteBodyMutated();
}

export function stripTagsPlain(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
