import { state } from "../core/state.js";
import { api } from "../core/api.js";
import { ctx } from "../core/ctx.js";

export function xWeightedLength(text) {
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

export function resetXPanel() {
  state.x = {
    account: "el",
    text: "",
    variants: [],
    loading: false,
    busy: "",
  };
}

export async function loadXPanel(account) {
  if (!state.article) return;
  const articleId = state.article.data.article_id;
  const acc = account || state.x.account || "el";
  state.x.loading = true;
  try {
    const data = await api(
      `/api/desk/articles/${articleId}/x?account=${encodeURIComponent(acc)}`
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

export async function xGenerate() {
  if (!state.article || state.x.busy) return;
  const articleId = state.article.data.article_id;
  state.x.busy = "generate";
  state.error = "";
  state.status = "Génération des variantes X…";
  ctx.render();
  try {
    const data = await api(`/api/desk/articles/${articleId}/x/generate`, {
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
    ctx.render();
  }
}

export async function xCopyText() {
  const text = String(state.x.text || "").trim();
  if (!text) {
    state.error = "Texte X vide";
    ctx.render();
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
  ctx.render();
}

export function xOpenIntent() {
  const text = String(state.x.text || "").trim();
  if (!text) {
    state.error = "Texte X vide";
    ctx.render();
    return;
  }
  const url =
    "https://x.com/intent/tweet?text=" + encodeURIComponent(text);
  window.open(url, "_blank", "noopener,noreferrer");
  state.error = "";
  state.status = "Composer X ouvert";
  ctx.render();
}
