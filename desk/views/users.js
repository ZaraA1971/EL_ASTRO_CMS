import { state } from "../core/state.js";
import { api } from "../core/api.js";
import {
  escapeHtml,
  formatDate,
  formatDateTime,
  filterChips,
  brandBlock,
  listMetaRow,
  toDatetimeLocalValue,
  fromDatetimeLocalValue,
} from "../core/format.js";
import {
  rangeLabel,
  pagerHtml,
  bindPager,
  patchPagerHosts,
} from "../core/pager.js";
import { createAutocomplete } from "../core/autocomplete.js";
import { ctx } from "../core/ctx.js";
import { logout } from "./login.js";

const app = document.getElementById("app");

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

const STAFF_ROLES = new Set(["admin", "editor", "author"]);

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
    state.usersPage = 1;
    await loadUsers({ soft: true, fromAc: true });
    return state.users;
  },
  mapItem: (u) => ({
    title: u.name || u.login,
    sub: [
      u.login,
      u.email || "",
      ROLE_LABELS[u.role] || u.role,
      u.entitled ? "premium" : "sans premium",
    ]
      .filter(Boolean)
      .join(" · "),
  }),
  onPick: (u) => openUser(u.id),
  onInput: (q) => {
    state.usersQ = q;
    state.usersPage = 1;
  },
});

function usersItemsHtml(users) {
  return (users || [])
    .map((u) => {
      const st = u.status || "active";
      const badgeClass =
        st === "active" ? "live" : st === "disabled" ? "draft" : "warn";
      const isStaff = STAFF_ROLES.has(u.role);
      const accessBits = [];
      if (u.entitled) accessBits.push("Premium oui");
      else accessBits.push("Premium non");
      if (u.desk) accessBits.push("Pupitre");
      if (!isStaff && u.access_until) {
        accessBits.push(`Fin période ${formatDate(u.access_until)}`);
      } else if (!isStaff && !u.access_until && u.role === "subscriber") {
        accessBits.push("Sans date de fin");
      }
      const nl =
        u.newsletter_opt_in === undefined
          ? null
          : u.newsletter_opt_in
            ? "Oui"
            : "Non";
      const registered = formatDate(u.registered);
      const updated = formatDateTime(u.updated_at);
      return `
        <button class="list-item list-item--user" type="button" data-user="${u.id}">
          <div class="row" style="justify-content:space-between;gap:8px;flex-wrap:wrap">
            <span class="badge ${badgeClass}">${escapeHtml(STATUS_LABELS[st] || st)}</span>
            <span class="badge badge-role">${escapeHtml(ROLE_LABELS[u.role] || u.role)}</span>
          </div>
          <h2>${escapeHtml(u.name || u.login)}</h2>
          <div class="list-item-meta">
            ${listMetaRow("Identifiant", u.login)}
            ${listMetaRow("Email", u.email || "—")}
            ${listMetaRow("Accès", accessBits.join(" · "))}
            ${nl != null ? listMetaRow("Newsletter", nl) : ""}
            ${registered ? listMetaRow("Inscrit", registered) : ""}
            ${updated ? listMetaRow("Mis à jour", updated) : ""}
          </div>
        </button>`;
    })
    .join("");
}

function bindUsersResultClicks(root = app) {
  root.querySelectorAll("[data-user]").forEach((btn) => {
    btn.onclick = () => openUser(btn.dataset.user);
  });
}

function usersRangeLabel() {
  return rangeLabel({
    total: state.usersTotal,
    page: state.usersPage,
    limit: state.usersLimit,
    singular: "compte",
  });
}

function usersPagerHtml() {
  return pagerHtml({
    page: state.usersPage,
    pages: state.usersPages,
    total: state.usersTotal,
    limit: state.usersLimit,
    ariaLabel: "Pagination comptes",
    dataAttr: "users-page",
  });
}

async function goUsersPage(next) {
  const page = Number(next);
  if (!Number.isFinite(page) || page < 1 || page === state.usersPage) return;
  state.usersPage = page;
  usersAc.close();
  await loadUsers({ soft: true });
  document.getElementById("users-results")?.scrollIntoView({ block: "start" });
}

function bindUsersPager(root = app) {
  bindPager(root, "users-page", goUsersPage);
}

function patchUsersResults() {
  const count = document.getElementById("users-count");
  if (count) count.textContent = usersRangeLabel();
  const list = document.getElementById("users-results");
  if (list) {
    list.innerHTML = usersItemsHtml(state.users) || `<div class="empty">Aucun compte</div>`;
    bindUsersResultClicks(list);
  }
  patchPagerHosts(
    ["users-pager-host", "users-pager-host-bottom"],
    usersPagerHtml(),
    bindUsersPager
  );
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

export async function loadUsers({ soft = false, fromAc = false } = {}) {
  const seq = (state._searchSeq.users += 1);
  const page = Math.max(1, Number(state.usersPage || 1));
  const limit = Math.min(50, Math.max(10, Number(state.usersLimit || 25)));
  const params = new URLSearchParams({
    limit: String(limit),
    page: String(page),
  });
  const q = String(state.usersQ || "").trim();
  if (q) params.set("q", q);
  if (state.usersRole) params.set("role", state.usersRole);
  if (state.usersStatus) params.set("status", state.usersStatus);
  try {
    const data = await api(`/api/desk/users?${params}`);
    if (seq !== state._searchSeq.users) return; // réponse obsolète
    state.users = data.users || [];
    state.usersTotal = data.total || 0;
    state.usersLimit = data.limit || limit;
    state.usersPages =
      data.pages ||
      Math.max(1, Math.ceil(state.usersTotal / state.usersLimit) || 1);
    state.usersPage = Math.min(data.page || page, state.usersPages);
    if (data.meta) state.usersMeta = data.meta;
    state.error = "";
    if (soft && state.view === "users" && document.getElementById("users-results")) {
      patchUsersResults();
      if (!fromAc) usersAc.syncItems(state.users, state.usersQ);
    } else if (!fromAc) {
      renderUsers();
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
      renderUsers();
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

/** Lit le formulaire compte depuis le DOM (sans re-render). */
function readUserFormDom() {
  const roleEl = document.getElementById("u-role");
  const role = roleEl?.disabled
    ? state.editUser?.role || "subscriber"
    : roleEl?.value || "subscriber";
  return {
    login: document.getElementById("u-login")?.value?.trim().toLowerCase() || "",
    email: document.getElementById("u-email")?.value?.trim().toLowerCase() || "",
    name: document.getElementById("u-name")?.value?.trim() || "",
    role,
    status: document.getElementById("u-status")?.value || "active",
    access_until: fromDatetimeLocalValue(
      document.getElementById("u-until")?.value || ""
    ),
    notes: document.getElementById("u-notes")?.value || "",
    password: document.getElementById("u-password")?.value || "",
    newsletter_opt_in: Boolean(
      document.getElementById("u-newsletter")?.checked
    ),
  };
}

/** Persiste les valeurs du formulaire dans state avant tout render. */
function syncUserFormToState() {
  if (!state.editUser || state.view !== "user-edit") return null;
  if (!document.getElementById("user-form")) return null;
  const form = readUserFormDom();
  state.editUser = {
    ...state.editUser,
    login: form.login,
    email: form.email,
    name: form.name,
    role: form.role,
    status: form.status,
    access_until: form.access_until,
    notes: form.notes,
    newsletter_opt_in: form.newsletter_opt_in,
  };
  state.userPasswordDraft = form.password;
  return form;
}

function validateUserFormFields(form, isNew) {
  const errors = {};
  const login = String(form.login || "");
  if (!login) {
    errors.login = "Identifiant requis.";
  } else if (!/^[a-z0-9._-]{3,60}$/.test(login)) {
    errors.login =
      "Identifiant : 3–60 caractères (a-z, 0-9, point, underscore, tiret).";
  }
  const email = String(form.email || "");
  if (!email) {
    errors.email = "E-mail requis.";
  } else if (!email.includes("@") || email.indexOf("@") < 1) {
    errors.email = "E-mail invalide.";
  }
  const password = String(form.password || "");
  if (isNew) {
    if (!password) {
      errors.password = "Mot de passe requis.";
    } else if (password.length < 8) {
      errors.password = "Mot de passe : 8 caractères minimum.";
    }
  } else if (password && password.length < 8) {
    errors.password = "Mot de passe : 8 caractères minimum.";
  }
  return errors;
}

function mapUserApiErrorToFields(message) {
  const msg = String(message || "");
  const errors = {};
  if (/identifiant/i.test(msg)) errors.login = msg;
  else if (/e-?mail/i.test(msg)) errors.email = msg;
  else if (/mot de passe/i.test(msg)) errors.password = msg;
  return errors;
}

function setUserFieldErrorDom(field, message) {
  const input = document.getElementById(`u-${field}`);
  const errEl = document.getElementById(`u-${field}-error`);
  if (input) {
    input.classList.toggle("is-invalid", Boolean(message));
    input.setAttribute("aria-invalid", message ? "true" : "false");
  }
  if (errEl) {
    errEl.textContent = message || "";
    errEl.hidden = !message;
  }
}

/** Validation live d’un champ (sans re-render complet). */
function validateUserFieldLive(field) {
  if (!state.editUser) return;
  const form = readUserFormDom();
  const isNew = !state.editUser.id;
  const all = validateUserFormFields(form, isNew);
  const msg = all[field] || "";
  state.userFieldErrors = { ...state.userFieldErrors, [field]: msg };
  if (!msg) delete state.userFieldErrors[field];
  setUserFieldErrorDom(field, msg);
  // Si le message global venait de ce champ, le retirer dès correction
  if (
    state.error &&
    ((field === "login" && /identifiant/i.test(state.error)) ||
      (field === "email" && /e-?mail/i.test(state.error)) ||
      (field === "password" && /mot de passe/i.test(state.error)))
  ) {
    if (!msg) {
      state.error = "";
      const globalErr = document.querySelector("#user-form > .err");
      if (globalErr) globalErr.remove();
    }
  }
}

function bindUserFormValidation() {
  const pairs = [
    ["u-login", "login"],
    ["u-email", "email"],
    ["u-password", "password"],
  ];
  for (const [id, field] of pairs) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener("blur", () => validateUserFieldLive(field));
    el.addEventListener("input", () => {
      // Affiche l’erreur dès que le champ a été touché / a déjà une erreur
      if (state.userFieldErrors[field] || el.classList.contains("is-invalid")) {
        validateUserFieldLive(field);
      }
    });
  }
  const roleEl = document.getElementById("u-role");
  if (roleEl && !roleEl.disabled) {
    roleEl.addEventListener("change", () => {
      syncUserFormToState();
      renderUserEdit();
    });
  }
}

export async function openUser(id) {
  state.error = "";
  state.status = "";
  state.generatedPassword = "";
  state.userPasswordDraft = "";
  state.userFieldErrors = {};
  state.userDeleteConfirm = false;
  if (!id) {
    state.editUser = emptyUserForm();
    state.view = "user-edit";
    renderUserEdit();
    return;
  }
  const data = await api(`/api/desk/users/${id}`);
  state.editUser = data.user;
  state.view = "user-edit";
  renderUserEdit();
}

function accessUntilInputValue(v) {
  return toDatetimeLocalValue(v);
}

async function saveUser(ev) {
  ev?.preventDefault?.();
  if (!state.editUser || state.userDeleteConfirm) return;
  const isNew = !state.editUser.id;
  const form = syncUserFormToState() || readUserFormDom();
  const fieldErrors = validateUserFormFields(form, isNew);
  state.userFieldErrors = fieldErrors;

  if (Object.keys(fieldErrors).length) {
    state.error = "Corrigez les champs indiqués avant d’enregistrer.";
    state.status = "";
    state.saving = false;
    renderUserEdit();
    const firstKey = ["login", "email", "password"].find((k) => fieldErrors[k]);
    document.getElementById(firstKey ? `u-${firstKey}` : "u-login")?.focus();
    return;
  }

  const payload = {
    login: form.login,
    email: form.email,
    display_name: form.name,
    role: form.role,
    status: form.status,
    access_until: form.access_until,
    notes: form.notes,
    newsletter_opt_in: form.newsletter_opt_in,
  };
  if (isNew) {
    payload.password = form.password;
  } else if (form.password) {
    payload.password = form.password;
  }

  state.saving = true;
  state.error = "";
  state.userFieldErrors = {};
  state.generatedPassword = "";
  state.status = isNew ? "Création…" : "Enregistrement…";
  renderUserEdit();
  try {
    if (isNew) {
      const data = await api("/api/desk/users", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      state.editUser = data.user;
      state.userPasswordDraft = "";
      state.userFieldErrors = {};
      if (data.emailSent && data.adminEmailSent) {
        state.status =
          "Compte créé — e-mails envoyés (titulaire + admins)";
      } else if (data.emailSent) {
        state.status =
          "Compte créé — e-mail titulaire envoyé (admins : échec ou aucun)";
      } else {
        state.status = "Compte créé (e-mail de confirmation non envoyé)";
      }
    } else {
      const data = await api(`/api/desk/users/${state.editUser.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      state.editUser = data.user;
      state.userPasswordDraft = "";
      state.userFieldErrors = {};
      state.status = "Compte enregistré";
    }
  } catch (err) {
    state.error = err.message;
    state.status = "";
    state.userFieldErrors = {
      ...state.userFieldErrors,
      ...mapUserApiErrorToFields(err.message),
    };
  } finally {
    state.saving = false;
    renderUserEdit();
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
  syncUserFormToState();
  state.saving = true;
  state.error = "";
  state.status = "Régénération…";
  state.generatedPassword = "";
  renderUserEdit();
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
    renderUserEdit();
  }
}

function requestDeleteUser() {
  if (!state.editUser?.id || state.saving) return;
  state.userDeleteConfirm = true;
  state.error = "";
  state.status = "";
  renderUserEdit();
}

function cancelDeleteUser() {
  state.userDeleteConfirm = false;
  renderUserEdit();
}

async function confirmDeleteUser() {
  if (!state.editUser?.id || !state.userDeleteConfirm) return;
  const label = state.editUser.login || state.editUser.email || state.editUser.id;
  state.saving = true;
  state.error = "";
  state.status = "Suppression…";
  renderUserEdit();
  try {
    const data = await api(`/api/desk/users/${state.editUser.id}`, {
      method: "DELETE",
    });
    state.editUser = null;
    state.generatedPassword = "";
    state.userPasswordDraft = "";
    state.userFieldErrors = {};
    state.userDeleteConfirm = false;
    state.view = "users";
    state.status = data.adminEmailSent
      ? `Compte « ${label} » supprimé — admins notifiés`
      : `Compte « ${label} » supprimé`;
    state.saving = false;
    await loadUsers();
  } catch (err) {
    state.error = err.message || "Échec suppression";
    state.status = "";
    state.saving = false;
    state.userDeleteConfirm = true;
    renderUserEdit();
  }
}

export function renderUsers() {
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
    ${ctx.navTabs("users")}
    <main class="main stack">
      <div class="toolbar-list">
        <div class="search-wrap" id="users-search-wrap">
          <input class="search-input search-input--compact" id="users-q" type="search" placeholder="Nom, login, email…" value="${escapeHtml(state.usersQ)}" autocomplete="off" />
          ${usersAc.html()}
        </div>
        ${filterChips("Filtrer les comptes", filterChipsOpts, activeFilter, "ufilter")}
      </div>
      <div class="list-meta">
        <p class="count-line" id="users-count">${usersRangeLabel()}</p>
        <div id="users-pager-host">${usersPagerHtml()}</div>
      </div>
      <p class="err" id="users-error" ${state.error ? "" : "hidden"}>${escapeHtml(state.error || "")}</p>
      <div id="users-results">${items}</div>
      <div id="users-pager-host-bottom" class="list-pager-bottom">${usersPagerHtml()}</div>
    </main>
    <button class="fab" type="button" id="btn-new-user" title="Nouveau compte" aria-label="Nouveau compte">+</button>`;

  document.getElementById("btn-logout").onclick = logout;
  ctx.bindNav();
  document.getElementById("btn-new-user").onclick = () => openUser(null);
  usersAc.bindInput(document.getElementById("users-q"));
  app.querySelectorAll("[data-ufilter]").forEach((btn) => {
    btn.onclick = async () => {
      state.usersRole = btn.dataset.ufilter || "";
      state.usersStatus = "";
      state.usersPage = 1;
      usersAc.close();
      await loadUsers({ soft: true });
    };
  });
  bindUsersPager();
  bindUsersResultClicks();
}

export function renderUserEdit() {
  const u = state.editUser || emptyUserForm();
  const isNew = !u.id;
  const isSelf = !isNew && Number(u.id) === Number(state.user?.id);
  const roles = state.usersMeta.roles || ["subscriber", "other"];
  const fe = state.userFieldErrors || {};
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
  const pwdVal = escapeHtml(state.userPasswordDraft || "");

  app.innerHTML = `
    <header class="topbar">
      ${brandBlock(isNew ? "Nouveau compte" : "Compte", u.id ? `#${u.id}` : "création")}
      <button class="btn btn-ghost" type="button" id="btn-back-users">Comptes</button>
    </header>
    <main class="main">
      <form class="card stack" id="user-form" novalidate>
        <div class="field">
          <label for="u-login">Identifiant</label>
          <input id="u-login" value="${escapeHtml(u.login || "")}" required autocomplete="off" spellcheck="false" class="${fe.login ? "is-invalid" : ""}" aria-invalid="${fe.login ? "true" : "false"}" aria-describedby="u-login-help u-login-error" />
          <p class="uk-help" id="u-login-help">3–60 caractères : a-z, 0-9, point, underscore, tiret.</p>
          <p class="field-error" id="u-login-error" ${fe.login ? "" : "hidden"}>${escapeHtml(fe.login || "")}</p>
        </div>
        <div class="field">
          <label for="u-email">Email</label>
          <input id="u-email" type="email" value="${escapeHtml(u.email || "")}" required class="${fe.email ? "is-invalid" : ""}" aria-invalid="${fe.email ? "true" : "false"}" aria-describedby="u-email-error" />
          <p class="field-error" id="u-email-error" ${fe.email ? "" : "hidden"}>${escapeHtml(fe.email || "")}</p>
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
          <input id="u-password" type="password" autocomplete="new-password" value="${pwdVal}" ${isNew ? "required minlength=\"8\"" : 'minlength="8"'} class="${fe.password ? "is-invalid" : ""}" aria-invalid="${fe.password ? "true" : "false"}" aria-describedby="u-password-help u-password-error" />
          <p class="uk-help" id="u-password-help">${
            isNew
              ? "8 caractères minimum (secours). Le compte est actif dès la création ; un e-mail propose aussi de choisir un mot de passe pour se connecter."
              : "Ou utilisez « Régénérer » pour créer un mot de passe temporaire à communiquer une fois."
          }</p>
          <p class="field-error" id="u-password-error" ${fe.password ? "" : "hidden"}>${escapeHtml(fe.password || "")}</p>
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
    state.userPasswordDraft = "";
    state.userFieldErrors = {};
    state.userDeleteConfirm = false;
    await loadUsers();
  };
  document.getElementById("btn-cancel-user").onclick = async () => {
    state.view = "users";
    state.editUser = null;
    state.generatedPassword = "";
    state.userPasswordDraft = "";
    state.userFieldErrors = {};
    state.userDeleteConfirm = false;
    await loadUsers();
  };
  document.getElementById("user-form").onsubmit = (e) => saveUser(e);
  bindUserFormValidation();
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
        syncUserFormToState();
        renderUserEdit();
      } catch {
        document.getElementById("u-generated-pwd")?.select();
      }
    };
  }
}
