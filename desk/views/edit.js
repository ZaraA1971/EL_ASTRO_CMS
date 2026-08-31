import { stripLeadingChapoHtml, chapo } from "../excerpt.js";
import { articlePath } from "../article-path.js";
import { state } from "../core/state.js";
import { api } from "../core/api.js";
import {
  escapeHtml,
  formatDate,
  formatDateTime,
  toDatetimeLocalValue,
  fromDatetimeLocalValue,
  updateDateLabel,
  brandBlock,
} from "../core/format.js";
import { rubricList, catLabel, loadRubrics } from "../core/rubrics.js";
import { createAutocomplete } from "../core/autocomplete.js";
import { ctx } from "../core/ctx.js";
import {
  cleanBody,
  execFormatBlock,
  getVisualEditor,
  getHtmlEditor,
  getBodyFromDom,
  applyBodyClean,
  bindVisualEditorClipboard,
  runEditorCommand,
  applyLinkFromPrompt,
  setEditBaselineFromArticle,
  isEditContentDirty,
  confirmLeaveEdit,
  canClickPublish,
  publishButtonLabel,
  isPublishUpdateAction,
  syncPublishButton,
  paintEditMessages,
  setEditBusy,
  paintEditAfterMutation,
  extractLeadingChapo,
  insertChapoAtTop,
  stripTagsPlain,
  assistResultToHtml,
  replaceSelectionOrBody,
  getAssistSourceText,
  flushEditFormToState,
} from "../core/body-editor.js";
import { loadList } from "./list.js";
import { closeMediaPicker, openMediaPicker } from "./media.js";
import {
  bindPushSegments,
  loadPushSegments,
  paintPushSegments,
  pushSegmentsHtml,
  pushTargetsPhrase,
  resetPushPanel,
  selectedPushSegments,
} from "../plugins/push.js";
import {
  loadXPanel,
  xGenerate,
  xCopyText,
  xOpenIntent,
  resetXPanel,
  xWeightedLength,
} from "../plugins/x-editor.js";

const app = document.getElementById("app");

function purifyHtml(html) {
  const raw = String(html || "");
  if (typeof DOMPurify === "undefined") return raw;
  return DOMPurify.sanitize(raw, {
    ADD_ATTR: ["target", "rel"],
  });
}

/** URL publique article (enregistré) : /articles/{id}-{slug}/ */
function articlePublicPath(article) {
  return articlePath(article);
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
          <p>Cet article est réservé aux abonnés${
            state.brand?.product ? ` ${escapeHtml(state.brand.product)}` : ""
          }.</p>
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
    ctx.render();
  } catch (err) {
    state.error = err.message || "Création rubrique impossible";
    ctx.render();
  }
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
    pinned:
      access === "granted"
        ? false
        : Boolean(document.getElementById("f-pinned")?.checked),
    // Brouillon géré par le bouton dédié (effet immédiat) — pas via Enregistrer
  };
}

async function runEditorialAssist(type) {
  if (!state.article || state.assisting || state.saving) return;
  const articleId = state.article.data.article_id;
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
      body: JSON.stringify({ type, text, articleId }),
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

export async function openArticle(articleId) {
  if (
    state.view === "edit" &&
    state.article?.data?.article_id != null &&
    Number(state.article.data.article_id) !== Number(articleId)
  ) {
    if (!confirmLeaveEdit()) return;
  }
  state.status = "";
  state.error = "";
  state.authorPick = null;
  authorAc.reset();
  resetXPanel();
  resetPushPanel();
  await loadRubrics();
  const data = await api(`/api/desk/articles/${articleId}`);
  state.article = data.article;
  setEditBaselineFromArticle(data.article);
  state.view = "edit";
  state.mode = "visual";
  await loadXPanel("el");
  ctx.render();
  paintPushSegments();
}

export async function createArticle() {
  state.status = "Création…";
  ctx.render();
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
    resetPushPanel();
    await loadXPanel("el");
    ctx.render();
    paintPushSegments();
  } catch (err) {
    state.error = err.message;
    state.status = "";
    ctx.render();
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
    pinned: payload.pinned,
  });
  if (payload.author_slug !== undefined) {
    state.article.data.author_slug = payload.author_slug;
  }
  if (payload.author_user_id !== undefined) {
    state.article.data.author_user_id = payload.author_user_id;
  }
}

/**
 * @param {{ publish?: boolean, skipPublishConfirm?: boolean }} [opts]
 *   skipPublishConfirm : confirm déjà géré (ex. undraft dirty).
 */
async function saveArticle({
  publish = false,
  skipPublishConfirm = false,
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
    // Filet : publier sans rubrique → rappel (on peut forcer).
    const cats = (payload.categories || []).map(String).filter(Boolean);
    if (!cats.length) {
      const ok = confirm(
        "Aucune rubrique n’est cochée.\n\nPublier quand même ?"
      );
      if (!ok) {
        document.getElementById("chips")?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
        return;
      }
    }
  }
  if (publish && !skipPublishConfirm) {
    const isUpdate = isPublishUpdateAction();
    const msg = isUpdate
      ? "Mettre à jour maintenant ?"
      : "Publier maintenant ?";
    if (!confirm(msg)) return;
  }
  const hadKw = (payload.ia_keywords || []).length > 0;
  const wasDraft = Boolean(state.article.data.draft);
  const asUpdate = publish && isPublishUpdateAction();
  // Sync state sans reconstruire l’éditeur (garde curseur / scroll).
  flushFormToState();
  state.error = "";
  const pubVerb = asUpdate ? "Mise à jour" : "Publication";
  state.status =
    payload.access === "subscribers" && !hadKw
      ? publish
        ? `${pubVerb} + mots-clés IA…`
        : "Enregistrement + mots-clés IA…"
      : publish
        ? `${pubVerb}…`
        : "Enregistrement…";
  setEditBusy(true);
  try {
    const articleId = state.article.data.article_id;
    const data = await api(`/api/desk/articles/${articleId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (publish) {
      const pub = await api(`/api/desk/articles/${articleId}/publish`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      state.article = pub.article;
      setEditBaselineFromArticle(pub.article);
      state.status = "Publié — en ligne sans rebuild";
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
      ctx.render();
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
    const articleId = state.article.data.article_id;
    const data = await api(`/api/desk/articles/${articleId}/keywords`, {
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
    ctx.render();
    return;
  }
  ctx.render();
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
    const articleId = state.article.data.article_id;
    const data = await api(`/api/desk/articles/${articleId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    state.article = data.article;
    const drafted = await api(`/api/desk/articles/${articleId}/draft`, {
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
      const btnPush = document.getElementById("btn-push-now");
      if (btnPush) btnPush.disabled = true;
    } else {
      ctx.render();
    }
  }
}

async function pushNow() {
  if (!state.article || state.article.data.draft) return;
  if (!state.caps.publish) {
    state.error = "Push réservé éditeur/admin";
    ctx.render();
    return;
  }
  const targets = pushTargetsPhrase();
  const ok = confirm(`Envoyer une notification maintenant à ${targets} ?`);
  if (!ok) return;
  state.saving = true;
  state.error = "";
  state.status = "Envoi push…";
  ctx.render();
  try {
    const articleId = state.article.data.article_id;
    const data = await api(`/api/desk/articles/${articleId}/push`, {
      method: "POST",
      body: JSON.stringify({ segments: selectedPushSegments() }),
    });
    state.status = data.push?.dryRun
      ? "Push DRY-RUN — aucun envoi réel"
      : `Push envoyé (${data.push?.recipients ?? "?"} dest.)`;
  } catch (err) {
    state.error = err.message;
    state.status = "";
  } finally {
    state.saving = false;
    ctx.render();
  }
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
  ctx.render();

  try {
    // Sauvegarder le contenu courant avant traduction (surtout si on est sur le FR)
    if (!isEn) {
      const payload = collectForm();
      if (payload) {
        const saved = await api(`/api/desk/articles/${d.article_id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        state.article = saved.article;
      }
    }

    const sourceId = isEn ? d.translation_fr : d.article_id;
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
    ctx.render();
  }
}

export function renderEdit() {
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
      ${brandBlock("Édition", `#${d.article_id} · ${d.draft ? "brouillon" : "en ligne"}`)}
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
                    <button type="button" class="btn" data-cmd="link" title="Ou coller une URL sur le texte sélectionné">Lien</button>
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
              state.caps.publish && d.access !== "granted"
                ? `<label class="row" style="min-height:var(--tap)">
                <input type="checkbox" id="f-pinned" ${d.pinned ? "checked" : ""} />
                Épingler en Une
              </label>
              <p class="uk-help">Remplace le dernier article abonnés. Un seul épinglé par langue.</p>`
                : d.pinned
                  ? `<p class="uk-help">Épinglé en Une.</p>`
                  : ""
            }
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
                  ? `<div id="push-segments-wrap">${pushSegmentsHtml()}</div>
              <button class="btn" type="button" id="btn-push-now" ${
                d.draft || state.saving || state.translating ? "disabled" : ""
              }>Envoyer un push maintenant</button>
              ${
                d.draft
                  ? `<p class="uk-help">Publiez d’abord, puis envoyez le push.</p>`
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
                ? "Déjà publié — modifiez le texte ou les métas pour mettre à jour"
                : escapeHtml(publishButtonLabel())
            }">${escapeHtml(publishButtonLabel())}</button>`
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
      saveArticle({ publish: true, skipPublishConfirm: false });
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
  bindPushSegments();
  if (state.caps.publish) {
    void loadPushSegments().then(() => {
      if (state.view === "edit") paintPushSegments();
    });
  }
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
      ctx.render();
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
  const pinBox = document.getElementById("f-pinned");
  if (pinBox) {
    pinBox.onchange = () => {
      if (pinBox.checked) {
        const ok = confirm(
          "Épingler en Une ? Un autre article épinglé sera retiré."
        );
        if (!ok) {
          pinBox.checked = false;
          return;
        }
      }
      if (state.article) state.article.data.pinned = pinBox.checked;
      onEditDirty();
    };
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
      ctx.render();
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
    bindVisualEditorClipboard(ed);
    app.querySelectorAll("[data-cmd]").forEach((btn) => {
      btn.onmousedown = (e) => {
        e.preventDefault();
        const cmd = btn.dataset.cmd;
        if (cmd === "clean") {
          applyBodyClean();
          return;
        }
        if (cmd === "bold") runEditorCommand("bold");
        else if (cmd === "italic") runEditorCommand("italic");
        else if (cmd === "ul") runEditorCommand("insertUnorderedList");
        else if (cmd === "quote") execFormatBlock("blockquote");
        else if (cmd === "undo") runEditorCommand("undo");
        else if (cmd === "redo") runEditorCommand("redo");
        else if (cmd === "alignLeft") runEditorCommand("justifyLeft");
        else if (cmd === "alignCenter") runEditorCommand("justifyCenter");
        else if (cmd === "alignRight") runEditorCommand("justifyRight");
        else if (cmd === "link") {
          applyLinkFromPrompt();
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
