import { api } from "./api.js";
import { state } from "./state.js";
import { DEFAULT_CATEGORIES } from "../categories.js";

/** Fallback si API rubriques indisponible — dérivé de shared/categories.mjs */
export const FALLBACK_RUBRICS = DEFAULT_CATEGORIES.map((c) => ({
  value: c.slug,
  label: c.name,
}));

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
