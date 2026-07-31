import { state } from "../core/state.js";
import { api } from "../core/api.js";
import { escapeHtml } from "../core/format.js";
import { ctx } from "../core/ctx.js";

const app = document.getElementById("app");

export function renderLogin() {
  app.innerHTML = `
    <div class="login-wrap">
      <form class="card login-card stack" id="login-form">
        <div class="brand" style="margin-bottom:4px">
          <span class="brand-mark" aria-hidden="true"></span>
          <h1 style="margin:0">${escapeHtml(state.brand?.shortName || "Pupitre")}</h1>
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

export async function login(ev) {
  ev.preventDefault();
  const login = document.getElementById("login")?.value?.trim();
  const password = document.getElementById("password")?.value || "";
  state.error = "";
  state.status = "Connexion…";
  renderLogin();
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ login, password }),
    });
    if (!data.desk) {
      state.error = "Compte sans droit rédacteur/éditeur/admin.";
      state.status = "";
      await api("/api/auth/logout", { method: "POST" });
      renderLogin();
      return;
    }
    state.user = data.user;
    try {
      const deskMe = await api("/api/desk/me");
      state.caps = deskMe.capabilities || {};
      if (deskMe.brand) state.brand = { ...state.brand, ...deskMe.brand };
      if (deskMe.user) state.user = { ...state.user, ...deskMe.user };
      document.title = `Pupitre — ${state.brand.product || state.brand.name}`;
    } catch {
      state.caps = { manageUsers: false };
    }
    state.status = "";
    await ctx.openDesiredView();
  } catch (err) {
    state.error = err.message;
    state.status = "";
    renderLogin();
  }
}

export async function logout() {
  await api("/api/auth/logout", { method: "POST" });
  state.user = null;
  state.caps = { manageUsers: false };
  state.view = "login";
  state.article = null;
  state.editUser = null;
  renderLogin();
}
