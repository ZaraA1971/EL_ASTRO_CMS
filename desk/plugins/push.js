import { state } from "../core/state.js";
import { api } from "../core/api.js";
import { escapeHtml } from "../core/format.js";
import {
  mergeSegmentLists,
  resolvePushSegments,
  togglePushSelection,
} from "../onesignal-segments.js";

export function resetPushPanel() {
  state.push.selected = ["All"];
}

export function selectedPushSegments() {
  return resolvePushSegments(state.push.selected);
}

function selectedPushLabels() {
  const names = selectedPushSegments();
  const list = state.push.segments || [];
  return names.map((n) => {
    const found = list.find((s) => s.name === n);
    return found?.label || n;
  });
}

export function pushTargetsPhrase() {
  const labels = selectedPushLabels();
  if (labels.length === 1 && labels[0] === "Tout le monde") {
    return "tout le monde";
  }
  return labels.join(" + ");
}

function togglePushSegment(name) {
  state.push.selected = togglePushSelection(state.push.selected, name);
}

export async function loadPushSegments() {
  if (!state.caps.publish) return;
  if (state.push.loading) return;
  if (state.push.loaded) return;
  state.push.loading = true;
  try {
    const data = await api("/api/desk/onesignal/segments");
    state.push.segments = data.segments?.length
      ? data.segments
      : mergeSegmentLists([]);
    state.push.error = data.error || "";
    state.push.loaded = true;
  } catch {
    state.push.segments = mergeSegmentLists([]);
    state.push.error = "Groupes OneSignal indisponibles";
    state.push.loaded = true;
  } finally {
    state.push.loading = false;
  }
}

export function pushSegmentsHtml() {
  if (!state.push.loaded) {
    return `<p class="uk-help">Chargement des groupes…</p>
      <div class="filter-chips push-segments" id="push-segments" role="group" aria-label="Groupes OneSignal"></div>`;
  }
  const selected = new Set(selectedPushSegments());
  const chips = (state.push.segments || [])
    .map((s) => {
      const on = selected.has(s.name);
      return `<button type="button" class="chip${
        on ? " is-active" : ""
      }" data-push-segment="${escapeHtml(s.name)}" aria-pressed="${
        on ? "true" : "false"
      }">${escapeHtml(s.label || s.name)}</button>`;
    })
    .join("");
  const hint = state.push.error
    ? "Liste de base — les groupes OneSignal n’ont pas pu être chargés."
    : "Choisissez qui reçoit le push, puis envoyez.";
  return `<p class="uk-help">${escapeHtml(hint)}</p>
    <div class="filter-chips push-segments" id="push-segments" role="group" aria-label="Groupes OneSignal">${chips}</div>`;
}

export function bindPushSegments(root = document) {
  root.querySelectorAll("[data-push-segment]").forEach((btn) => {
    btn.onclick = () => {
      togglePushSegment(btn.dataset.pushSegment);
      paintPushSegments();
    };
  });
}

export function paintPushSegments() {
  const host = document.getElementById("push-segments-wrap");
  if (!host) return;
  host.innerHTML = pushSegmentsHtml();
  bindPushSegments(host);
}
