import { api } from "./api.js";
import { state } from "./state.js";

/** Fallback si API rubriques indisponible */
export const FALLBACK_RUBRICS = [
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

export function rubricList() {
  return state.rubrics && state.rubrics.length
    ? state.rubrics
    : FALLBACK_RUBRICS;
}

export function catLabel(slug) {
  return rubricList().find((c) => c.value === slug)?.label || slug;
}

export async function loadRubrics({ force = false } = {}) {
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
