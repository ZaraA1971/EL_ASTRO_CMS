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
import { createAutocomplete } from "../core/autocomplete.js";
import {
  createPagedList,
  listSplitCardHtml,
  listDismissHtml,
  roleBadgeHtml,
  statusBadgeHtml,
} from "../core/list-resource.js";
import { ctx } from "../core/ctx.js";
import { deskConfirm } from "../desk-dialog.js";
import { logout } from "./login.js";
import { isStaffRole, roleLabelUi, statusLabel } from "../roles.js";
import { LOGIN_ID_MAX, LOGIN_ID_MIN, validateLoginId } from "../login-id.js";

const app = document.getElementById("app");

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
      roleLabelUi(u.role),
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

function canDeleteUsers() {
  return Boolean(state.caps?.manageUsers);
}

function usersItemsHtml(users) {
  const canDelete = canDeleteUsers();
  const selfId = Number(state.user?.id);
  return (users || [])
    .map((u) => {
      const st = u.status || "active";
      const badgeKind =
        st === "active" ? "live" : st === "disabled" ? "draft" : "warn";
      const isStaff = isStaffRole(u.role);
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
      const isSelf = Number(u.id) === selfId;
      return listSplitCardHtml({
        itemClass: "list-item--user",
        dataAttrs: { user: u.id },
        title: u.name || u.login,
        metaHtml: [
          listMetaRow("Identifiant", u.login),
          listMetaRow("Email", u.email || "—"),
          listMetaRow("Accès", accessBits.join(" · ")),
          nl != null ? listMetaRow("Newsletter", nl) : "",
          registered ? listMetaRow("Inscrit", registered) : "",
          updated ? listMetaRow("Mis à jour", updated) : "",
        ].join(""),
        topBadgeHtml: roleBadgeHtml(roleLabelUi(u.role)),
        statusBadgeHtml: statusBadgeHtml(badgeKind, statusLabel(st)),
        actionsHtml:
          canDelete && !isSelf
            ? listDismissHtml({
                dataAttr: "delete-user",
                id: u.id,
                title: u.name || u.login || "",
                ariaLabel: "Supprimer le compte",
              })
            : "",
      });
    })
    .join("");
}

async function deleteUserFromList(id, title) {
  const label = String(title || id).trim() || String(id);
  const ok = await deskConfirm(`Supprimer définitivement le compte « ${label} » ?`, {
    title: "Supprimer le compte",
    danger: true,
    confirmLabel: "Supprimer",
  });
  if (!ok) return;
  try {
    state.error = "";
    await api(`/api/desk/users/${id}`, { method: "DELETE" });
    await loadUsers({ soft: true });
  } catch (err) {
    state.error = err.message || "Suppression impossible";
    if (state.view === "users") renderUsers();
  }
}

function bindUsersResultClicks(root = app) {
  root.querySelectorAll("[data-user]").forEach((btn) => {
    btn.onclick = () => openUser(btn.dataset.user);
  });
  root.querySelectorAll("[data-delete-user]").forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      deleteUserFromList(btn.dataset.deleteUser, btn.dataset.deleteTitle);
    };
  });
}

const usersCtl = createPagedList({
  seqKey: "users",
  view: "users",
  resultsId: "users-results",
  countId: "users-count",
  pagerHostIds: ["users-pager-host", "users-pager-host-bottom"],
  pageDataAttr: "users-page",
  emptyMessage: "Aucun compte",
  singular: "compte",
  pagerAriaLabel: "Pagination comptes",
  endpoint: "/api/desk/users",
  itemsResponseKey: "users",
  errorElId: "users-error",
  fields: {
    page: "usersPage",
    limit: "usersLimit",
    pages: "usersPages",
    total: "usersTotal",
    q: "usersQ",
    items: "users",
  },
  extraParams(params) {
    if (state.usersRole) params.set("role", state.usersRole);
    if (state.usersStatus) params.set("status", state.usersStatus);
  },
  afterApply(data) {
    if (data.meta) state.usersMeta = data.meta;
  },
  itemsHtml: usersItemsHtml,
  bindResultClicks: bindUsersResultClicks,
  getAc: () => usersAc,
  renderFull: () => renderUsers(),
  root: app,
});

export const loadUsers = usersCtl.load;

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
  const loginCheck = validateLoginId(form.login, "store");
  if (!loginCheck.ok) errors.login = loginCheck.error;
  const email = String(form.email || "");
  if (!email) {
    errors.email = "E-mail requis.";
  } else if (!email.includes("@") || email.indexOf("@") < 1) {
    errors.email = "E-mail invalide.";
  }
  const password = String(form.password || "");
  if (!isNew && password && password.length < 8) {
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
  if (!state.editUser) return;
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
  if (!isNew && form.password) {
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
          "Compte créé — e-mail envoyé pour choisir le mot de passe (admins prévenus)";
      } else if (data.emailSent) {
        state.status =
          "Compte créé — e-mail envoyé pour choisir le mot de passe";
      } else {
        state.status =
          "Compte créé (e-mail pour choisir le mot de passe non envoyé — utilisez « Régénérer »)";
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
  const ok = await deskConfirm(
    `Régénérer le mot de passe de « ${state.editUser.login} » ? L’ancien ne fonctionnera plus.`,
    { title: "Régénérer le mot de passe", confirmLabel: "Régénérer" }
  );
  if (!ok) return;
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

async function deleteCurrentUser() {
  if (!state.editUser?.id || state.saving) return;
  const label = state.editUser.login || state.editUser.email || state.editUser.id;
  const ok = await deskConfirm(
    `Supprimer définitivement le compte « ${label} » (${roleLabelUi(state.editUser.role)}) ?\n\nCette action est irréversible.`,
    {
      title: "Confirmer la suppression",
      danger: true,
      confirmLabel: "Oui, supprimer le compte",
    }
  );
  if (!ok) return;
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
    renderUserEdit();
  }
}

async function exportUsers() {
  const params = new URLSearchParams();
  if (state.usersQ) params.set("q", state.usersQ);
  if (state.usersRole) params.set("role", state.usersRole);
  if (state.usersStatus) params.set("status", state.usersStatus);
  const qs = params.toString();
  const url = `/api/desk/users/export${qs ? `?${qs}` : ""}`;
  state.error = "";
  state.status = "Export…";
  const errEl = document.getElementById("users-error");
  const btn = document.getElementById("btn-export-users");
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const match = /filename="([^"]+)"/i.exec(
      res.headers.get("content-disposition") || ""
    );
    const name = match?.[1] || "comptes.csv";
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    a.click();
    URL.revokeObjectURL(href);
    state.status = "";
  } catch (err) {
    state.error = err.message || "Export impossible";
    if (errEl) {
      errEl.hidden = false;
      errEl.textContent = state.error;
    }
  } finally {
    if (btn) btn.disabled = false;
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
  const chrome = usersCtl.chromeHtml();

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
        <button class="btn" type="button" id="btn-export-users" title="Tous les comptes visibles, tous les détails">Exporter</button>
      </div>
      ${chrome.top}
      <p class="err" id="users-error" ${state.error ? "" : "hidden"}>${escapeHtml(state.error || "")}</p>
      <div id="users-results">${items}</div>
      ${chrome.bottom}
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
  usersCtl.bindPager();
  bindUsersResultClicks();
  const exportBtn = document.getElementById("btn-export-users");
  if (exportBtn) exportBtn.onclick = () => exportUsers();
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
        `<option value="${r}" ${u.role === r ? "selected" : ""}>${escapeHtml(roleLabelUi(r))}</option>`
    )
    .join("");
  const statusOpts = (state.usersMeta.statuses || ["active", "disabled", "expired"])
    .map(
      (s) =>
        `<option value="${s}" ${u.status === s ? "selected" : ""}>${escapeHtml(statusLabel(s))}</option>`
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
          <input id="u-login" value="${escapeHtml(u.login || "")}" required maxlength="${LOGIN_ID_MAX}" autocomplete="off" spellcheck="false" class="${fe.login ? "is-invalid" : ""}" aria-invalid="${fe.login ? "true" : "false"}" aria-describedby="u-login-help u-login-error" />
          <p class="uk-help" id="u-login-help">${LOGIN_ID_MIN}–${LOGIN_ID_MAX} caractères. Un e-mail convient — connexion avec l’identifiant ou l’e-mail.</p>
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
        ${
          isNew
            ? `<p class="uk-help">Un mot de passe transitoire est créé à l’enregistrement. L’abonné reçoit un e-mail pour le changer.</p>`
            : `<div class="field">
          <label for="u-password">Nouveau mot de passe (optionnel)</label>
          <input id="u-password" type="password" autocomplete="new-password" value="${pwdVal}" minlength="8" class="${fe.password ? "is-invalid" : ""}" aria-invalid="${fe.password ? "true" : "false"}" aria-describedby="u-password-help u-password-error" />
          <p class="uk-help" id="u-password-help">Ou utilisez « Régénérer » pour créer un mot de passe temporaire à communiquer une fois.</p>
          <p class="field-error" id="u-password-error" ${fe.password ? "" : "hidden"}>${escapeHtml(fe.password || "")}</p>
        </div>`
        }
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
    state.userPasswordDraft = "";
    state.userFieldErrors = {};
    await loadUsers();
  };
  document.getElementById("btn-cancel-user").onclick = async () => {
    state.view = "users";
    state.editUser = null;
    state.generatedPassword = "";
    state.userPasswordDraft = "";
    state.userFieldErrors = {};
    await loadUsers();
  };
  document.getElementById("user-form").onsubmit = (e) => saveUser(e);
  bindUserFormValidation();
  const regenBtn = document.getElementById("btn-regen-pwd");
  if (regenBtn) regenBtn.onclick = () => regenerateUserPassword();
  const delBtn = document.getElementById("btn-delete-user");
  if (delBtn) delBtn.onclick = () => deleteCurrentUser();
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
