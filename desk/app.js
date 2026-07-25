const CATEGORIES = [
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

const state = {
  user: null,
  caps: { manageUsers: false, editAll: false, publish: false },
  view: "list", // list | edit | users | user-edit | newsletter | login
  articles: [],
  total: 0,
  q: "",
  filterDraft: "",
  article: null,
  mode: "visual", // visual | html | preview
  users: [],
  usersTotal: 0,
  usersQ: "",
  usersRole: "",
  usersStatus: "",
  usersMeta: { roles: ["subscriber", "other"], statuses: ["active", "disabled", "expired"] },
  usersSuggestOpen: false,
  usersSuggestIndex: -1,
  listSuggestOpen: false,
  listSuggestIndex: -1,
  editUser: null, // null = create
  generatedPassword: "",
  nlDate: new Date().toISOString().slice(0, 10),
  // Défaut sûr : admin seulement (évite l’envoi « tout le monde » par oubli de décocher)
  nlGroups: { admin: true, redacteurs: false, abonnes: false },
  nlPreview: null,
  nlHistory: [],
  nlDryRun: true,
  status: "",
  error: "",
  saving: false,
  translating: false,
  _searchTimers: {},
  _searchSeq: { users: 0, list: 0 },
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

function catLabel(slug) {
  return CATEGORIES.find((c) => c.value === slug)?.label || slug;
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
  try {
    return new Date(d).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function cleanHtml(html) {
  return String(html || "")
    .replace(/\s*data-(?:start|end|pm-slice|pm-paste)=["'][^"']*["']/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+>/g, ">")
    .trim();
}

function exec(cmd, value) {
  document.execCommand(cmd, false, value);
}

function getBodyFromDom() {
  if (state.mode === "visual") {
    const el = document.getElementById("visual-editor");
    return el ? cleanHtml(el.innerHTML) : state.article?.body || "";
  }
  if (state.mode === "html") {
    const el = document.getElementById("html-editor");
    return el ? el.value : state.article?.body || "";
  }
  return state.article?.body || "";
}

function collectForm() {
  const a = state.article;
  if (!a) return null;
  const cats = [...document.querySelectorAll(".chip.on")].map((el) => el.dataset.value);
  const tagsRaw = document.getElementById("f-tags")?.value || "";
  const iaRaw = document.getElementById("f-ia")?.value || "";
  return {
    title: document.getElementById("f-title")?.value?.trim() || a.data.title,
    excerpt: document.getElementById("f-excerpt")?.value || "",
    body: getBodyFromDom(),
    author: document.getElementById("f-author")?.value || a.data.author,
    date: document.getElementById("f-date")?.value
      ? new Date(document.getElementById("f-date").value).toISOString()
      : a.data.date,
    categories: cats,
    category_names: cats.map(catLabel),
    tags: tagsRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    ia_keywords: iaRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    lang: document.getElementById("f-lang")?.value || "fr",
    access: document.getElementById("f-access")?.value || "subscribers",
    draft: document.getElementById("f-draft")?.checked ?? true,
  };
}

function desiredViewFromUrl() {
  try {
    const v = new URLSearchParams(location.search).get("view") || "";
    if (v === "newsletter" || v === "users" || v === "list") return v;
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
  if (wanted === "users" && state.caps.manageUsers) {
    state.view = "users";
    syncViewToUrl("users");
    await loadUsers();
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
  return `
    <nav class="desk-nav" aria-label="Sections">
      <button type="button" class="nav-tab ${active === "list" ? "active" : ""}" data-nav="list">Articles</button>
      ${nlTab}
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

function debounceSearch(key, fn, waitMs = 220) {
  clearTimeout(state._searchTimers[key]);
  state._searchTimers[key] = setTimeout(fn, waitMs);
}

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
            u.access_until
              ? ` · jusqu’au ${escapeHtml(formatDate(u.access_until))}`
              : ""
          }${u.entitled ? "" : " · sans accès premium"}</div>
        </button>`;
    })
    .join("");
}

function usersSuggestHtml() {
  const q = String(state.usersQ || "").trim();
  if (!state.usersSuggestOpen || !q || !state.users.length) return "";
  const items = state.users.slice(0, 8).map((u, i) => {
    const active = i === state.usersSuggestIndex ? " is-active" : "";
    return `<button type="button" class="search-suggest__item${active}" data-user-suggest="${u.id}" role="option" aria-selected="${
      i === state.usersSuggestIndex ? "true" : "false"
    }">
      <strong>${escapeHtml(u.name || u.login)}</strong>
      <span>${escapeHtml(u.login)} · ${escapeHtml(u.email || "")} · ${escapeHtml(
        ROLE_LABELS[u.role] || u.role
      )}</span>
    </button>`;
  });
  return `<div class="search-suggest" id="users-suggest" role="listbox">${items.join("")}</div>`;
}

function bindUsersResultClicks(root = app) {
  root.querySelectorAll("[data-user]").forEach((btn) => {
    btn.onclick = () => openUser(btn.dataset.user);
  });
  root.querySelectorAll("[data-user-suggest]").forEach((btn) => {
    btn.onclick = () => {
      state.usersSuggestOpen = false;
      openUser(btn.dataset.userSuggest);
    };
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
  const wrap = document.getElementById("users-search-wrap");
  if (wrap) {
    const prev = document.getElementById("users-suggest");
    if (prev) prev.remove();
    const html = usersSuggestHtml();
    if (html) {
      wrap.insertAdjacentHTML("beforeend", html);
      bindUsersResultClicks(wrap);
    }
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

async function loadUsers({ soft = false } = {}) {
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
    } else {
      render();
    }
  } catch (err) {
    if (seq !== state._searchSeq.users) return;
    state.error = err.message || "Erreur recherche";
    if (soft && state.view === "users" && document.getElementById("users-results")) {
      patchUsersResults();
    } else {
      render();
    }
  }
}

function scheduleUsersSearch(raw) {
  state.usersQ = raw;
  state.usersSuggestOpen = Boolean(String(raw || "").trim());
  state.usersSuggestIndex = -1;
  debounceSearch("users", () => loadUsers({ soft: true }), 200);
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
  if (!v) return "";
  try {
    return new Date(v).toISOString().slice(0, 16);
  } catch {
    return "";
  }
}

async function saveUser(ev) {
  ev?.preventDefault?.();
  if (!state.editUser) return;
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
    access_until: accessRaw ? new Date(accessRaw).toISOString() : null,
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

async function deleteUser() {
  if (!state.editUser?.id) return;
  const label = state.editUser.login || state.editUser.email || state.editUser.id;
  if (
    !confirm(
      `Supprimer définitivement le compte « ${label} » ?\nCette action est irréversible.`
    )
  ) {
    return;
  }
  if (
    !confirm(
      `Confirmer la suppression de « ${label} » (${ROLE_LABELS[state.editUser.role] || state.editUser.role}) ?`
    )
  ) {
    return;
  }
  state.saving = true;
  state.error = "";
  state.status = "Suppression…";
  render();
  try {
    await api(`/api/desk/users/${state.editUser.id}`, { method: "DELETE" });
    state.editUser = null;
    state.generatedPassword = "";
    state.view = "users";
    state.status = `Compte « ${label} » supprimé`;
    state.saving = false;
    await loadUsers();
  } catch (err) {
    state.error = err.message || "Échec suppression";
    state.status = "";
    state.saving = false;
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
            <span class="sub">${escapeHtml(formatDate(d.date))} · ${escapeHtml(d.lang || "fr")}</span>
          </div>
          <h2>${escapeHtml(d.title)}</h2>
          <div class="sub">${escapeHtml(d.author || "")}</div>
        </button>`;
    })
    .join("");
}

function articlesSuggestHtml() {
  const q = String(state.q || "").trim();
  if (!state.listSuggestOpen || !q || !state.articles.length) return "";
  const items = state.articles.slice(0, 8).map((a, i) => {
    const d = a.data;
    const active = i === state.listSuggestIndex ? " is-active" : "";
    return `<button type="button" class="search-suggest__item${active}" data-article-suggest="${d.wp_id}" role="option" aria-selected="${
      i === state.listSuggestIndex ? "true" : "false"
    }">
      <strong>${escapeHtml(d.title)}</strong>
      <span>${escapeHtml(formatDate(d.date))} · ${escapeHtml(d.author || "")}${
        d.draft ? " · brouillon" : ""
      }</span>
    </button>`;
  });
  return `<div class="search-suggest" id="list-suggest" role="listbox">${items.join("")}</div>`;
}

function bindListResultClicks(root = app) {
  root.querySelectorAll("[data-open]").forEach((btn) => {
    btn.onclick = () => openArticle(btn.dataset.open);
  });
  root.querySelectorAll("[data-article-suggest]").forEach((btn) => {
    btn.onclick = () => {
      state.listSuggestOpen = false;
      openArticle(btn.dataset.articleSuggest);
    };
  });
}

function patchListResults() {
  const count = document.getElementById("list-count");
  if (count) count.textContent = `${state.total} article(s)`;
  const list = document.getElementById("list-results");
  if (list) {
    list.innerHTML =
      articlesItemsHtml(state.articles) || `<div class="empty">Aucun article</div>`;
    bindListResultClicks(list);
  }
  const wrap = document.getElementById("list-search-wrap");
  if (wrap) {
    document.getElementById("list-suggest")?.remove();
    const html = articlesSuggestHtml();
    if (html) {
      wrap.insertAdjacentHTML("beforeend", html);
      bindListResultClicks(wrap);
    }
  }
}

async function loadList({ soft = false } = {}) {
  const seq = (state._searchSeq.list += 1);
  const params = new URLSearchParams({ limit: "30" });
  const q = String(state.q || "").trim();
  if (q) params.set("q", q);
  if (state.filterDraft !== "") params.set("draft", state.filterDraft);
  try {
    const data = await api(`/api/desk/articles?${params}`);
    if (seq !== state._searchSeq.list) return;
    state.articles = data.articles || [];
    state.total = data.total || 0;
    if (soft && state.view === "list" && document.getElementById("list-results")) {
      patchListResults();
    } else {
      render();
    }
  } catch (err) {
    if (seq !== state._searchSeq.list) return;
    state.error = err.message || "Erreur recherche";
    if (soft && state.view === "list" && document.getElementById("list-results")) {
      patchListResults();
    } else {
      render();
    }
  }
}

function scheduleListSearch(raw) {
  state.q = raw;
  state.listSuggestOpen = Boolean(String(raw || "").trim());
  state.listSuggestIndex = -1;
  debounceSearch("list", () => loadList({ soft: true }), 200);
}

async function openArticle(wpId) {
  state.status = "";
  state.error = "";
  const data = await api(`/api/desk/articles/${wpId}`);
  state.article = data.article;
  state.view = "edit";
  state.mode = "visual";
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
    state.view = "edit";
    state.mode = "visual";
    state.status = "";
    render();
  } catch (err) {
    state.error = err.message;
    state.status = "";
    render();
  }
}

async function saveArticle({ publish = false } = {}) {
  const payload = collectForm();
  if (!payload || !state.article) return;
  if (publish) {
    if (!state.caps.publish) {
      state.error = "Publication réservée éditeur/admin";
      render();
      return;
    }
    payload.draft = false;
  }
  const wantPush =
    Boolean(state.caps.publish) &&
    Boolean(document.getElementById("f-push")?.checked);
  state.saving = true;
  state.error = "";
  state.status = publish
    ? wantPush
      ? "Publication + push…"
      : "Publication…"
    : "Enregistrement…";
  render();
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
      state.status = "Enregistré";
    }
  } catch (err) {
    state.error = err.message;
    state.status = "";
  } finally {
    state.saving = false;
    render();
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
          ${articlesSuggestHtml()}
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
      <p class="count-line" id="list-count">${state.total} article(s)</p>
      ${state.error ? `<p class="err">${escapeHtml(state.error)}</p>` : ""}
      <div id="list-results">${items}</div>
    </main>
    <button class="fab" type="button" id="btn-new" title="Nouvel article" aria-label="Nouvel article">+</button>`;

  document.getElementById("btn-logout").onclick = logout;
  document.getElementById("btn-new").onclick = () => createArticle();
  bindNav();
  const qInput = document.getElementById("q");
  qInput.oninput = (e) => scheduleListSearch(e.target.value);
  bindSuggestKeyboard(qInput, {
    getOpen: () => state.listSuggestOpen,
    setOpen: (v) => {
      state.listSuggestOpen = v;
    },
    getIndex: () => state.listSuggestIndex,
    setIndex: (v) => {
      state.listSuggestIndex = v;
    },
    getItems: () => state.articles.slice(0, 8),
    onPick: (a) => {
      state.listSuggestOpen = false;
      openArticle(a.data.wp_id);
    },
    onClose: (mode) => {
      if (mode === "refresh") patchListResults();
    },
  });
  app.querySelectorAll("[data-draft]").forEach((btn) => {
    btn.onclick = async () => {
      state.filterDraft = btn.dataset.draft;
      await loadList({ soft: true });
    };
  });
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
          ${usersSuggestHtml()}
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
  const qInput = document.getElementById("users-q");
  qInput.oninput = (e) => scheduleUsersSearch(e.target.value);
  bindSuggestKeyboard(qInput, {
    getOpen: () => state.usersSuggestOpen,
    setOpen: (v) => {
      state.usersSuggestOpen = v;
    },
    getIndex: () => state.usersSuggestIndex,
    setIndex: (v) => {
      state.usersSuggestIndex = v;
    },
    getItems: () => state.users.slice(0, 8),
    onPick: (u) => {
      state.usersSuggestOpen = false;
      openUser(u.id);
    },
    onClose: (mode) => {
      if (mode === "refresh") patchUsersResults();
    },
  });
  app.querySelectorAll("[data-ufilter]").forEach((btn) => {
    btn.onclick = async () => {
      state.usersRole = btn.dataset.ufilter || "";
      state.usersStatus = "";
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
        <div class="field">
          <label for="u-until">Fin d’accès premium (optionnel)</label>
          <input id="u-until" type="datetime-local" value="${escapeHtml(accessUntilInputValue(u.access_until))}" />
          <p class="uk-help">Vide = pas de date limite. Passée = plus d’accès premium même si statut actif.</p>
        </div>
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
          <button class="btn btn-primary" type="submit" ${state.saving ? "disabled" : ""}>Enregistrer</button>
          ${
            !isNew
              ? `<button class="btn" type="button" id="btn-regen-pwd" ${state.saving ? "disabled" : ""}>Régénérer le mot de passe</button>`
              : ""
          }
          <button class="btn" type="button" id="btn-cancel-user">Annuler</button>
          ${
            !isNew && !isSelf
              ? `<button class="btn btn-danger" type="button" id="btn-delete-user" ${state.saving ? "disabled" : ""}>Supprimer</button>`
              : ""
          }
        </div>
      </form>
    </main>`;

  document.getElementById("btn-back-users").onclick = async () => {
    state.view = "users";
    state.editUser = null;
    state.generatedPassword = "";
    await loadUsers();
  };
  document.getElementById("btn-cancel-user").onclick = async () => {
    state.view = "users";
    state.editUser = null;
    state.generatedPassword = "";
    await loadUsers();
  };
  document.getElementById("user-form").onsubmit = (e) => saveUser(e);
  const regenBtn = document.getElementById("btn-regen-pwd");
  if (regenBtn) regenBtn.onclick = () => regenerateUserPassword();
  const delBtn = document.getElementById("btn-delete-user");
  if (delBtn) delBtn.onclick = () => deleteUser();
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
  const a = state.article;
  const d = a.data;
  const dateVal = d.date
    ? new Date(d.date).toISOString().slice(0, 16)
    : "";
  const chips = CATEGORIES.map((c) => {
    const on = (d.categories || []).includes(c.value) ? "on" : "";
    return `<button type="button" class="chip ${on}" data-value="${c.value}">${escapeHtml(c.label)}</button>`;
  }).join("");

  const body = a.body || "";
  const editorPane =
    state.mode === "html"
      ? `<textarea class="html-editor" id="html-editor">${escapeHtml(body)}</textarea>`
      : state.mode === "preview"
        ? `<div class="visual-editor" id="preview-pane"></div>`
        : `<div class="visual-editor" id="visual-editor" contenteditable="true" role="textbox" aria-label="Texte"></div>`;

  app.innerHTML = `
    <header class="topbar">
      ${brandBlock("Édition", `#${d.wp_id} · ${d.draft ? "brouillon" : "en ligne"}`)}
      <button class="btn btn-ghost" type="button" id="btn-back">Liste</button>
    </header>
    <main class="main main-edit">
      <div class="edit-grid">
        <section class="edit-col-write" aria-label="Rédaction">
          <input class="title-input" id="f-title" value="${escapeHtml(d.title)}" placeholder="Titre" />
          <div class="field">
            <label for="f-excerpt">Chapô</label>
            <textarea id="f-excerpt" rows="3">${escapeHtml(d.excerpt || "")}</textarea>
          </div>

          <div class="row" style="justify-content:space-between">
            <div class="editor-tabs">
              <button type="button" data-mode="visual" class="${state.mode === "visual" ? "active" : ""}">Écrire</button>
              <button type="button" data-mode="preview" class="${state.mode === "preview" ? "active" : ""}">Aperçu</button>
              <button type="button" data-mode="html" class="${state.mode === "html" ? "active" : ""}">HTML</button>
            </div>
          </div>
          ${
            state.mode === "visual"
              ? `<div class="editor-toolbar">
                  <button type="button" class="btn" data-cmd="bold">Gras</button>
                  <button type="button" class="btn" data-cmd="italic">Italique</button>
                  <button type="button" class="btn" data-cmd="h2">Titre</button>
                  <button type="button" class="btn" data-cmd="p">Paragraphe</button>
                  <button type="button" class="btn" data-cmd="ul">Liste</button>
                  <button type="button" class="btn" data-cmd="link">Lien</button>
                  <button type="button" class="btn" data-cmd="clean">Nettoyer</button>
                </div>`
              : ""
          }
          ${editorPane}
          ${state.error ? `<p class="err">${escapeHtml(state.error)}</p>` : ""}
          ${state.status ? `<p class="ok">${escapeHtml(state.status)}</p>` : ""}
        </section>

        <aside class="edit-col-meta" aria-label="Publication">
          <p class="meta-title">Publication</p>
          <div class="stack">
            <div class="field"><label for="f-author">Auteur</label><input id="f-author" value="${escapeHtml(d.author || "")}" /></div>
            <div class="field"><label for="f-date">Date</label><input id="f-date" type="datetime-local" value="${dateVal}" /></div>
            <div class="field"><label>Rubriques</label><div class="chips" id="chips">${chips}</div></div>
            <div class="field"><label for="f-tags">Mots-clés (virgules)</label><input id="f-tags" value="${escapeHtml((d.tags || []).join(", "))}" /></div>
            <div class="field"><label for="f-ia">Mots-clés IA</label><input id="f-ia" value="${escapeHtml((d.ia_keywords || []).join(", "))}" /></div>
            <div class="field"><label for="f-lang">Langue</label>
              <select id="f-lang"><option value="fr" ${d.lang === "fr" ? "selected" : ""}>Français</option><option value="en" ${d.lang === "en" ? "selected" : ""}>English (UK)</option></select>
            </div>
            <div class="field"><label for="f-access">Accès</label>
              <select id="f-access"><option value="subscribers" ${d.access !== "granted" ? "selected" : ""}>Abonnés</option><option value="granted" ${d.access === "granted" ? "selected" : ""}>Gratuit</option></select>
            </div>
            <label class="row" style="min-height:var(--tap)"><input type="checkbox" id="f-draft" ${d.draft ? "checked" : ""} ${state.caps.publish ? "" : "disabled"} /> Brouillon${!state.caps.publish ? " <span class=\"sub\">(publication éditeur)</span>" : ""}</label>

            ${
              state.caps.publish
                ? `<div class="push-panel">
              <p class="meta-title">OneSignal</p>
              <label class="row" style="min-height:var(--tap)">
                <input type="checkbox" id="f-push" />
                Envoyer un push à la publication
              </label>
              <p class="uk-help">Décoché par défaut. Staging : mode DRY-RUN (pas d’envoi réel) tant que <code>ONESIGNAL_DRY_RUN=1</code>.</p>
              ${
                !d.draft
                  ? `<button class="btn" type="button" id="btn-push-now" ${state.saving || state.translating ? "disabled" : ""}>Envoyer un push maintenant</button>`
                  : ""
              }
            </div>`
                : `<div class="push-panel"><p class="uk-help">Publication et push réservés aux éditeurs / admins. Vous pouvez enregistrer en brouillon.</p></div>`
            }

            <div class="uk-panel">
              <p class="meta-title">Version UK</p>
              ${
                (d.lang || "fr") === "en"
                  ? `<p class="uk-help">Article anglais (DeepL EN-GB). Publication après relecture.</p>
                     ${
                       d.translation_fr
                         ? `<button class="btn" type="button" id="btn-open-fr">Ouvrir le FR #${d.translation_fr}</button>
                            <button class="btn btn-uk" type="button" id="btn-retranslate" ${state.translating || state.saving ? "disabled" : ""}>Retraduire depuis le FR</button>`
                         : `<p class="sub">Pas de lien FR.</p>`
                     }`
                  : d.translation_en
                    ? `<p class="uk-help">Lié à l’EN <strong>#${d.translation_en}</strong></p>
                       <button class="btn" type="button" id="btn-open-en">Ouvrir la version UK</button>
                       <button class="btn btn-uk" type="button" id="btn-retranslate" ${state.translating || state.saving ? "disabled" : ""}>Retraduire (écraser)</button>`
                    : `<p class="uk-help">Crée un brouillon EN-GB via DeepL (titre, chapô, corps). Validation humaine ensuite.</p>
                       <button class="btn btn-uk" type="button" id="btn-translate-uk" ${state.translating || state.saving ? "disabled" : ""}>Créer version UK</button>`
              }
            </div>
          </div>
        </aside>
      </div>
    </main>
    <div class="sticky-actions">
      <button class="btn" type="button" id="btn-save" ${state.saving ? "disabled" : ""}>Enregistrer</button>
      ${
        state.caps.publish
          ? `<button class="btn btn-accent" type="button" id="btn-publish" ${state.saving ? "disabled" : ""}>Publier</button>`
          : ""
      }
    </div>`;

  document.getElementById("btn-back").onclick = async () => {
    state.view = "list";
    await loadList();
  };
  document.getElementById("btn-save").onclick = () => saveArticle({ publish: false });
  const btnPublish = document.getElementById("btn-publish");
  if (btnPublish) btnPublish.onclick = () => saveArticle({ publish: true });
  const btnPushNow = document.getElementById("btn-push-now");
  if (btnPushNow) btnPushNow.onclick = () => pushNow();

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
      if (state.mode === "visual" || state.mode === "html") {
        state.article.body = getBodyFromDom();
      }
      state.mode = btn.dataset.mode;
      render();
    };
  });

  app.querySelectorAll("#chips .chip").forEach((chip) => {
    chip.onclick = () => chip.classList.toggle("on");
  });

  if (state.mode === "visual") {
    const ed = document.getElementById("visual-editor");
    ed.innerHTML = body || "<p><br></p>";
    app.querySelectorAll("[data-cmd]").forEach((btn) => {
      btn.onmousedown = (e) => {
        e.preventDefault();
        const cmd = btn.dataset.cmd;
        if (cmd === "bold") exec("bold");
        else if (cmd === "italic") exec("italic");
        else if (cmd === "h2") exec("formatBlock", "h2");
        else if (cmd === "p") exec("formatBlock", "p");
        else if (cmd === "ul") exec("insertUnorderedList");
        else if (cmd === "link") {
          const url = prompt("URL du lien");
          if (url) exec("createLink", url);
        } else if (cmd === "clean") {
          ed.innerHTML = cleanHtml(ed.innerHTML);
        }
      };
    });
  }
  if (state.mode === "preview") {
    document.getElementById("preview-pane").innerHTML = purifyHtml(
      body || "<p><em>Vide</em></p>"
    );
  }
}

function render() {
  if (state.view === "login") return renderLogin();
  if (state.view === "edit") return renderEdit();
  if (state.view === "users") return renderUsers();
  if (state.view === "user-edit") return renderUserEdit();
  if (state.view === "newsletter") return renderNewsletter();
  return renderList();
}

bootstrap();
