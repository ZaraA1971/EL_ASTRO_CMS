export function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  if (d == null || d === "") return "";
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return "";
    return dt.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export function formatDateTime(d) {
  if (d == null || d === "") return "";
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return "";
    return dt.toLocaleString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
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

/** Mise à jour éditoriale : uniquement articles en ligne, si ≠ date de publication. */
export function updateDateLabel(d) {
  if (d?.draft) return "";
  if (!d?.date || !d?.modified) return "";
  const pub = new Date(d.date).getTime();
  const mod = new Date(d.modified).getTime();
  if (Number.isNaN(pub) || Number.isNaN(mod)) return "";
  if (mod - pub < 2 * 60 * 1000) return "";
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
