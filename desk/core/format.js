import { isEditorialUpdate } from "../editorial-update.js";

export { escapeHtml } from "../escape-html.js";
import { escapeHtml } from "../escape-html.js";
import {
  formatDateFrShort,
  formatDateTimeFrShort,
} from "../format-date-fr.js";

/** Ligne libellé · valeur pour cartouches liste (comptes, …). */
export function listMetaRow(label, value) {
  if (value == null || value === "") return "";
  return `<div class="list-item-kv"><span class="list-item-k">${escapeHtml(
    label
  )}</span><span class="list-item-v">${escapeHtml(value)}</span></div>`;
}

/** Comme listMetaRow, mais valueHtml est déjà échappé / enrichi. */
export function listMetaRowHtml(label, valueHtml) {
  if (valueHtml == null || valueHtml === "") return "";
  return `<div class="list-item-kv"><span class="list-item-k">${escapeHtml(
    label
  )}</span><span class="list-item-v">${valueHtml}</span></div>`;
}

/**
 * Jour calendaire YYYY-MM-DD aligné sur DATE(col) MySQL
 * (datetime stocké / sérialisé avec les mêmes chiffres).
 */
export function calendarDayKey(d) {
  if (d == null || d === "") return "";
  const m = String(d).match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toISOString().slice(0, 10);
}

/** Groupe de boutons filtre (remplace les <select>). */
export function filterChips(ariaLabel, options, activeValue, dataAttr) {
  const buttons = options
    .map(([value, label]) => {
      const active = String(activeValue ?? "") === String(value);
      return `<button type="button" class="chip${active ? " is-active" : ""}" data-${dataAttr}="${escapeHtml(String(value))}" aria-pressed="${active ? "true" : "false"}">${escapeHtml(label)}</button>`;
    })
    .join("");
  return `<div class="filter-chips" role="group" aria-label="${escapeHtml(ariaLabel)}">${buttons}</div>`;
}

export function formatDate(d) {
  return formatDateFrShort(d);
}

export function formatDateTime(d) {
  return formatDateTimeFrShort(d);
}

/** Valeur pour <input type="datetime-local"> en heure locale (pas UTC). */
export function toDatetimeLocalValue(d) {
  if (d == null || d === "") return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

/** Parse datetime-local (heure locale) → ISO UTC pour l’API. */
export function fromDatetimeLocalValue(s) {
  const raw = String(s || "").trim();
  if (!raw) return null;
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

/** Mise à jour éditoriale : en ligne, hors délai de grâce après publication. */
export function updateDateLabel(d) {
  if (d?.draft) return "";
  if (!isEditorialUpdate(d.date, d.modified)) return "";
  return formatDateTime(d.modified);
}

export function formatInt(n) {
  if (n == null || Number.isNaN(Number(n))) return "–";
  return Number(n).toLocaleString("fr-FR");
}

export function brandBlock(title, meta = "") {
  return `
    <div class="brand">
      <span class="brand-mark" aria-hidden="true"></span>
      <div style="min-width:0">
        <h1>${escapeHtml(title)}</h1>
        ${meta ? `<div class="meta">${meta}</div>` : ""}
      </div>
    </div>`;
}
