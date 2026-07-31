/**
 * Pupitre — entry (Phase 1c).
 * Composition root : ctx + router + bootstrap. Vues / plugins en modules.
 */
import { applyDeskUiTokens } from "./ui.js";
import { state } from "./core/state.js";
import { api } from "./core/api.js";
import { ctx } from "./core/ctx.js";
import { loadRubrics } from "./core/rubrics.js";
import { isEditContentDirty } from "./core/body-editor.js";
import { renderLogin } from "./views/login.js";
import { renderList, loadList } from "./views/list.js";
import { renderUsers, renderUserEdit, loadUsers } from "./views/users.js";
import { renderMedia, loadMediaLibrary } from "./views/media.js";
import { renderEdit } from "./views/edit.js";

applyDeskUiTokens();

/** Cache dynamic imports plugins (newsletter / audience). */
const pluginMods = {
  newsletter: null,
  audience: null,
};

async function loadNewsletterPlugin() {
  if (!pluginMods.newsletter) {
    pluginMods.newsletter = import("./plugins/newsletter.js");
  }
  return pluginMods.newsletter;
}

async function loadAudiencePlugin() {
  if (!pluginMods.audience) {
    pluginMods.audience = import("./plugins/audience.js");
  }
  return pluginMods.audience;
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
    if (
      !view ||
      view === "list" ||
      view === "login" ||
      view === "edit" ||
      view === "user-edit"
    ) {
      url.searchParams.delete("view");
    } else {
      url.searchParams.set("view", view);
    }
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  } catch {
    /* ignore */
  }
}

function navTabs(active) {
  const usersTab = state.caps.manageUsers
    ? `<button type="button" class="nav-tab ${active === "users" ? "active" : ""}" data-nav="users">Comptes</button>`
    : "";
  const nlTab =
    state.caps.newsletter || state.caps.publish
      ? `<button type="button" class="nav-tab ${active === "newsletter" ? "active" : ""}" data-nav="newsletter">Newsletter</button>`
      : "";
  const audTab =
    state.caps.audience || state.caps.publish
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
  const root = document.getElementById("app");
  root?.querySelectorAll("[data-nav]").forEach((btn) => {
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
        const mod = await loadNewsletterPlugin();
        await mod.loadNewsletter();
      } else if (nav === "audience") {
        state.view = "audience";
        syncViewToUrl("audience");
        const mod = await loadAudiencePlugin();
        await mod.loadAudience();
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

async function openDesiredView() {
  const wanted = desiredViewFromUrl();
  if (wanted === "newsletter" && (state.caps.newsletter || state.caps.publish)) {
    state.view = "newsletter";
    syncViewToUrl("newsletter");
    const mod = await loadNewsletterPlugin();
    await mod.loadNewsletter();
    return;
  }
  if (wanted === "audience" && (state.caps.audience || state.caps.publish)) {
    state.view = "audience";
    syncViewToUrl("audience");
    const mod = await loadAudiencePlugin();
    await mod.loadAudience();
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

async function render() {
  if (state.view === "login") return renderLogin();
  if (state.view === "edit") return renderEdit();
  if (state.view === "users") return renderUsers();
  if (state.view === "user-edit") return renderUserEdit();
  if (state.view === "newsletter") {
    const mod = await loadNewsletterPlugin();
    return mod.renderNewsletter();
  }
  if (state.view === "audience") {
    const mod = await loadAudiencePlugin();
    return mod.renderAudience();
  }
  if (state.view === "media") return renderMedia();
  return renderList();
}

ctx.render = render;
ctx.bindNav = bindNav;
ctx.navTabs = navTabs;
ctx.openDesiredView = openDesiredView;
ctx.syncViewToUrl = syncViewToUrl;

async function bootstrap() {
  try {
    const me = await api("/api/auth/me");
    if (!me.authenticated || !me.desk) {
      state.view = "login";
      state.user = me.user || null;
      await render();
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
    await render();
  }
}

function onBeforeUnload(e) {
  if (state.view !== "edit" || state.saving) return;
  if (!isEditContentDirty()) return;
  e.preventDefault();
  e.returnValue = "";
}

window.addEventListener("beforeunload", onBeforeUnload);
bootstrap();
