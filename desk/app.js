import { stripLeadingChapoHtml, chapo } from "./excerpt.js";
import { cleanHtml as cleanArticleHtml } from "./html-clean.js";
import { applyDeskUiTokens } from "./ui.js";

applyDeskUiTokens();

/** Fallback si API rubriques indisponible */
const FALLBACK_RUBRICS = [
  { value: "web_1_2_3", label: "Web 1,2,3" },
  { value: "so_cult", label: "Culture" },
  { value: "peer2peer", label: "Piratage" },
  { value: "old_fashion_media", label: "Médias" },
  { value: "so_amazing", label: "High-Tech" },
  { value: "robotic", label: "Robotic" },
  { value: "gaming", label: "Gaming" },
  { value: "le_flouze", label: "Économie" },
  { value: "politique", label: "Politique" },
  { value: "marketing_room", label: "Marketing" },
  { value: "paper", label: "Papers" },
];

const ROLE_LABELS = {
  admin: "Admin",
  editor: "Éditeur",
  author: "Auteur",
  subscriber: "Abonné",
  other: "Autre",
};

const STATUS_LABELS = {
  active: "Actif",
  disabled: "Désactivé",
  expired: "Expiré",
};

function purifyHtml(html) {
  const raw = String(html || "");
  if (typeof DOMPurify === "undefined") return raw;
  return DOMPurify.sanitize(raw, {
    ADD_ATTR: ["target", "rel"],
  });
}

/** URL publique article (enregistré) : /articles/{id}-{slug}/ */
function articlePublicPath(article) {
  const d = article?.data;
  if (!d?.wp_id || !d?.slug) return "";
  return `/articles/${d.wp_id}-${d.slug}/`;
}

/**
 * Document HTML pour l’iframe Aperçu — CSS site (single article).
 * previewView: "full" (abonné / éditeur) | "visitor" (teaser paywall si accès abonnés).
 */
function buildArticlePreviewDoc({
  title = "",
  body = "",
  author = "",
  date = null,
  categories = [],
  categoryNames = [],
  updateLabel = "",
  access = "subscribers",
  previewView = "full",
  excerpt = "",
} = {}) {
  const safeTitle = escapeHtml(title || "Sans titre");
  const safeBody = purifyHtml(cleanBody(body) || "<p><em>Vide</em></p>");
  const showPaywall =
    previewView === "visitor" && String(access) !== "granted";
  const teaserText =
    String(excerpt || "").trim() ||
    extractLeadingChapo(body) ||
    stripTagsPlain(stripLeadingChapoHtml(body)).split(/\s+/).slice(0, 55).join(" ");
  const dateLabel = formatDate(date) || "—";
  const dateIso =
    date != null && date !== ""
      ? (() => {
          const dt = new Date(date);
          return Number.isNaN(dt.getTime()) ? "" : dt.toISOString();
        })()
      : "";
  const authorLi = author
    ? `<li class="post-author"><span>${escapeHtml(author)}</span></li>`
    : "";
  const updatedBlock = updateLabel
    ? `<p class="post-updated"><time>${escapeHtml(`Mis à jour le ${updateLabel}`)}</time></p>`
    : "";
  const catLinks = (categories || [])
    .map((slug, i) => {
      const name = categoryNames[i] || catLabel(slug) || slug;
      return `<a href="/articles/category/${escapeHtml(slug)}/">${escapeHtml(name)}</a>`;
    })
    .join("");
  const catBlock = catLinks
    ? `<div class="category">${catLinks}</div>`
    : "";

  const contentBlock = showPaywall
    ? `<div class="el-article__teaser">
        ${
          teaserText
            ? `<p class="el-article-chapo el-article-chapo--teaser">${escapeHtml(teaserText)}</p>`
            : ""
        }
        <div class="el-paywall abonnement-cta">
          <p>Cet article est réservé aux abonnés ElectronLibre.</p>
          <a class="btn-subscribe" href="/login/">Connexion</a>
          <a class="btn-subscribe" href="/abonnement/">Je m’abonne</a>
        </div>
      </div>`
    : `<div class="inner-article-content entry-content">${safeBody}</div>`;

  const css = [
    "/css/el/el-tokens.css",
    "/css/el/el-reset.css",
    "/css/el/el-global.css",
    "/css/el/el-article.css",
    "/css/el/single.css",
  ]
    .map((href) => `<link rel="stylesheet" href="${href}" />`)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<base target="_blank" />
${css}
<style>
  html, body { margin: 0; min-height: 100%; }
  body.el-single-page {
    background: var(--el-surface-alt, #f6f7f9);
    padding: 20px 16px 40px;
  }
  .desk-preview-wrap {
    max-width: 720px;
    margin: 0 auto;
  }
</style>
</head>
<body class="el-single-page">
  <div class="desk-preview-wrap">
    <article class="news-snippet el-single-article-card">
      <div class="ihead info">
        <ul class="list-inline">
          <li><time${dateIso ? ` datetime="${escapeHtml(dateIso)}"` : ""}>${escapeHtml(dateLabel)}</time></li>
          ${authorLi}
        </ul>
        ${updatedBlock}
      </div>
      <h1 class="news-title page-title">${safeTitle}</h1>
      ${catBlock}
      ${contentBlock}
    </article>
  </div>
</body>
</html>`;
}

/** Remplit l’iframe Aperçu depuis le brouillon local. */
function fillArticlePreviewFrame() {
  const frame = document.getElementById("article-preview-frame");
  if (!frame || !state.article) return;
  const d = state.article.data;
  const body = state.article.body || "";
  const excerpt =
    String(d.excerpt || "").trim() || chapo(body, "store") || "";
  frame.srcdoc = buildArticlePreviewDoc({
    title: d.title,
    body,
    author: d.author || "",
    date: d.draft ? null : d.date,
    categories: d.categories || [],
    categoryNames: d.category_names || [],
    updateLabel: updateDateLabel(d),
    access: d.access || "subscribers",
    previewView: state.previewView || "full",
    excerpt,
  });
}

/** Flush champs édition vers state avant re-render (changement d’onglet). */
function flushEditFormToState() {
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

const state = {
  user: null,
  caps: { manageUsers: false, editAll: false, publish: false, audience: false },
  view: "list", // list | edit | users | user-edit | newsletter | audience | media | login
  /** Rubriques (chips) — chargées via GET /api/desk/categories */
  rubrics: null,
  articles: [],
  total: 0,
  page: 1,
  limit: 25,
  pages: 1,
  q: "",
  filterDraft: "",
  article: null,
  /** Empreinte titre+corps après chargement / enregistrement / publish — pour griser Publier. */
  editBaseline: "",
  editDirty: false,
  mode: "visual", // visual | html | preview
  /** Aperçu : "full" (corps) | "visitor" (teaser paywall si abonnés). */
  previewView: "full",
  users: [],
  usersTotal: 0,
  usersQ: "",
  usersRole: "",
  usersStatus: "",
  usersMeta: { roles: ["subscriber", "other"], statuses: ["active", "disabled", "expired"] },
  authorPick: null, // { name, slug, userId } depuis l’autocomplete
  editUser: null, // null = create
  generatedPassword: "",
  /** true = panneau de confirmation suppression compte affiché */
  userDeleteConfirm: false,
  nlDate: new Date().toISOString().slice(0, 10),
  // Défaut sûr : admin seulement (évite l’envoi « tout le monde » par oubli de décocher)
  nlGroups: { admin: true, redacteurs: false, abonnes: false },
  nlPreview: null,
  nlHistory: [],
  nlDryRun: true,
  audData: null,
  audChart: null,
  status: "",
  error: "",
  saving: false,
  translating: false,
  generatingKeywords: false,
  assisting: false, // corriger | reformuler | chapo
  x: {
    account: "el",
    text: "",
    variants: [],
    loading: false,
    busy: "", // generate
  },
  mediaPicker: {
    open: false,
    q: "",
    page: 1,
    pages: 1,
    total: 0,
    items: [],
    loading: false,
    uploading: false,
    error: "",
    alt: "",
    selectedId: null,
    status: "",
  },
  _searchTimers: {},
  _searchSeq: { users: 0, list: 0, listAc: 0, usersAc: 0, authors: 0 },
  _ac: {}, // états autocomplétion générique (createAutocomplete)
};

const app = document.getElementById("app");

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** Upload multipart (ne pas forcer Content-Type JSON). */
async function apiForm(path, formData) {
  const res = await fetch(path, {
    credentials: "same-origin",
    method: "POST",
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function catLabel(slug) {
  return rubricList().find((c) => c.value === slug)?.label || slug;
}

function rubricList() {
  return state.rubrics && state.rubrics.length
    ? state.rubrics
    : FALLBACK_RUBRICS;
}

async function loadRubrics({ force = false } = {}) {
  if (!force && state.rubrics && state.rubrics.length) return state.rubrics;
  try {
    const data = await api("/api/desk/categories");
    state.rubrics = (data.categories || []).map((c) => ({
      value: String(c.slug),
      label: String(c.name),
    }));
  } catch {
    if (!state.rubrics) state.rubrics = FALLBACK_RUBRICS.slice();
  }
  return state.rubrics;
}

async function createRubric() {
  const name = window.prompt("Nom de la nouvelle rubrique :");
  if (name == null) return;
  const label = String(name).trim();
  if (!label) return;
  state.error = "";
  try {
    const data = await api("/api/desk/categories", {
      method: "POST",
      body: JSON.stringify({ name: label }),
    });
    const cat = data.category;
    if (!cat?.slug) throw new Error("Réponse invalide");
    await loadRubrics({ force: true });
    if (state.article?.data) {
      const cats = new Set((state.article.data.categories || []).map(String));
      cats.add(cat.slug);
      state.article.data.categories = [...cats];
      state.article.data.category_names = state.article.data.categories.map(
        (s) => (s === cat.slug ? cat.name : catLabel(s))
      );
      onEditDirty();
    }
    state.status = `Rubrique « ${cat.name} » créée — archive et menu site actifs`;
    render();
  } catch (err) {
    state.error = err.message || "Création rubrique impossible";
    render();
  }
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Groupe de boutons filtre (remplace les <select>). */
function filterChips(ariaLabel, options, activeValue, dataAttr) {
  const buttons = options
    .map(([value, label]) => {
      const active = String(activeValue ?? "") === String(value);
      return `<button type="button" class="chip${active ? " is-active" : ""}" data-${dataAttr}="${escapeHtml(String(value))}" aria-pressed="${active ? "true" : "false"}">${escapeHtml(label)}</button>`;
    })
    .join("");
  return `<div class="filter-chips" role="group" aria-label="${escapeHtml(ariaLabel)}">${buttons}</div>`;
}

function formatDate(d) {
  if (d == null || d === "") return "";
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return "";
    return dt.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function formatDateTime(d) {
  if (d == null || d === "") return "";
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return "";
    return dt.toLocaleString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** Valeur pour <input type="datetime-local"> en heure locale (pas UTC). */
function toDatetimeLocalValue(d) {
  if (d == null || d === "") return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

/** Parse datetime-local (heure locale) → ISO UTC pour l’API. */
function fromDatetimeLocalValue(s) {
  const raw = String(s || "").trim();
  if (!raw) return null;
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

/** Mise à jour éditoriale : uniquement articles en ligne, si ≠ date de publication. */
function updateDateLabel(d) {
  if (d?.draft) return "";
  if (!d?.date || !d?.modified) return "";
  const pub = new Date(d.date).getTime();
  const mod = new Date(d.modified).getTime();
  if (Number.isNaN(pub) || Number.isNaN(mod)) return "";
  if (mod - pub < 2 * 60 * 1000) return "";
  return formatDateTime(d.modified);
}

/** Corps article : toujours via contexte desk (styles collés, data-pm, etc.). */
function cleanBody(html) {
  return cleanArticleHtml(html, "desk");
}

function exec(cmd, value) {
  document.execCommand(cmd, false, value);
}

/** formatBlock cross-browser (Chrome préfère `<h2>`). */
function execFormatBlock(tag) {
  const t = String(tag || "p").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!t) return;
  if (!document.execCommand("formatBlock", false, `<${t}>`)) {
    document.execCommand("formatBlock", false, t);
  }
}

function getVisualEditor() {
  return document.getElementById("visual-editor");
}

function getHtmlEditor() {
  return document.getElementById("html-editor");
}

/** Lit le corps depuis l’UI et le normalise (visuel + HTML). */
function getBodyFromDom() {
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
function applyBodyClean() {
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
function onVisualPaste(e) {
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
 */
function editFingerprint(p = {}) {
  const cats = [...(p.categories || [])].map(String).filter(Boolean).sort();
  const kws = normalizeKeywordList(p.ia_keywords);
  return JSON.stringify({
    title: String(p.title || "").trim(),
    body: cleanBody(p.body || ""),
    author: String(p.author || "").trim(),
    date: fingerprintDate(p.date),
    categories: cats,
    access: p.access === "granted" ? "granted" : "subscribers",
    ia_keywords: kws,
  });
}

function editFingerprintFromArticle(article) {
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

function setEditBaselineFromArticle(article = state.article) {
  if (!article) {
    state.editBaseline = "";
    state.editDirty = false;
    return;
  }
  state.editBaseline = editFingerprintFromArticle(article);
  state.editDirty = false;
}

function currentEditFingerprint() {
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
function isEditContentDirty() {
  if (!state.article || state.view !== "edit") return false;
  if (!state.editBaseline) return false;
  return currentEditFingerprint() !== state.editBaseline;
}

function refreshEditDirty() {
  if (!state.article || state.article.data.draft) {
    state.editDirty = false;
    return;
  }
  state.editDirty = isEditContentDirty();
}

/** Quitter l’édition : confirm si dirty (texte ou metas). */
function confirmLeaveEdit() {
  if (!isEditContentDirty()) return true;
  return confirm(
    "Modifications non enregistrées. Quitter sans enregistrer ?"
  );
}

/** Publier actif : brouillon, ou article en ligne dont texte/metas ont changé. */
function canClickPublish() {
  if (!state.article || !state.caps.publish || state.saving) return false;
  if (state.article.data.draft) return true;
  return Boolean(state.editDirty);
}

function syncPublishButton() {
  refreshEditDirty();
  const btn = document.getElementById("btn-publish");
  if (!btn) return;
  const ok = canClickPublish();
  btn.disabled = !ok || state.saving;
  btn.title = ok
    ? "Publier"
    : "Déjà publié — modifiez le texte ou les métas pour republier";
}

/** Messages sous l’éditeur — sans reconstruire le DOM. */
function paintEditMessages() {
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
function setEditBusy(busy) {
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

function paintEditTopMeta() {
  const meta = document.querySelector(".main-edit .topbar .meta");
  if (!meta || !state.article) return;
  const d = state.article.data;
  meta.textContent = `#${d.wp_id} · ${d.draft ? "brouillon" : "en ligne"}`;
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
function paintEditAfterMutation({ fullIfDraftFlip = false, wasDraft = false } = {}) {
  const nowDraft = Boolean(state.article?.data?.draft);
  if (fullIfDraftFlip && wasDraft && !nowDraft) {
    // brouillon → en ligne : bouton push, date éditable, etc.
    render();
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
function extractLeadingChapo(html) {
  const m = String(html || "").match(
    /^\s*<p[^>]*>\s*<strong>([\s\S]*?)<\/strong>\s*<\/p>/i
  );
  return m ? stripTagsPlain(m[1]) : "";
}

function insertChapoAtTop(chapoPlain) {
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
    render();
    return;
  }
  state.article.body = next;
}

function collectForm() {
  const a = state.article;
  if (!a) return null;
  const cats = [...document.querySelectorAll("#chips .chip.on")].map(
    (el) => el.dataset.value
  );
  const iaRaw = document.getElementById("f-ia")?.value || "";
  const authorName =
    document.getElementById("f-author")?.value?.trim() || a.data.author || "";
  const pick =
    state.authorPick &&
    String(state.authorPick.name || "").trim().toLowerCase() ===
      authorName.toLowerCase()
      ? state.authorPick
      : null;
  const body = getBodyFromDom();
  const access = document.getElementById("f-access")?.value || "subscribers";
  // Mots-clés IA : abonnés seulement, générés à la demande (pas l’héritage WP)
  const ia_keywords =
    access === "granted"
      ? []
      : iaRaw
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
  return {
    title: document.getElementById("f-title")?.value?.trim() || a.data.title,
    excerpt: chapo(body, "store"),
    body,
    author: authorName,
    author_slug: pick?.slug || undefined,
    author_user_id: pick?.userId != null ? pick.userId : pick ? null : undefined,
    // Brouillon : conserver la date de 1ʳᵉ publication (ne pas l’effacer à l’enregistrement).
    date: a.data.draft
      ? a.data.date || null
      : document.getElementById("f-date")?.value
        ? fromDatetimeLocalValue(document.getElementById("f-date").value)
        : a.data.date || null,
    categories: cats,
    category_names: cats.map(catLabel),
    ia_keywords,
    // Langue gérée via le panneau Version UK (pas de sélecteur ici)
    lang: a.data.lang || "fr",
    access,
    // Brouillon géré par le bouton dédié (effet immédiat) — pas via Enregistrer
  };
}

/** Texte source pour Corriger / Reformuler (sélection ou corps entier). */
function getAssistSourceText() {
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

function assistResultToHtml(text) {
  const t = String(text || "").trim();
  if (!t) return "";
  if (/<[a-z][\s\S]*>/i.test(t)) return cleanBody(t);
  return t
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function replaceSelectionOrBody(html) {
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

function stripTagsPlain(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function runEditorialAssist(type) {
  if (!state.article || state.assisting || state.saving) return;
  const wpId = state.article.data.wp_id;
  let text = "";
  if (type === "chapo") {
    const title =
      document.getElementById("f-title")?.value?.trim() ||
      state.article.data.title ||
      "";
    const body = getBodyFromDom();
    const plain = stripTagsPlain(stripLeadingChapoHtml(body));
    if (!plain) {
      state.error = "Texte requis pour générer le chapô";
      const errLine = document.getElementById("edit-error");
      if (errLine) {
        errLine.hidden = false;
        errLine.textContent = state.error;
      }
      return;
    }
    // Corps tronqué : le modèle n’a pas besoin de l’article entier pour un chapô.
    const bodyForChapo =
      plain.length > 4500 ? `${plain.slice(0, 4500).trim()}…` : plain;
    text = title ? `Titre : ${title}\n\n${bodyForChapo}` : bodyForChapo;
    if (extractLeadingChapo(body)) {
      const ok = confirm("Remplacer le chapô en tête d’article ?");
      if (!ok) return;
    }
  } else {
    text = getAssistSourceText();
    if (!stripTagsPlain(text) && !String(text || "").trim()) {
      state.error = "Sélectionnez un passage ou rédigez le corps d’abord";
      const errLine = document.getElementById("edit-error");
      if (errLine) {
        errLine.hidden = false;
        errLine.textContent = state.error;
      }
      return;
    }
  }

  state.assisting = true;
  state.error = "";
  const labels = {
    corriger: "Correction…",
    reformuler: "Reformulation…",
    chapo: "Génération du chapô…",
  };
  state.status = labels[type] || "IA…";
  const statusEl = document.getElementById("edit-status");
  if (statusEl) {
    statusEl.hidden = false;
    statusEl.className = "ok";
    statusEl.textContent = state.status;
  }
  document.querySelectorAll("[data-assist]").forEach((btn) => {
    btn.disabled = true;
  });
  try {
    const data = await api("/api/desk/assist", {
      method: "POST",
      body: JSON.stringify({ type, text, wpId }),
    });
    const out = String(data.text || "").trim();
    const modelHint = data.model ? ` (${data.model})` : "";
    if (type === "chapo") {
      insertChapoAtTop(out);
      state.status = `Chapô inséré en tête${modelHint} — Enregistrer pour publier`;
    } else {
      replaceSelectionOrBody(assistResultToHtml(out));
      state.status =
        (type === "corriger" ? "Correction appliquée" : "Reformulation appliquée") +
        modelHint;
    }
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.className = "ok";
      statusEl.textContent = state.status;
    }
  } catch (err) {
    state.error = err.message || "Échec IA";
    state.status = "";
    const errLine = document.getElementById("edit-error");
    if (errLine) {
      errLine.hidden = false;
      errLine.textContent = state.error;
    }
  } finally {
    state.assisting = false;
    document.querySelectorAll("[data-assist]").forEach((btn) => {
      btn.disabled = false;
    });
  }
}

function desiredViewFromUrl() {
  try {
    const v = new URLSearchParams(location.search).get("view") || "";
    if (
      v === "newsletter" ||
      v === "audience" ||
      v === "users" ||
      v === "media" ||
      v === "list"
    ) {
      return v;
    }
  } catch {
    /* ignore */
  }
  return "list";
}

function syncViewToUrl(view) {
  try {
    const url = new URL(location.href);
    if (!view || view === "list" || view === "login" || view === "edit" || view === "user-edit") {
      url.searchParams.delete("view");
    } else {
      url.searchParams.set("view", view);
    }
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  } catch {
    /* ignore */
  }
}

async function openDesiredView() {
  const wanted = desiredViewFromUrl();
  if (wanted === "newsletter" && (state.caps.newsletter || state.caps.publish)) {
    state.view = "newsletter";
    syncViewToUrl("newsletter");
    await loadNewsletter();
    return;
  }
  if (wanted === "audience" && (state.caps.audience || state.caps.publish)) {
    state.view = "audience";
    syncViewToUrl("audience");
    await loadAudience();
    return;
  }
  if (wanted === "users" && state.caps.manageUsers) {
    state.view = "users";
    syncViewToUrl("users");
    await loadUsers();
    return;
  }
  if (wanted === "media") {
    state.view = "media";
    syncViewToUrl("media");
    await loadMediaLibrary();
    return;
  }
  state.view = "list";
  syncViewToUrl("list");
  await loadList();
}

async function bootstrap() {
  try {
    const me = await api("/api/auth/me");
    if (!me.authenticated || !me.desk) {
      state.view = "login";
      state.user = me.user || null;
      render();
      return;
    }
    state.user = me.user;
    try {
      const deskMe = await api("/api/desk/me");
      state.caps = deskMe.capabilities || state.caps;
      if (deskMe.user) state.user = { ...state.user, ...deskMe.user };
    } catch {
      /* ignore */
    }
    await loadRubrics();
    await openDesiredView();
  } catch {
    state.view = "login";
    render();
  }
}

function navTabs(active) {
  const usersTab = state.caps.manageUsers
    ? `<button type="button" class="nav-tab ${active === "users" ? "active" : ""}" data-nav="users">Comptes</button>`
    : "";
  const nlTab = state.caps.newsletter || state.caps.publish
    ? `<button type="button" class="nav-tab ${active === "newsletter" ? "active" : ""}" data-nav="newsletter">Newsletter</button>`
    : "";
  const audTab = state.caps.audience || state.caps.publish
    ? `<button type="button" class="nav-tab ${active === "audience" ? "active" : ""}" data-nav="audience">Audience</button>`
    : "";
  const mediaTab = `<button type="button" class="nav-tab ${active === "media" ? "active" : ""}" data-nav="media">Documents</button>`;
  return `
    <nav class="desk-nav" aria-label="Sections">
      <button type="button" class="nav-tab ${active === "list" ? "active" : ""}" data-nav="list">Articles</button>
      ${mediaTab}
      ${nlTab}
      ${audTab}
      ${usersTab}
    </nav>`;
}

function bindNav() {
  app.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.onclick = async () => {
      const nav = btn.dataset.nav;
      state.error = "";
      state.status = "";
      if (nav === "users") {
        state.view = "users";
        syncViewToUrl("users");
        await loadUsers();
      } else if (nav === "newsletter") {
        state.view = "newsletter";
        syncViewToUrl("newsletter");
        await loadNewsletter();
      } else if (nav === "audience") {
        state.view = "audience";
        syncViewToUrl("audience");
        await loadAudience();
      } else if (nav === "media") {
        state.view = "media";
        syncViewToUrl("media");
        await loadMediaLibrary();
      } else {
        state.view = "list";
        state.editUser = null;
        syncViewToUrl("list");
        await loadList();
      }
    };
  });
}

function selectedNlGroups() {
  return Object.entries(state.nlGroups)
    .filter(([, on]) => on)
    .map(([k]) => k);
}

const NL_GROUP_LABELS = {
  admin: "Admin",
  redacteurs: "Rédacteurs",
  abonnes: "Abonnés",
};

async function loadNewsletter() {
  state.error = "";
  try {
    const data = await api("/api/desk/newsletter");
    state.nlHistory = data.newsletters || [];
    state.nlDryRun = Boolean(data.brevoDryRun);
    // Génère tout de suite (plus besoin de l’ancienne page WP)
    await generateNewsletter({ silent: true });
  } catch (err) {
    state.error = err.message || "Erreur newsletter";
    render();
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
    render();
    return;
  }
  if (!silent) state.status = "Génération…";
  state.saving = true;
  if (!silent) render();
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
    render();
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
    render();
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
  render();
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
    render();
  }
}

function renderNewsletter() {
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
    ${navTabs("newsletter")}
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
  bindNav();
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


function formatInt(n) {
  if (n == null || Number.isNaN(Number(n))) return "–";
  return Number(n).toLocaleString("fr-FR");
}

async function loadAudience({ refresh = false } = {}) {
  state.error = "";
  state.status = refresh ? "Rafraîchissement…" : "";
  state.saving = true;
  render();
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
    render();
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

function renderAudience() {
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
    ${navTabs("audience")}
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
  bindNav();
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

function debounceSearch(key, fn, waitMs = 220) {
  clearTimeout(state._searchTimers[key]);
  state._searchTimers[key] = setTimeout(fn, waitMs);
}

/**
 * Dropdown suggestions partagé (liste articles, comptes, champs…).
 * mapItem → { title, sub?, attrs? } (attrs = data-* additionnels)
 */
function suggestDropdownHtml(id, items, activeIndex, mapItem, { limit = 8 } = {}) {
  if (!items?.length) return "";
  const rows = items.slice(0, limit).map((item, i) => {
    const m = mapItem(item, i) || {};
    const active = i === activeIndex ? " is-active" : "";
    return `<button type="button" class="search-suggest__item${active}" ${m.attrs || ""} role="option" aria-selected="${
      i === activeIndex ? "true" : "false"
    }">
      <strong>${escapeHtml(m.title || "")}</strong>
      ${m.sub ? `<span>${escapeHtml(m.sub)}</span>` : ""}
    </button>`;
  });
  return `<div class="search-suggest" id="${escapeHtml(id)}" role="listbox">${rows.join("")}</div>`;
}

/**
 * Autocomplétion générique selon le contexte (fetch + clavier + dropdown).
 *
 * opts:
 * - key, wrapId, suggestId?, limit?, minChars?, suggestMinChars?, debounceMs?, openOnFocus?
 * - fetchItems(q) → items
 * - mapItem(item, i) → { title, sub?, attrs? }
 * - onPick(item)
 * - onInput?(q)
 * - afterFetch?(items, q)
 */
function createAutocomplete(opts) {
  const key = opts.key;
  const suggestId = opts.suggestId || `${key}-suggest`;
  const limit = opts.limit ?? 10;
  const minChars = opts.minChars ?? 0;
  const suggestMinChars = opts.suggestMinChars ?? minChars;
  const debounceMs = opts.debounceMs ?? 180;
  const openOnFocus = opts.openOnFocus !== false;

  if (!state._ac[key]) {
    state._ac[key] = { open: false, index: -1, items: [], q: "" };
  }
  const ac = () => state._ac[key];

  function shouldOpen(q, items) {
    return Boolean(items?.length) && String(q || "").trim().length >= suggestMinChars;
  }

  function html() {
    const s = ac();
    if (!s.open || !s.items.length) return "";
    return suggestDropdownHtml(
      suggestId,
      s.items,
      s.index,
      (item, i) => {
        const m = opts.mapItem(item, i) || {};
        return {
          title: m.title,
          sub: m.sub,
          attrs: `data-ac-key="${escapeHtml(key)}" data-ac-pick="${i}" ${m.attrs || ""}`,
        };
      },
      { limit }
    );
  }

  function bindPicks(root) {
    root?.querySelectorAll(`[data-ac-key="${key}"][data-ac-pick]`).forEach((btn) => {
      btn.onmousedown = (e) => e.preventDefault();
      btn.onclick = () => pick(Number(btn.dataset.acPick));
    });
  }

  function patch() {
    const wrap = document.getElementById(opts.wrapId);
    if (!wrap) return;
    document.getElementById(suggestId)?.remove();
    const markup = html();
    if (markup) {
      wrap.insertAdjacentHTML("beforeend", markup);
      bindPicks(wrap);
    }
  }

  function pick(index) {
    const item = ac().items[index];
    if (!item) return;
    ac().open = false;
    ac().index = -1;
    opts.onPick(item);
    patch();
  }

  function prepare(items, q = "") {
    ac().q = String(q || "");
    ac().items = items || [];
    ac().open = shouldOpen(ac().q, ac().items);
    ac().index = -1;
  }

  function syncItems(items, q = ac().q) {
    prepare(items, q);
    patch();
  }

  function close() {
    ac().open = false;
    ac().index = -1;
    patch();
  }

  async function load(raw) {
    if (state._searchSeq[key] == null) state._searchSeq[key] = 0;
    const seq = (state._searchSeq[key] += 1);
    const q = String(raw || "").trim();
    ac().q = q;
    if (q.length < minChars) {
      ac().items = [];
      ac().open = false;
      ac().index = -1;
      patch();
      opts.afterFetch?.([], q);
      return;
    }
    try {
      const items = (await opts.fetchItems(q)) || [];
      if (seq !== state._searchSeq[key]) return;
      ac().items = items;
      ac().open = shouldOpen(q, items);
      ac().index = -1;
      opts.afterFetch?.(items, q);
      patch();
    } catch {
      if (seq !== state._searchSeq[key]) return;
      ac().items = [];
      ac().open = false;
      ac().index = -1;
      opts.afterFetch?.([], q);
      patch();
    }
  }

  function schedule(raw) {
    opts.onInput?.(String(raw || ""));
    debounceSearch(key, () => load(raw), debounceMs);
  }

  function reset() {
    ac().items = [];
    ac().open = false;
    ac().index = -1;
    ac().q = "";
  }

  function bindInput(input) {
    if (!input) return;
    bindSuggestKeyboard(input, {
      getOpen: () => ac().open,
      setOpen: (v) => {
        ac().open = v;
      },
      getIndex: () => ac().index,
      setIndex: (v) => {
        ac().index = v;
      },
      getItems: () => ac().items.slice(0, limit),
      onPick: (item) => {
        const idx = ac().items.indexOf(item);
        pick(idx >= 0 ? idx : 0);
      },
      onClose: () => patch(),
    });
    input.oninput = (e) => schedule(e.target.value);
    if (openOnFocus) {
      input.onfocus = () => {
        load(input.value);
      };
    }
    bindPicks(document.getElementById(opts.wrapId));
  }

  return {
    html,
    patch,
    pick,
    load,
    schedule,
    bindInput,
    reset,
    close,
    prepare,
    syncItems,
  };
}

/** Autocomplete auteur (articles + comptes rédaction). */
const authorAc = createAutocomplete({
  key: "authors",
  wrapId: "author-search-wrap",
  suggestId: "author-suggest",
  limit: 10,
  minChars: 0,
  suggestMinChars: 0,
  openOnFocus: true,
  debounceMs: 180,
  fetchItems: async (q) => {
    const params = new URLSearchParams({ limit: "12" });
    if (q) params.set("q", q);
    const data = await api(`/api/desk/authors?${params}`);
    return data.authors || [];
  },
  mapItem: (a) => ({
    title: a.name,
    sub:
      a.source === "user"
        ? a.slug
          ? `@${a.slug}`
          : "compte"
        : "auteur",
  }),
  onPick: (a) => {
    state.authorPick = {
      name: a.name,
      slug: a.slug || "",
      userId: a.userId != null ? a.userId : null,
    };
    const input = document.getElementById("f-author");
    if (input) input.value = a.name;
  },
  onInput: () => {
    state.authorPick = null;
  },
});

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
    return {
      title: d.title,
      sub: `${d.draft ? "Brouillon" : formatDate(d.date) || "Sans date"} · ${d.author || ""}`,
    };
  },
  onPick: (a) => openArticle(a.data.wp_id),
  onInput: (q) => {
    state.q = q;
    state.page = 1;
  },
});

/** Autocomplete + recherche comptes. */
const usersAc = createAutocomplete({
  key: "usersAc",
  wrapId: "users-search-wrap",
  suggestId: "users-suggest",
  limit: 8,
  minChars: 0,
  suggestMinChars: 1,
  openOnFocus: false,
  debounceMs: 200,
  fetchItems: async (q) => {
    state.usersQ = q;
    await loadUsers({ soft: true, fromAc: true });
    return state.users;
  },
  mapItem: (u) => ({
    title: u.name || u.login,
    sub: `${u.login} · ${u.email || ""} · ${ROLE_LABELS[u.role] || u.role}`,
  }),
  onPick: (u) => openUser(u.id),
  onInput: (q) => {
    state.usersQ = q;
  },
});

function usersItemsHtml(users) {
  return (users || [])
    .map((u) => {
      const st = u.status || "active";
      const badgeClass =
        st === "active" ? "live" : st === "disabled" ? "draft" : "warn";
      return `
        <button class="list-item" type="button" data-user="${u.id}">
          <div class="row" style="justify-content:space-between">
            <span class="badge ${badgeClass}">${escapeHtml(STATUS_LABELS[st] || st)}</span>
            <span class="sub">${escapeHtml(ROLE_LABELS[u.role] || u.role)}</span>
          </div>
          <h2>${escapeHtml(u.name || u.login)}</h2>
          <div class="sub">${escapeHtml(u.login)} · ${escapeHtml(u.email || "")}${
            u.access_until && !["admin", "editor", "author"].includes(u.role)
              ? ` · période au ${escapeHtml(formatDate(u.access_until))}`
              : ""
          }${u.entitled ? "" : " · sans accès premium"}</div>
        </button>`;
    })
    .join("");
}

function bindUsersResultClicks(root = app) {
  root.querySelectorAll("[data-user]").forEach((btn) => {
    btn.onclick = () => openUser(btn.dataset.user);
  });
}

function patchUsersResults() {
  const count = document.getElementById("users-count");
  if (count) count.textContent = `${state.usersTotal} compte(s)`;
  const list = document.getElementById("users-results");
  if (list) {
    list.innerHTML = usersItemsHtml(state.users) || `<div class="empty">Aucun compte</div>`;
    bindUsersResultClicks(list);
  }
  const err = document.getElementById("users-error");
  if (err) {
    if (state.error) {
      err.hidden = false;
      err.textContent = state.error;
    } else {
      err.hidden = true;
      err.textContent = "";
    }
  }
}

async function loadUsers({ soft = false, fromAc = false } = {}) {
  const seq = (state._searchSeq.users += 1);
  const params = new URLSearchParams({ limit: "40" });
  const q = String(state.usersQ || "").trim();
  if (q) params.set("q", q);
  if (state.usersRole) params.set("role", state.usersRole);
  if (state.usersStatus) params.set("status", state.usersStatus);
  try {
    const data = await api(`/api/desk/users?${params}`);
    if (seq !== state._searchSeq.users) return; // réponse obsolète
    state.users = data.users || [];
    state.usersTotal = data.total || 0;
    if (data.meta) state.usersMeta = data.meta;
    state.error = "";
    if (soft && state.view === "users" && document.getElementById("users-results")) {
      patchUsersResults();
      if (!fromAc) usersAc.syncItems(state.users, state.usersQ);
    } else if (!fromAc) {
      render();
    } else {
      patchUsersResults();
    }
  } catch (err) {
    if (seq !== state._searchSeq.users) return;
    state.error = err.message || "Erreur recherche";
    if (soft && state.view === "users" && document.getElementById("users-results")) {
      patchUsersResults();
      if (!fromAc) usersAc.syncItems([], state.usersQ);
    } else if (!fromAc) {
      render();
    } else {
      patchUsersResults();
    }
  }
}

function emptyUserForm() {
  return {
    id: null,
    login: "",
    email: "",
    name: "",
    role: "subscriber",
    status: "active",
    access_until: null,
    notes: "",
    newsletter_opt_in: true,
  };
}

async function openUser(id) {
  state.error = "";
  state.status = "";
  state.generatedPassword = "";
  state.userDeleteConfirm = false;
  if (!id) {
    state.editUser = emptyUserForm();
    state.view = "user-edit";
    render();
    return;
  }
  const data = await api(`/api/desk/users/${id}`);
  state.editUser = data.user;
  state.view = "user-edit";
  render();
}

function accessUntilInputValue(v) {
  return toDatetimeLocalValue(v);
}

async function saveUser(ev) {
  ev?.preventDefault?.();
  if (!state.editUser || state.userDeleteConfirm) return;
  const isNew = !state.editUser.id;
  const login = document.getElementById("u-login")?.value?.trim().toLowerCase() || "";
  const email = document.getElementById("u-email")?.value?.trim().toLowerCase() || "";
  const name = document.getElementById("u-name")?.value?.trim() || "";
  const roleEl = document.getElementById("u-role");
  const role = roleEl?.disabled
    ? state.editUser.role || "subscriber"
    : roleEl?.value || "subscriber";
  const status = document.getElementById("u-status")?.value || "active";
  const accessRaw = document.getElementById("u-until")?.value || "";
  const notes = document.getElementById("u-notes")?.value || "";
  const password = document.getElementById("u-password")?.value || "";
  const newsletterOptIn = Boolean(
    document.getElementById("u-newsletter")?.checked
  );

  const payload = {
    login,
    email,
    display_name: name,
    role,
    status,
    access_until: fromDatetimeLocalValue(accessRaw),
    notes,
    newsletter_opt_in: newsletterOptIn,
  };
  if (isNew) {
    payload.password = password;
  } else if (password) {
    payload.password = password;
  }

  state.saving = true;
  state.error = "";
  state.generatedPassword = "";
  state.status = isNew ? "Création…" : "Enregistrement…";
  render();
  try {
    if (isNew) {
      const data = await api("/api/desk/users", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      state.editUser = data.user;
      state.status = "Compte créé";
    } else {
      const data = await api(`/api/desk/users/${state.editUser.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      state.editUser = data.user;
      state.status = "Compte enregistré";
    }
  } catch (err) {
    state.error = err.message;
    state.status = "";
  } finally {
    state.saving = false;
    render();
  }
}

async function regenerateUserPassword() {
  if (!state.editUser?.id) return;
  if (
    !confirm(
      `Régénérer le mot de passe de « ${state.editUser.login} » ? L’ancien ne fonctionnera plus.`
    )
  ) {
    return;
  }
  state.saving = true;
  state.error = "";
  state.status = "Régénération…";
  state.generatedPassword = "";
  render();
  try {
    const data = await api(`/api/desk/users/${state.editUser.id}/password`, {
      method: "POST",
      body: "{}",
    });
    state.editUser = data.user || state.editUser;
    state.generatedPassword = data.password || "";
    state.status =
      "Mot de passe régénéré — copiez-le maintenant (il ne sera plus réaffichable).";
  } catch (err) {
    state.error = err.message || "Échec régénération";
    state.status = "";
  } finally {
    state.saving = false;
    render();
  }
}

function requestDeleteUser() {
  if (!state.editUser?.id || state.saving) return;
  state.userDeleteConfirm = true;
  state.error = "";
  state.status = "";
  render();
}

function cancelDeleteUser() {
  state.userDeleteConfirm = false;
  render();
}

async function confirmDeleteUser() {
  if (!state.editUser?.id || !state.userDeleteConfirm) return;
  const label = state.editUser.login || state.editUser.email || state.editUser.id;
  state.saving = true;
  state.error = "";
  state.status = "Suppression…";
  render();
  try {
    await api(`/api/desk/users/${state.editUser.id}`, { method: "DELETE" });
    state.editUser = null;
    state.generatedPassword = "";
    state.userDeleteConfirm = false;
    state.view = "users";
    state.status = `Compte « ${label} » supprimé`;
    state.saving = false;
    await loadUsers();
  } catch (err) {
    state.error = err.message || "Échec suppression";
    state.status = "";
    state.saving = false;
    state.userDeleteConfirm = true;
    render();
  }
}

function articlesItemsHtml(articles) {
  return (articles || [])
    .map((a) => {
      const d = a.data;
      const badge = d.draft
        ? `<span class="badge draft">Brouillon</span>`
        : `<span class="badge live">En ligne</span>`;
      return `
        <button class="list-item" type="button" data-open="${d.wp_id}">
          <div class="row" style="justify-content:space-between">
            ${badge}
            <span class="sub">${escapeHtml(
              d.draft ? "—" : formatDate(d.date) || "—"
            )} · ${escapeHtml(d.lang || "fr")}</span>
          </div>
          <h2>${escapeHtml(d.title)}</h2>
          <div class="sub">${escapeHtml(d.author || "")}</div>
        </button>`;
    })
    .join("");
}

function bindListResultClicks(root = app) {
  root.querySelectorAll("[data-open]").forEach((btn) => {
    btn.onclick = () => openArticle(btn.dataset.open);
  });
}

function listRangeLabel() {
  const total = Number(state.total || 0);
  if (!total) return "0 article";
  const from = (state.page - 1) * state.limit + 1;
  const to = Math.min(state.page * state.limit, total);
  return `${from}–${to} sur ${total} article${total > 1 ? "s" : ""}`;
}

function pagerHtml() {
  const pages = Math.max(1, Number(state.pages || 1));
  const page = Math.min(Math.max(1, Number(state.page || 1)), pages);
  if (pages <= 1 && Number(state.total || 0) <= state.limit) {
    return `<div class="pager" hidden></div>`;
  }
  const windowSize = 5;
  let start = Math.max(1, page - Math.floor(windowSize / 2));
  let end = Math.min(pages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  const nums = [];
  for (let i = start; i <= end; i++) nums.push(i);
  return `
    <nav class="pager" aria-label="Pagination articles">
      <button type="button" class="pager__btn" data-page="1" ${page <= 1 ? "disabled" : ""} aria-label="Première page">«</button>
      <button type="button" class="pager__btn" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""} aria-label="Page précédente">‹</button>
      ${nums
        .map(
          (n) =>
            `<button type="button" class="pager__btn${n === page ? " is-active" : ""}" data-page="${n}" ${
              n === page ? 'aria-current="page"' : ""
            }>${n}</button>`
        )
        .join("")}
      <button type="button" class="pager__btn" data-page="${page + 1}" ${page >= pages ? "disabled" : ""} aria-label="Page suivante">›</button>
      <button type="button" class="pager__btn" data-page="${pages}" ${page >= pages ? "disabled" : ""} aria-label="Dernière page">»</button>
      <span class="pager__meta">p. ${page}/${pages}</span>
    </nav>`;
}

async function goListPage(next) {
  const page = Number(next);
  if (!Number.isFinite(page) || page < 1 || page === state.page) return;
  state.page = page;
  listAc.close();
  await loadList({ soft: true });
  document.getElementById("list-results")?.scrollIntoView({ block: "start" });
}

function bindListPager(root = app) {
  root.querySelectorAll(".pager [data-page]").forEach((btn) => {
    btn.onclick = () => goListPage(btn.dataset.page);
  });
}

function patchListResults() {
  const count = document.getElementById("list-count");
  if (count) count.textContent = listRangeLabel();
  const list = document.getElementById("list-results");
  if (list) {
    list.innerHTML =
      articlesItemsHtml(state.articles) || `<div class="empty">Aucun article</div>`;
    bindListResultClicks(list);
  }
  const html = pagerHtml();
  for (const id of ["list-pager-host", "list-pager-host-bottom"]) {
    const host = document.getElementById(id);
    if (host) {
      host.innerHTML = html;
      bindListPager(host);
    }
  }
}

async function loadList({ soft = false, fromAc = false } = {}) {
  const seq = (state._searchSeq.list += 1);
  const page = Math.max(1, Number(state.page || 1));
  const limit = Math.min(50, Math.max(10, Number(state.limit || 25)));
  const params = new URLSearchParams({
    limit: String(limit),
    page: String(page),
  });
  const q = String(state.q || "").trim();
  if (q) params.set("q", q);
  if (state.filterDraft !== "") params.set("draft", state.filterDraft);
  try {
    const data = await api(`/api/desk/articles?${params}`);
    if (seq !== state._searchSeq.list) return;
    state.articles = data.articles || [];
    state.total = data.total || 0;
    state.limit = data.limit || limit;
    state.pages = data.pages || Math.max(1, Math.ceil(state.total / state.limit) || 1);
    state.page = Math.min(data.page || page, state.pages);
    state.error = "";
    if (soft && state.view === "list" && document.getElementById("list-results")) {
      patchListResults();
      if (!fromAc) listAc.syncItems(state.articles, state.q);
    } else if (!fromAc) {
      render();
    } else {
      patchListResults();
    }
  } catch (err) {
    if (seq !== state._searchSeq.list) return;
    state.error = err.message || "Erreur recherche";
    if (soft && state.view === "list" && document.getElementById("list-results")) {
      patchListResults();
      if (!fromAc) listAc.syncItems([], state.q);
    } else if (!fromAc) {
      render();
    } else {
      patchListResults();
    }
  }
}

function xWeightedLength(text) {
  const s = String(text || "");
  const urlRe = /https?:\/\/[^\s]+/gi;
  let len = 0;
  let last = 0;
  let m;
  while ((m = urlRe.exec(s))) {
    len += [...s.slice(last, m.index)].length;
    len += 23;
    last = m.index + m[0].length;
  }
  len += [...s.slice(last)].length;
  return len;
}

function resetXPanel() {
  state.x = {
    account: "el",
    text: "",
    variants: [],
    loading: false,
    busy: "",
  };
}

async function loadXPanel(account) {
  if (!state.article) return;
  const wpId = state.article.data.wp_id;
  const acc = account || state.x.account || "el";
  state.x.loading = true;
  try {
    const data = await api(
      `/api/desk/articles/${wpId}/x?account=${encodeURIComponent(acc)}`
    );
    state.x.account = data.account || acc;
    state.x.text = data.draft?.text || "";
    state.x.variants = data.draft?.variants || [];
  } catch (err) {
    state.x.text = state.x.text || "";
    console.warn("[desk] x load", err.message);
  } finally {
    state.x.loading = false;
  }
}

async function openArticle(wpId) {
  if (
    state.view === "edit" &&
    state.article?.data?.wp_id != null &&
    Number(state.article.data.wp_id) !== Number(wpId)
  ) {
    if (!confirmLeaveEdit()) return;
  }
  state.status = "";
  state.error = "";
  state.authorPick = null;
  authorAc.reset();
  resetXPanel();
  await loadRubrics();
  const data = await api(`/api/desk/articles/${wpId}`);
  state.article = data.article;
  setEditBaselineFromArticle(data.article);
  state.view = "edit";
  state.mode = "visual";
  await loadXPanel("el");
  render();
}

async function createArticle() {
  state.status = "Création…";
  render();
  try {
    const data = await api("/api/desk/articles", {
      method: "POST",
      body: JSON.stringify({
        title: "Nouvel article",
        draft: true,
        lang: "fr",
        access: "subscribers",
        body: "<p></p>",
      }),
    });
    state.article = data.article;
    setEditBaselineFromArticle(data.article);
    state.view = "edit";
    state.mode = "visual";
    state.status = "";
    resetXPanel();
    await loadXPanel("el");
    render();
  } catch (err) {
    state.error = err.message;
    state.status = "";
    render();
  }
}

/** Sync le formulaire vers state.article avant un re-render (évite de perdre le texte). */
function flushFormToState() {
  if (!state.article || state.view !== "edit") return;
  const payload = collectForm();
  if (!payload) return;
  state.article.body = payload.body;
  Object.assign(state.article.data, {
    title: payload.title,
    excerpt: payload.excerpt,
    author: payload.author,
    date: payload.date,
    categories: payload.categories,
    category_names: payload.category_names,
    ia_keywords: payload.ia_keywords,
    access: payload.access,
    lang: payload.lang,
  });
  if (payload.author_slug !== undefined) {
    state.article.data.author_slug = payload.author_slug;
  }
  if (payload.author_user_id !== undefined) {
    state.article.data.author_user_id = payload.author_user_id;
  }
}

/**
 * @param {{ publish?: boolean, skipPublishConfirm?: boolean, allowPush?: boolean }} [opts]
 *   allowPush=false : remise en ligne via Brouillon (pas de push).
 *   skipPublishConfirm : confirm déjà géré (ex. undraft dirty).
 */
async function saveArticle({
  publish = false,
  skipPublishConfirm = false,
  allowPush = true,
} = {}) {
  const payload = collectForm();
  if (!payload || !state.article) return;
  if (publish) {
    if (!state.caps.publish) {
      state.error = "Publication réservée éditeur/admin";
      paintEditMessages();
      return;
    }
    payload.draft = false;
  }
  const wantPush =
    Boolean(allowPush) &&
    Boolean(state.caps.publish) &&
    Boolean(document.getElementById("f-push")?.checked);
  if (publish && !skipPublishConfirm) {
    const msg = wantPush
      ? "Publier maintenant et envoyer un push OneSignal ?"
      : "Publier maintenant ?";
    if (!confirm(msg)) return;
  }
  const hadKw = (payload.ia_keywords || []).length > 0;
  const wasDraft = Boolean(state.article.data.draft);
  // Sync state sans reconstruire l’éditeur (garde curseur / scroll).
  flushFormToState();
  state.error = "";
  state.status =
    payload.access === "subscribers" && !hadKw
      ? publish
        ? "Publication + mots-clés IA…"
        : "Enregistrement + mots-clés IA…"
      : publish
        ? wantPush
          ? "Publication + push…"
          : "Publication…"
        : "Enregistrement…";
  setEditBusy(true);
  try {
    const wpId = state.article.data.wp_id;
    const data = await api(`/api/desk/articles/${wpId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (publish) {
      const pub = await api(`/api/desk/articles/${wpId}/publish`, {
        method: "POST",
        body: JSON.stringify({ push: wantPush }),
      });
      state.article = pub.article;
      setEditBaselineFromArticle(pub.article);
      if (wantPush && pub.push?.ok) {
        state.status = pub.push.dryRun
          ? "Publié — push DRY-RUN (aucun envoi réel)"
          : `Publié + push (${pub.push.recipients ?? "?"} dest.)`;
      } else if (wantPush && pub.push && pub.push.ok === false) {
        state.status = "Publié — push échoué";
        state.error = pub.push.error || "Erreur OneSignal";
      } else {
        state.status = "Publié — en ligne sans rebuild";
      }
    } else {
      state.article = data.article;
      setEditBaselineFromArticle(data.article);
      const n = (data.article?.data?.ia_keywords || []).length;
      state.status =
        !hadKw && payload.access === "subscribers" && n
          ? `Enregistré — ${n} mot${n > 1 ? "s" : ""}-clé${n > 1 ? "s" : ""} IA`
          : "Enregistré";
    }
  } catch (err) {
    state.error = err.message;
    state.status = "";
  } finally {
    state.saving = false;
    if (state.view === "edit" && state.article) {
      paintEditAfterMutation({ fullIfDraftFlip: publish, wasDraft });
    } else {
      render();
    }
  }
}

/** @param {{ force?: boolean }} [opts] force = pas de confirm (sélection Accès Abonnés) */
async function generateKeywords({ force = false } = {}) {
  if (!state.article || state.generatingKeywords || state.saving) return;
  const payload = collectForm();
  if (!payload) return;
  if (payload.access === "granted") {
    state.error =
      "Les mots-clés IA sont réservés aux articles abonnés.";
    const errLine = document.getElementById("edit-error");
    if (errLine) {
      errLine.hidden = false;
      errLine.textContent = state.error;
    }
    return;
  }
  const input = document.getElementById("f-ia");
  const current = String(input?.value || "").trim();
  if (current && !force) {
    const ok = confirm(
      "Remplacer les mots-clés actuels par une nouvelle extraction IA ?"
    );
    if (!ok) return;
  }
  state.generatingKeywords = true;
  state.error = "";
  state.status = "Génération des mots-clés…";
  const help = document.getElementById("kw-help");
  if (help) help.textContent = "Analyse IA en cours…";
  const okLine = document.getElementById("edit-status");
  if (okLine) {
    okLine.hidden = false;
    okLine.className = "ok";
    okLine.textContent = state.status;
  }
  try {
    const wpId = state.article.data.wp_id;
    const data = await api(`/api/desk/articles/${wpId}/keywords`, {
      method: "POST",
      body: JSON.stringify({
        title: payload.title,
        excerpt: payload.excerpt,
        body: payload.body,
        lang: payload.lang,
        access: "subscribers",
      }),
    });
    const keywords = data.keywords || [];
    if (data.article) state.article = data.article;
    else {
      state.article.data.ia_keywords = keywords;
      state.article.data.access = "subscribers";
    }
    if (input) {
      input.value = keywords.join(", ");
      input.style.height = "auto";
      input.style.height = `${Math.max(120, input.scrollHeight)}px`;
    }
    state.status = `${keywords.length} mot${keywords.length > 1 ? "s" : ""}-clé${
      keywords.length > 1 ? "s" : ""
    } généré${keywords.length > 1 ? "s" : ""}`;
    if (help) {
      help.textContent =
        "Générés automatiquement (abonnés). Modifiables, puis Enregistrer.";
    }
    if (okLine) {
      okLine.hidden = false;
      okLine.className = "ok";
      okLine.textContent = state.status;
    }
  } catch (err) {
    state.error = err.message || "Échec génération";
    state.status = "";
    if (help) help.textContent = state.error;
    const errLine = document.getElementById("edit-error");
    if (errLine) {
      errLine.hidden = false;
      errLine.textContent = state.error;
    }
  } finally {
    state.generatingKeywords = false;
  }
}

async function onAccessChange() {
  const sel = document.getElementById("f-access");
  if (!sel || !state.article) return;
  const access = sel.value;
  flushFormToState();
  state.article.data.access = access;
  if (access === "granted") {
    state.article.data.ia_keywords = [];
    state.status = "";
    state.error = "";
    render();
    return;
  }
  render();
  await generateKeywords({ force: true });
}

/**
 * Bascule brouillon.
 * Remise en ligne = même chemin que Publier (PUT corps local puis /publish), sans push.
 * Passage brouillon = PUT (si besoin) puis POST /draft.
 */
async function toggleDraft() {
  if (!state.article || state.saving || state.generatingKeywords) return;
  const nextDraft = !state.article.data.draft;
  if (!nextDraft && !state.caps.publish) {
    state.error = "Remettre en ligne réservé éditeur/admin";
    const errLine = document.getElementById("edit-error");
    if (errLine) {
      errLine.hidden = false;
      errLine.textContent = state.error;
    }
    return;
  }

  // Remise en ligne : persister le brouillon local puis /publish (pas le body BDD stale).
  if (!nextDraft) {
    if (isEditContentDirty()) {
      const ok = confirm(
        "Des modifications non enregistrées seront mises en ligne. Continuer ?"
      );
      if (!ok) return;
    }
    await saveArticle({
      publish: true,
      skipPublishConfirm: true,
      allowPush: false,
    });
    return;
  }

  // Passage en brouillon : enregistrer d’abord si dirty, puis draft API.
  if (isEditContentDirty()) {
    const ok = confirm(
      "Enregistrer les modifications et passer en brouillon ?"
    );
    if (!ok) return;
  }

  const payload = collectForm();
  if (!payload) return;
  flushFormToState();
  state.error = "";
  state.status = "Passage en brouillon…";
  setEditBusy(true);
  try {
    const wpId = state.article.data.wp_id;
    const data = await api(`/api/desk/articles/${wpId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    state.article = data.article;
    const drafted = await api(`/api/desk/articles/${wpId}/draft`, {
      method: "POST",
      body: JSON.stringify({ draft: true }),
    });
    state.article = drafted.article;
    setEditBaselineFromArticle(state.article);
    state.status = "Brouillon";
  } catch (err) {
    state.error = err.message || "Échec brouillon";
    state.status = "";
  } finally {
    state.saving = false;
    if (state.view === "edit" && state.article) {
      paintEditAfterMutation();
      // Retirer « push maintenant » si présent (article hors ligne).
      document.getElementById("btn-push-now")?.remove();
    } else {
      render();
    }
  }
}

async function pushNow() {
  if (!state.article || state.article.data.draft) return;
  if (!state.caps.publish) {
    state.error = "Push réservé éditeur/admin";
    render();
    return;
  }
  const ok = confirm(
    "Envoyer une notification OneSignal maintenant aux abonnés ?"
  );
  if (!ok) return;
  state.saving = true;
  state.error = "";
  state.status = "Envoi push…";
  render();
  try {
    const wpId = state.article.data.wp_id;
    const data = await api(`/api/desk/articles/${wpId}/push`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    state.status = data.push?.dryRun
      ? "Push DRY-RUN — aucun envoi réel"
      : `Push envoyé (${data.push?.recipients ?? "?"} dest.)`;
  } catch (err) {
    state.error = err.message;
    state.status = "";
  } finally {
    state.saving = false;
    render();
  }
}

async function xGenerate() {
  if (!state.article || state.x.busy) return;
  const wpId = state.article.data.wp_id;
  state.x.busy = "generate";
  state.error = "";
  state.status = "Génération des variantes X…";
  render();
  try {
    const data = await api(`/api/desk/articles/${wpId}/x/generate`, {
      method: "POST",
      body: JSON.stringify({ account: state.x.account }),
    });
    state.x.variants = data.variants || [];
    state.x.text = data.text || state.x.variants[0] || "";
    state.x.account = data.account || state.x.account;
    state.status =
      data.source === "fallback"
        ? "Variantes de secours (IA indisponible)"
        : "Variantes X prêtes — choisissez ou éditez";
  } catch (err) {
    state.error = err.message;
    state.status = "";
  } finally {
    state.x.busy = "";
    render();
  }
}

async function xCopyText() {
  const text = String(state.x.text || "").trim();
  if (!text) {
    state.error = "Texte X vide";
    render();
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    state.error = "";
    state.status = "Texte copié — collez-le sur X";
  } catch {
    state.error = "Copie impossible — sélectionnez le texte manuellement";
    state.status = "";
  }
  render();
}

function xOpenIntent() {
  const text = String(state.x.text || "").trim();
  if (!text) {
    state.error = "Texte X vide";
    render();
    return;
  }
  const url =
    "https://x.com/intent/tweet?text=" + encodeURIComponent(text);
  window.open(url, "_blank", "noopener,noreferrer");
  state.error = "";
  state.status = "Composer X ouvert";
  render();
}

/**
 * Traduction UK via DeepL EN-GB.
 * Enregistre d’abord le FR, crée/écrase le brouillon EN, ouvre l’EN.
 */
async function translateUk({ overwrite = true } = {}) {
  if (!state.article || state.translating) return;
  const d = state.article.data;
  const isEn = (d.lang || "fr") === "en";
  const hasPair = Boolean(isEn ? d.translation_fr : d.translation_en);

  if (overwrite && hasPair) {
    const ok = confirm(
      "Retraduire et écraser la version UK existante ?\nElle repassera en brouillon pour relecture."
    );
    if (!ok) return;
  }

  state.translating = true;
  state.error = "";
  state.status = "Traduction DeepL (EN-GB)…";
  render();

  try {
    // Sauvegarder le contenu courant avant traduction (surtout si on est sur le FR)
    if (!isEn) {
      const payload = collectForm();
      if (payload) {
        const saved = await api(`/api/desk/articles/${d.wp_id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        state.article = saved.article;
      }
    }

    const sourceId = isEn ? d.translation_fr : d.wp_id;
    const data = await api(`/api/desk/articles/${sourceId}/translate-uk`, {
      method: "POST",
      body: JSON.stringify({ overwrite }),
    });
    state.article = data.article;
    state.view = "edit";
    state.mode = "visual";
    state.status = data.overwritten
      ? "Version UK écrasée — brouillon à relire"
      : "Version UK créée — brouillon à relire";
  } catch (err) {
    state.error = err.message;
    state.status = "";
  } finally {
    state.translating = false;
    render();
  }
}

async function login(ev) {
  ev.preventDefault();
  const login = document.getElementById("login")?.value?.trim();
  const password = document.getElementById("password")?.value || "";
  state.error = "";
  state.status = "Connexion…";
  render();
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ login, password }),
    });
    if (!data.desk) {
      state.error = "Compte sans droit rédacteur/éditeur/admin.";
      state.status = "";
      await api("/api/auth/logout", { method: "POST" });
      render();
      return;
    }
    state.user = data.user;
    try {
      const deskMe = await api("/api/desk/me");
      state.caps = deskMe.capabilities || {};
      if (deskMe.user) state.user = { ...state.user, ...deskMe.user };
    } catch {
      state.caps = { manageUsers: false };
    }
    state.status = "";
    await openDesiredView();
  } catch (err) {
    state.error = err.message;
    state.status = "";
    render();
  }
}

async function logout() {
  await api("/api/auth/logout", { method: "POST" });
  state.user = null;
  state.caps = { manageUsers: false };
  state.view = "login";
  state.article = null;
  state.editUser = null;
  render();
}

function brandBlock(title, meta = "") {
  return `
    <div class="brand">
      <span class="brand-mark" aria-hidden="true"></span>
      <div style="min-width:0">
        <h1>${escapeHtml(title)}</h1>
        ${meta ? `<div class="meta">${meta}</div>` : ""}
      </div>
    </div>`;
}

function renderLogin() {
  app.innerHTML = `
    <div class="login-wrap">
      <form class="card login-card stack" id="login-form">
        <div class="brand" style="margin-bottom:4px">
          <span class="brand-mark" aria-hidden="true"></span>
          <h1 style="margin:0">Pupitre EL</h1>
        </div>
        <p style="margin:0;color:var(--muted)">Espace rédacteur · éditeur · admin</p>
        <div class="field">
          <label for="login">Identifiant</label>
          <input id="login" name="login" autocomplete="username" required />
        </div>
        <div class="field">
          <label for="password">Mot de passe</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required />
        </div>
        ${state.error ? `<p class="err">${escapeHtml(state.error)}</p>` : ""}
        ${state.status ? `<p class="ok">${escapeHtml(state.status)}</p>` : ""}
        <button class="btn btn-primary" type="submit">Entrer</button>
      </form>
    </div>`;
  document.getElementById("login-form").addEventListener("submit", login);
}

function bindSuggestKeyboard(input, {
  getOpen,
  setOpen,
  getIndex,
  setIndex,
  getItems,
  onPick,
  onClose,
}) {
  input.setAttribute("autocomplete", "off");
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("spellcheck", "false");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.onkeydown = (e) => {
    const items = getItems() || [];
    if (!getOpen() || !items.length) {
      if (e.key === "Escape") onClose?.();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex(Math.min(items.length - 1, getIndex() + 1));
      onClose?.("refresh");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex(Math.max(-1, getIndex() - 1));
      onClose?.("refresh");
    } else if (e.key === "Enter" && getIndex() >= 0 && items[getIndex()]) {
      e.preventDefault();
      onPick(items[getIndex()]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setIndex(-1);
      onClose?.("refresh");
    }
  };
  input.onblur = () => {
    setTimeout(() => {
      setOpen(false);
      setIndex(-1);
      onClose?.("refresh");
    }, 150);
  };
}

function renderList() {
  const items =
    articlesItemsHtml(state.articles) || `<div class="empty">Aucun article</div>`;

  app.innerHTML = `
    <header class="topbar">
      ${brandBlock("Pupitre", `${escapeHtml(state.user?.name || "")} · ${escapeHtml(state.user?.role || "")}`)}
      <button class="btn btn-ghost" type="button" id="btn-logout">Sortir</button>
    </header>
    ${navTabs("list")}
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
      </div>
      <div class="list-meta">
        <p class="count-line" id="list-count">${listRangeLabel()}</p>
        <div id="list-pager-host">${pagerHtml()}</div>
      </div>
      ${state.error ? `<p class="err">${escapeHtml(state.error)}</p>` : ""}
      <div id="list-results">${items}</div>
      <div id="list-pager-host-bottom" class="list-pager-bottom">${pagerHtml()}</div>
    </main>
    <button class="fab" type="button" id="btn-new" title="Nouvel article" aria-label="Nouvel article">+</button>`;

  document.getElementById("btn-logout").onclick = logout;
  document.getElementById("btn-new").onclick = () => createArticle();
  bindNav();
  listAc.bindInput(document.getElementById("q"));
  app.querySelectorAll("[data-draft]").forEach((btn) => {
    btn.onclick = async () => {
      state.filterDraft = btn.dataset.draft;
      state.page = 1;
      listAc.close();
      await loadList({ soft: true });
    };
  });
  bindListPager();
  bindListResultClicks();
}

function renderUsers() {
  const filterChipsOpts = [
    ["", "Tous"],
    ["admin", "Admin"],
    ["redacteurs", "Rédacteurs"],
    ["subscriber", "Abonnés"],
    ["other", "Inactifs"],
  ];
  const activeFilter = state.usersRole || "";
  const items =
    usersItemsHtml(state.users) || `<div class="empty">Aucun compte</div>`;

  app.innerHTML = `
    <header class="topbar">
      ${brandBlock("Comptes", `${escapeHtml(state.user?.name || "")} · ${escapeHtml(state.user?.role || "")}`)}
      <button class="btn btn-ghost" type="button" id="btn-logout">Sortir</button>
    </header>
    ${navTabs("users")}
    <main class="main stack">
      <div class="toolbar-list">
        <div class="search-wrap" id="users-search-wrap">
          <input class="search-input search-input--compact" id="users-q" type="search" placeholder="Nom, login, email…" value="${escapeHtml(state.usersQ)}" autocomplete="off" />
          ${usersAc.html()}
        </div>
        ${filterChips("Filtrer les comptes", filterChipsOpts, activeFilter, "ufilter")}
      </div>
      <p class="count-line" id="users-count">${state.usersTotal} compte(s)</p>
      <p class="err" id="users-error" ${state.error ? "" : "hidden"}>${escapeHtml(state.error || "")}</p>
      <div id="users-results">${items}</div>
    </main>
    <button class="fab" type="button" id="btn-new-user" title="Nouveau compte" aria-label="Nouveau compte">+</button>`;

  document.getElementById("btn-logout").onclick = logout;
  bindNav();
  document.getElementById("btn-new-user").onclick = () => openUser(null);
  usersAc.bindInput(document.getElementById("users-q"));
  app.querySelectorAll("[data-ufilter]").forEach((btn) => {
    btn.onclick = async () => {
      state.usersRole = btn.dataset.ufilter || "";
      state.usersStatus = "";
      usersAc.close();
      await loadUsers({ soft: true });
    };
  });
  bindUsersResultClicks();
}

function renderUserEdit() {
  const u = state.editUser || emptyUserForm();
  const isNew = !u.id;
  const isSelf = !isNew && Number(u.id) === Number(state.user?.id);
  const roles = state.usersMeta.roles || ["subscriber", "other"];
  const roleOpts = roles
    .map(
      (r) =>
        `<option value="${r}" ${u.role === r ? "selected" : ""}>${escapeHtml(ROLE_LABELS[r] || r)}</option>`
    )
    .join("");
  const statusOpts = (state.usersMeta.statuses || ["active", "disabled", "expired"])
    .map(
      (s) =>
        `<option value="${s}" ${u.status === s ? "selected" : ""}>${escapeHtml(STATUS_LABELS[s] || s)}</option>`
    )
    .join("");
  const nlOn = u.newsletter_opt_in !== false && u.newsletter_opt_in !== 0;

  app.innerHTML = `
    <header class="topbar">
      ${brandBlock(isNew ? "Nouveau compte" : "Compte", u.id ? `#${u.id}` : "création")}
      <button class="btn btn-ghost" type="button" id="btn-back-users">Comptes</button>
    </header>
    <main class="main">
      <form class="card stack" id="user-form">
        <div class="field">
          <label for="u-login">Identifiant</label>
          <input id="u-login" value="${escapeHtml(u.login || "")}" required autocomplete="off" />
        </div>
        <div class="field">
          <label for="u-email">Email</label>
          <input id="u-email" type="email" value="${escapeHtml(u.email || "")}" required />
        </div>
        <div class="field">
          <label for="u-name">Nom affiché</label>
          <input id="u-name" value="${escapeHtml(u.name || "")}" />
        </div>
        <div class="row" style="gap:12px;align-items:flex-start">
          <div class="field" style="flex:1">
            <label for="u-role">Rôle</label>
            <select id="u-role" ${isSelf && state.user?.role === "admin" ? "disabled" : ""}>${roleOpts}</select>
            ${
              isSelf && state.user?.role === "admin"
                ? `<p class="uk-help">Vous ne pouvez pas modifier votre propre rôle admin.</p>`
                : ""
            }
          </div>
          <div class="field" style="flex:1">
            <label for="u-status">Statut</label>
            <select id="u-status">${statusOpts}</select>
          </div>
        </div>
        ${
          ["admin", "editor", "author"].includes(u.role)
            ? `<p class="uk-help">Admin / rédacteur / auteur : pas de date de fin d’accès.</p>`
            : `<div class="field">
          <label for="u-until">Fin de période / limite d’accès (optionnel)</label>
          <input id="u-until" type="datetime-local" value="${escapeHtml(accessUntilInputValue(u.access_until))}" />
          <p class="uk-help">Abo Stripe : fin de période en cours (renouvellement tacite → la date avance). Compte manuel : date limite dure. Passée = plus d’accès premium.</p>
        </div>`
        }
        <div class="field">
          <label class="check-label">
            <input type="checkbox" id="u-newsletter" ${nlOn ? "checked" : ""} />
            Inscrit à la newsletter
          </label>
        </div>
        <div class="field">
          <label for="u-password">${isNew ? "Mot de passe" : "Nouveau mot de passe (optionnel)"}</label>
          <input id="u-password" type="password" autocomplete="new-password" ${isNew ? "required minlength=\"8\"" : 'minlength="8"'} />
          ${
            !isNew
              ? `<p class="uk-help">Ou utilisez « Régénérer » pour créer un mot de passe temporaire à communiquer une fois.</p>`
              : ""
          }
        </div>
        ${
          state.generatedPassword
            ? `<div class="pwd-reveal" role="status">
                <label for="u-generated-pwd">Mot de passe temporaire</label>
                <div class="row" style="gap:8px;align-items:center">
                  <input id="u-generated-pwd" type="text" readonly value="${escapeHtml(state.generatedPassword)}" />
                  <button class="btn" type="button" id="btn-copy-pwd">Copier</button>
                </div>
              </div>`
            : ""
        }
        <div class="field">
          <label for="u-notes">Notes internes</label>
          <textarea id="u-notes" rows="3">${escapeHtml(u.notes || "")}</textarea>
        </div>
        ${
          !isNew
            ? `<p class="sub">Source : ${escapeHtml(u.source || "wp")}${
                u.wp_role ? ` · WP : ${escapeHtml(u.wp_role)}` : ""
              } · Premium : ${u.entitled ? "oui" : "non"}</p>`
            : ""
        }
        ${state.error ? `<p class="err">${escapeHtml(state.error)}</p>` : ""}
        ${state.status ? `<p class="ok">${escapeHtml(state.status)}</p>` : ""}
        <div class="row user-actions" style="gap:10px;flex-wrap:wrap">
          <button class="btn btn-primary" type="submit" ${state.saving || state.userDeleteConfirm ? "disabled" : ""}>Enregistrer</button>
          ${
            !isNew
              ? `<button class="btn" type="button" id="btn-regen-pwd" ${state.saving || state.userDeleteConfirm ? "disabled" : ""}>Régénérer le mot de passe</button>`
              : ""
          }
          <button class="btn" type="button" id="btn-cancel-user">Annuler</button>
          ${
            !isNew && !isSelf && !state.userDeleteConfirm
              ? `<button class="btn btn-danger" type="button" id="btn-delete-user" ${state.saving ? "disabled" : ""}>Supprimer</button>`
              : ""
          }
        </div>
        ${
          !isNew && !isSelf && state.userDeleteConfirm
            ? `<div class="user-delete-confirm" role="alertdialog" aria-labelledby="user-delete-title" aria-describedby="user-delete-desc">
                <p id="user-delete-title" class="user-delete-confirm__title">Confirmer la suppression</p>
                <p id="user-delete-desc" class="user-delete-confirm__desc">
                  Supprimer définitivement le compte
                  <strong>${escapeHtml(u.login || u.email || String(u.id))}</strong>
                  (${escapeHtml(ROLE_LABELS[u.role] || u.role || "")})&nbsp;?
                  Cette action est irréversible.
                </p>
                <div class="row" style="gap:10px;flex-wrap:wrap">
                  <button class="btn" type="button" id="btn-delete-cancel" ${state.saving ? "disabled" : ""}>Ne pas supprimer</button>
                  <button class="btn btn-danger" type="button" id="btn-delete-confirm" ${state.saving ? "disabled" : ""}>Oui, supprimer le compte</button>
                </div>
              </div>`
            : ""
        }
      </form>
    </main>`;

  document.getElementById("btn-back-users").onclick = async () => {
    state.view = "users";
    state.editUser = null;
    state.generatedPassword = "";
    state.userDeleteConfirm = false;
    await loadUsers();
  };
  document.getElementById("btn-cancel-user").onclick = async () => {
    state.view = "users";
    state.editUser = null;
    state.generatedPassword = "";
    state.userDeleteConfirm = false;
    await loadUsers();
  };
  document.getElementById("user-form").onsubmit = (e) => saveUser(e);
  const regenBtn = document.getElementById("btn-regen-pwd");
  if (regenBtn) regenBtn.onclick = () => regenerateUserPassword();
  const delBtn = document.getElementById("btn-delete-user");
  if (delBtn) delBtn.onclick = () => requestDeleteUser();
  const delCancel = document.getElementById("btn-delete-cancel");
  if (delCancel) delCancel.onclick = () => cancelDeleteUser();
  const delConfirm = document.getElementById("btn-delete-confirm");
  if (delConfirm) delConfirm.onclick = () => confirmDeleteUser();
  const copyBtn = document.getElementById("btn-copy-pwd");
  if (copyBtn) {
    copyBtn.onclick = async () => {
      const val = state.generatedPassword;
      try {
        await navigator.clipboard.writeText(val);
        state.status = "Mot de passe copié";
        render();
      } catch {
        document.getElementById("u-generated-pwd")?.select();
      }
    };
  }
}

function renderEdit() {
  closeMediaPicker();
  const a = state.article;
  const d = a.data;
  const dateVal =
    !d.draft && d.date ? toDatetimeLocalValue(d.date) : "";
  const updatedLabel = updateDateLabel(d);
  const selected = new Set((d.categories || []).map(String));
  const known = rubricList();
  const extras = [...selected]
    .filter((slug) => !known.some((c) => c.value === slug))
    .map((slug) => ({ value: slug, label: catLabel(slug) }));
  const chips = [...known, ...extras]
    .map((c) => {
      const on = selected.has(c.value) ? "on" : "";
      return `<button type="button" class="chip ${on}" data-value="${escapeHtml(c.value)}">${escapeHtml(c.label)}</button>`;
    })
    .join("");

  const body = a.body || "";
  const editorPane =
    state.mode === "html"
      ? `<textarea class="html-editor" id="html-editor">${escapeHtml(body)}</textarea>`
      : state.mode === "preview"
        ? `<iframe class="article-preview-frame" id="article-preview-frame" title="Aperçu mise en page site" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe>`
        : `<div class="visual-editor" id="visual-editor" contenteditable="true" role="textbox" aria-label="Texte"></div>`;

  app.innerHTML = `
    <header class="topbar">
      ${brandBlock("Édition", `#${d.wp_id} · ${d.draft ? "brouillon" : "en ligne"}`)}
      <button class="btn btn-ghost" type="button" id="btn-back">Liste</button>
    </header>
    <main class="main main-edit">
      <div class="edit-grid">
        <section class="edit-col-write" aria-label="Rédaction">
          <input class="title-input" id="f-title" value="${escapeHtml(d.title)}" placeholder="Titre" ${
            state.mode === "preview" ? "hidden" : ""
          } />

          <div class="editor-chrome">
            <div class="editor-tabs">
              <button type="button" data-mode="visual" class="${state.mode === "visual" ? "active" : ""}">Écrire</button>
              <button type="button" data-mode="preview" class="${state.mode === "preview" ? "active" : ""}">Aperçu</button>
              <button type="button" data-mode="html" class="${state.mode === "html" ? "active" : ""}">HTML</button>
            </div>
            ${
              state.mode === "preview"
                ? (() => {
                    const liveHref = !d.draft ? articlePublicPath(a) : "";
                    const isGranted = d.access === "granted";
                    const view = state.previewView || "full";
                    return `<div class="editor-preview-bar">
              <p class="editor-preview-hint">Aperçu mise en page site (non enregistré)</p>
              <div class="preview-view-toggle" role="group" aria-label="Mode d’aperçu">
                <button type="button" class="btn ${view === "full" ? "active" : ""}" data-preview-view="full">Corps complet</button>
                <button type="button" class="btn ${view === "visitor" ? "active" : ""}" data-preview-view="visitor" ${
                      isGranted ? "disabled title=\"Article gratuit — pas de paywall\"" : 'title="Teaser + paywall (lecteur non abonné)"'
                    }>Vue non abonné</button>
              </div>
              ${
                liveHref
                  ? `<a class="btn btn-ghost preview-live-link" href="${escapeHtml(liveHref)}" target="_blank" rel="noopener">Voir en ligne</a>`
                  : `<span class="preview-live-link sub">Voir en ligne : après publication</span>`
              }
            </div>`;
                  })()
                : ""
            }
            ${
              state.mode === "visual" || state.mode === "html"
                ? `<div class="editor-toolbar" role="toolbar" aria-label="Outils d’édition">
                    ${
                      state.mode === "visual"
                        ? `<div class="toolbar-group toolbar-group--history" role="group" aria-label="Historique et nettoyage">
                    <button type="button" class="btn" data-cmd="undo" title="Annuler (Ctrl+Z)">Annuler</button>
                    <button type="button" class="btn" data-cmd="redo" title="Rétablir (Ctrl+Shift+Z)">Rétablir</button>
                    <button type="button" class="btn" data-cmd="clean" title="Retire couleurs/polices collées (Word, Docs) — conserve le centrage">Nettoyer</button>
                  </div>
                  <div class="toolbar-group toolbar-group--format" role="group" aria-label="Mise en forme">
                    <button type="button" class="btn" data-cmd="bold">Gras</button>
                    <button type="button" class="btn" data-cmd="italic">Italique</button>
                    <button type="button" class="btn" data-cmd="ul">Liste</button>
                    <button type="button" class="btn" data-cmd="quote" title="Citation">Citation</button>
                    <button type="button" class="btn" data-cmd="link">Lien</button>
                    <button type="button" class="btn" data-cmd="image">Document</button>
                  </div>
                  <div class="toolbar-group toolbar-group--align" role="group" aria-label="Alignement">
                    <button type="button" class="btn btn-align" data-cmd="alignLeft" title="Aligner à gauche" aria-label="Aligner à gauche">Gauche</button>
                    <button type="button" class="btn btn-align" data-cmd="alignCenter" title="Centrer" aria-label="Centrer">Centre</button>
                    <button type="button" class="btn btn-align" data-cmd="alignRight" title="Aligner à droite" aria-label="Aligner à droite">Droite</button>
                  </div>`
                        : `<div class="toolbar-group toolbar-group--clean" role="group" aria-label="Nettoyage">
                    <button type="button" class="btn" data-cmd="clean" title="Retire couleurs/polices collées (Word, Docs) — conserve le centrage">Nettoyer</button>
                  </div>`
                    }
                  <div class="toolbar-group toolbar-group--assist" role="group" aria-label="Assistance IA">
                    <button type="button" class="btn" data-assist="corriger" ${
                      state.assisting || state.saving ? "disabled" : ""
                    }>Corriger</button>
                    <button type="button" class="btn" data-assist="reformuler" ${
                      state.assisting || state.saving ? "disabled" : ""
                    }>Reformuler</button>
                    <button type="button" class="btn" data-assist="chapo" ${
                      state.assisting || state.saving ? "disabled" : ""
                    }>Chapô</button>
                  </div>
                  </div>`
                : ""
            }
          </div>
          ${editorPane}
          <p class="err" id="edit-error" ${state.error ? "" : "hidden"}>${escapeHtml(state.error || "")}</p>
          <p class="ok" id="edit-status" ${state.status ? "" : "hidden"}>${escapeHtml(state.status || "")}</p>
        </section>

        <aside class="edit-col-meta" aria-label="Publication">
          <p class="meta-title">Publication</p>
          <div class="stack">
            <div class="field">
              <label for="f-author">Auteur</label>
              <div class="search-wrap" id="author-search-wrap">
                <input id="f-author" class="search-input" value="${escapeHtml(d.author || "")}" placeholder="Nom…" autocomplete="off" />
                ${authorAc.html()}
              </div>
            </div>
            <div class="field">
              <label for="f-date">Date de publication</label>
              ${
                d.draft
                  ? d.date
                    ? `<input id="f-date" type="datetime-local" value="${toDatetimeLocalValue(d.date)}" disabled />
              <p class="uk-help" id="date-help">Conservée — restaurée à la remise en ligne (pas de nouvelle date).</p>`
                    : `<input id="f-date" type="datetime-local" value="" disabled />
              <p class="uk-help" id="date-help">Fixée automatiquement à la première publication.</p>`
                  : `<input id="f-date" type="datetime-local" value="${dateVal}" />
              <p class="uk-help" id="date-help">Fait foi pour le tri et l’affichage principal.</p>`
              }
            </div>
            <div class="field field--updated">
              <label>Mise à jour</label>
              <p class="date-updated" id="f-modified">${
                d.draft
                  ? "— <span class=\"sub\">après publication, si l’article est modifié</span>"
                  : updatedLabel
                    ? escapeHtml(updatedLabel)
                    : "— <span class=\"sub\">renseignée automatiquement à l’enregistrement</span>"
              }</p>
              <button
                type="button"
                id="btn-draft"
                class="btn btn-draft ${d.draft ? "is-pressed" : ""}"
                aria-pressed="${d.draft ? "true" : "false"}"
                ${state.saving || state.translating ? "disabled" : ""}
              >Brouillon</button>
              <p class="uk-help" id="draft-help">${
                d.draft
                  ? "Enfoncé = hors ligne. Effet immédiat."
                  : state.caps.publish
                    ? "Appuyer pour passer en brouillon tout de suite."
                    : "Appuyer pour passer en brouillon. Remise en ligne : éditeur."
              }</p>
            </div>
            <div class="field">
              <label>Rubriques</label>
              <div class="chips" id="chips">${chips}<button type="button" class="chip-add" id="btn-add-category" title="Ajouter une rubrique" aria-label="Ajouter une rubrique"><span aria-hidden="true">+</span></button></div>
            </div>
            <div class="field"><label for="f-access">Accès</label>
              <select id="f-access"><option value="subscribers" ${d.access !== "granted" ? "selected" : ""}>Abonnés</option><option value="granted" ${d.access === "granted" ? "selected" : ""}>Gratuit</option></select>
            </div>
            ${
              d.access !== "granted"
                ? `<div class="field field--keywords">
              <label for="f-ia">Mots-clés IA</label>
              <textarea id="f-ia" class="kw-textarea" rows="5" placeholder="Union européenne, Meta, réseaux sociaux…" autocomplete="off" ${
                state.generatingKeywords || state.saving ? "disabled" : ""
              }>${escapeHtml((d.ia_keywords || []).join(", "))}</textarea>
              <p class="uk-help" id="kw-help">${
                state.generatingKeywords
                  ? "Analyse IA en cours…"
                  : "Auto à la sélection Abonnés et à l’enregistrement s’ils sont vides. Modifiables ensuite."
              }</p>
            </div>`
                : `<p class="uk-help">Article gratuit : tags WP à l’affichage (pas de mots-clés IA).</p>`
            }

            ${
              (() => {
                const foldOpen =
                  typeof window !== "undefined" &&
                  window.matchMedia("(min-width: 960px)").matches;
                const openAttr = foldOpen ? " open" : "";
                const pushInner = state.caps.publish
                  ? `<label class="row" style="min-height:var(--tap)">
                <input type="checkbox" id="f-push" />
                Envoyer un push à la publication
              </label>
              <p class="uk-help">Décoché par défaut. Staging : mode DRY-RUN (pas d’envoi réel) tant que <code>ONESIGNAL_DRY_RUN=1</code>.</p>
              ${
                !d.draft
                  ? `<button class="btn" type="button" id="btn-push-now" ${state.saving || state.translating ? "disabled" : ""}>Envoyer un push maintenant</button>`
                  : ""
              }`
                  : `<p class="uk-help">Publication et push réservés aux éditeurs / admins. Vous pouvez enregistrer en brouillon.</p>`;
                const xInner = `<div class="x-variants" id="x-variants">
                ${(state.x.variants || [])
                  .map(
                    (v, i) =>
                      `<button type="button" class="x-variant ${
                        state.x.text === v ? "is-active" : ""
                      }" data-x-variant="${i}" ${
                        state.x.busy ? "disabled" : ""
                      }><span class="x-variant-n">${i + 1}</span><span class="x-variant-t">${escapeHtml(
                        v
                      )}</span></button>`
                  )
                  .join("")}
              </div>
              <textarea id="f-x-text" class="x-textarea" rows="5" maxlength="500" ${
                state.x.busy || state.x.loading ? "disabled" : ""
              } placeholder="Accroche X…">${escapeHtml(state.x.text || "")}</textarea>
              <p class="x-count ${
                xWeightedLength(state.x.text) > 280 ? "is-over" : ""
              }">${xWeightedLength(state.x.text)} / 280</p>
              <div class="x-actions">
                <button class="btn" type="button" id="btn-x-generate" ${
                  state.x.busy || state.x.loading ? "disabled" : ""
                }>Générer</button>
                <button class="btn" type="button" id="btn-x-copy" ${
                  state.x.busy || state.x.loading ? "disabled" : ""
                }>Copier</button>
                <button class="btn btn-accent" type="button" id="btn-x-intent" ${
                  state.x.busy || state.x.loading ? "disabled" : ""
                }>Ouvrir sur X</button>
              </div>`;
                const ukBusy = state.translating || state.saving ? "disabled" : "";
                const ukActions =
                  (d.lang || "fr") === "en"
                    ? d.translation_fr
                      ? `<button class="btn" type="button" id="btn-open-fr">FR #${d.translation_fr}</button>
                       <button class="btn btn-uk" type="button" id="btn-retranslate" ${ukBusy}>Retraduire</button>`
                      : ""
                    : d.translation_en
                      ? `<button class="btn" type="button" id="btn-open-en">Ouvrir</button>
                       <button class="btn btn-uk" type="button" id="btn-retranslate" ${ukBusy}>Retraduire</button>`
                      : `<button class="btn btn-uk" type="button" id="btn-translate-uk" ${ukBusy}>Traduire</button>`;
                return `<details class="meta-fold push-panel"${openAttr}>
              <summary class="meta-title">OneSignal</summary>
              ${pushInner}
            </details>
            <details class="meta-fold x-panel"${openAttr}>
              <summary class="meta-title">X</summary>
              ${xInner}
            </details>
            <div class="uk-bar meta-fold">
              <span class="meta-title">Version UK</span>
              <div class="uk-bar-actions">${ukActions}</div>
            </div>`;
              })()
            }
          </div>
        </aside>
      </div>
    </main>
    <div class="sticky-actions">
      <button class="btn" type="button" id="btn-save" ${state.saving ? "disabled" : ""}>Enregistrer</button>
      ${
        state.caps.publish
          ? `<button class="btn btn-accent" type="button" id="btn-publish" ${
              canClickPublish() ? "" : "disabled"
            } title="${
              !d.draft && !canClickPublish()
                ? "Déjà publié — modifiez le texte ou les métas pour republier"
                : "Publier"
            }">Publier</button>`
          : ""
      }
    </div>`;

  document.getElementById("btn-back").onclick = async () => {
    if (!confirmLeaveEdit()) return;
    state.view = "list";
    await loadList();
  };
  document.getElementById("btn-save").onclick = () => saveArticle({ publish: false });
  const btnPublish = document.getElementById("btn-publish");
  if (btnPublish) {
    btnPublish.onclick = () =>
      saveArticle({ publish: true, skipPublishConfirm: false, allowPush: true });
  }
  const onEditDirty = () => syncPublishButton();
  document.getElementById("f-title")?.addEventListener("input", onEditDirty);
  document.getElementById("f-author")?.addEventListener("input", onEditDirty);
  document.getElementById("f-date")?.addEventListener("change", onEditDirty);
  document.getElementById("f-date")?.addEventListener("input", onEditDirty);
  const btnDraft = document.getElementById("btn-draft");
  if (btnDraft) btnDraft.onclick = () => toggleDraft();
  const btnPushNow = document.getElementById("btn-push-now");
  if (btnPushNow) btnPushNow.onclick = () => pushNow();
  const xText = document.getElementById("f-x-text");
  if (xText) {
    xText.oninput = () => {
      state.x.text = xText.value;
      const counter = app.querySelector(".x-count");
      if (counter) {
        const n = xWeightedLength(state.x.text);
        counter.textContent = `${n} / 280`;
        counter.classList.toggle("is-over", n > 280);
      }
    };
  }
  app.querySelectorAll("[data-x-variant]").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.xVariant);
      const v = state.x.variants[i];
      if (v == null) return;
      state.x.text = v;
      render();
    };
  });
  const btnXGen = document.getElementById("btn-x-generate");
  if (btnXGen) btnXGen.onclick = () => xGenerate();
  const btnXCopy = document.getElementById("btn-x-copy");
  if (btnXCopy) btnXCopy.onclick = () => xCopyText();
  const btnXIntent = document.getElementById("btn-x-intent");
  if (btnXIntent) btnXIntent.onclick = () => xOpenIntent();
  const accessSel = document.getElementById("f-access");
  if (accessSel) {
    accessSel.onchange = () => onAccessChange();
  }
  app.querySelectorAll("[data-assist]").forEach((btn) => {
    btn.onclick = () => runEditorialAssist(btn.dataset.assist);
  });
  const kwField = document.getElementById("f-ia");
  if (kwField) {
    const autosize = () => {
      kwField.style.height = "auto";
      kwField.style.height = `${Math.max(120, kwField.scrollHeight)}px`;
    };
    autosize();
    kwField.oninput = () => {
      autosize();
      onEditDirty();
    };
  }
  const authorInput = document.getElementById("f-author");
  if (authorInput) {
    if (!state.authorPick && d.author) {
      state.authorPick = {
        name: d.author,
        slug: d.author_slug || "",
        userId: d.author_user_id != null ? d.author_user_id : null,
      };
    }
    authorAc.bindInput(authorInput);
  }

  const btnUk = document.getElementById("btn-translate-uk");
  if (btnUk) btnUk.onclick = () => translateUk({ overwrite: true });
  const btnRetranslate = document.getElementById("btn-retranslate");
  if (btnRetranslate) btnRetranslate.onclick = () => translateUk({ overwrite: true });
  const btnOpenEn = document.getElementById("btn-open-en");
  if (btnOpenEn) btnOpenEn.onclick = () => openArticle(d.translation_en);
  const btnOpenFr = document.getElementById("btn-open-fr");
  if (btnOpenFr) btnOpenFr.onclick = () => openArticle(d.translation_fr);

  app.querySelectorAll(".editor-tabs [data-mode]").forEach((btn) => {
    btn.onclick = () => {
      flushEditFormToState();
      state.mode = btn.dataset.mode;
      render();
    };
  });

  app.querySelectorAll("#chips .chip").forEach((chip) => {
    chip.onclick = () => {
      chip.classList.toggle("on");
      onEditDirty();
    };
  });
  const btnAddCat = document.getElementById("btn-add-category");
  if (btnAddCat) btnAddCat.onclick = () => createRubric();

  if (state.mode === "visual") {
    const ed = getVisualEditor();
    ed.innerHTML = body || "<p><br></p>";
    ed.addEventListener("input", () => syncPublishButton());
    ed.addEventListener("paste", onVisualPaste);
    app.querySelectorAll("[data-cmd]").forEach((btn) => {
      btn.onmousedown = (e) => {
        e.preventDefault();
        const cmd = btn.dataset.cmd;
        if (cmd === "clean") {
          applyBodyClean();
          return;
        }
        if (cmd === "bold") exec("bold");
        else if (cmd === "italic") exec("italic");
        else if (cmd === "ul") exec("insertUnorderedList");
        else if (cmd === "quote") execFormatBlock("blockquote");
        else if (cmd === "undo") exec("undo");
        else if (cmd === "redo") exec("redo");
        else if (cmd === "alignLeft") exec("justifyLeft");
        else if (cmd === "alignCenter") exec("justifyCenter");
        else if (cmd === "alignRight") exec("justifyRight");
        else if (cmd === "link") {
          const url = prompt("URL du lien");
          if (url) exec("createLink", url);
        } else if (cmd === "image") {
          openMediaPicker();
        }
        syncPublishButton();
      };
    });
  }
  if (state.mode === "html") {
    getHtmlEditor()?.addEventListener("input", () => syncPublishButton());
    app.querySelectorAll('[data-cmd="clean"]').forEach((btn) => {
      btn.onclick = () => applyBodyClean();
    });
  }
  if (state.mode === "preview") {
    if (d.access === "granted" && state.previewView === "visitor") {
      state.previewView = "full";
    }
    fillArticlePreviewFrame();
    app.querySelectorAll("[data-preview-view]").forEach((btn) => {
      btn.onclick = () => {
        if (btn.disabled) return;
        const next = btn.dataset.previewView === "visitor" ? "visitor" : "full";
        if (state.previewView === next) return;
        state.previewView = next;
        app.querySelectorAll("[data-preview-view]").forEach((b) => {
          b.classList.toggle("active", b.dataset.previewView === next);
        });
        fillArticlePreviewFrame();
      };
    });
  }
  syncPublishButton();
}

/** Types acceptés à l’upload (aligné serveur). */
const MEDIA_ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,text/csv," +
  ".doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,application/zip,.zip";

function mediaPickerRoot() {
  return document.getElementById("media-picker");
}

function closeMediaPicker() {
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

async function loadMediaPage(page = 1) {
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

async function loadMediaLibrary() {
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

function openMediaPicker() {
  state.mediaPicker.open = true;
  state.mediaPicker.error = "";
  state.mediaPicker.status = "";
  state.mediaPicker.alt = "";
  state.mediaPicker.selectedId = null;
  paintMediaPicker();
  loadMediaPage(1);
}

function renderMedia() {
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
    ${navTabs("media")}
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
  bindNav();
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

function render() {
  if (state.view === "login") return renderLogin();
  if (state.view === "edit") return renderEdit();
  if (state.view === "users") return renderUsers();
  if (state.view === "user-edit") return renderUserEdit();
  if (state.view === "newsletter") return renderNewsletter();
  if (state.view === "audience") return renderAudience();
  if (state.view === "media") return renderMedia();
  return renderList();
}

/** Garde onglet navigateur si titre/corps dirty en édition. */
function onBeforeUnload(e) {
  if (state.view !== "edit" || state.saving) return;
  if (!isEditContentDirty()) return;
  e.preventDefault();
  e.returnValue = "";
}

window.addEventListener("beforeunload", onBeforeUnload);

bootstrap();
