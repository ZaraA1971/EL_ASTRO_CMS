/**
 * Tokens UI pupitre — source unique (dimensions, couleurs, familles outils).
 *
 * API principale :
 *   button(context)  → dims d’un bouton
 *   family(context)  → teinte d’un groupe d’outils
 *   face(context)    → graisse / italique d’un libellé d’outil
 *   color(context)   → palette de surface / sémantique
 *   deskUiCss()      → bloc :root CSS (injecté au boot desk)
 *
 * Contextes boutons : 'action' | 'chip' | 'chipAdd' | 'filter' | 'tool' |
 *                     'toolAlign' | 'tab' | 'compact' | 'field' | 'xAction'
 * Contextes familles : 'history' | 'clean' | 'format' | 'align' | 'assist'
 * Contextes visage   : 'bold' | 'italic'
 * Contextes couleur  : 'surface' | 'accent' | 'danger' | 'ok' | 'warn' | 'bar'
 */

/** @typedef {{ h: number, px: number, radius: number|string, fontRem: number|null, weight: number, shape?: string, bg?: string, bgHover?: string, ref?: string }} ButtonCtx */
/** @typedef {{ bg: string, border: string }} FamilyCtx */
/** @typedef {{ weight: number, style: string }} FaceCtx */

/**
 * Dimensions / style bouton par surface.
 * @type {Record<string, ButtonCtx>}
 */
export const BUTTON_CONTEXTS = {
  /** Enregistrer, Publier, actions tactiles. */
  action: { h: 44, px: 16, radius: 11, fontRem: null, weight: 700 },
  /** Chip rubrique (colonne méta). */
  chip: { h: 38, px: 12, radius: 999, fontRem: 0.88, weight: 600 },
  /** Disque « + » — diamètre = hauteur chip. */
  chipAdd: {
    ref: 'chip',
    shape: 'circle',
    h: 38,
    px: 0,
    radius: '50%',
    fontRem: 1.45,
    weight: 500,
    bg: '#94a3b8',
    bgHover: '#64748b',
  },
  /** Chip filtre liste articles. */
  filter: { h: 36, px: 12, radius: 999, fontRem: 0.82, weight: 600 },
  /** Outil barre d’édition (Gras, Nettoyer…). */
  tool: { h: 26, px: 7, radius: 5, fontRem: 0.7, weight: 500 },
  /** Alignement dans la barre. */
  toolAlign: { h: 22, px: 5, radius: 5, fontRem: 0.62, weight: 500 },
  /** Onglets Écrire / Aperçu / HTML. */
  tab: { h: 28, px: 10, radius: 0, fontRem: 0.72, weight: 550 },
  /** Toggle aperçu, actions secondaires compactes. */
  compact: { h: 34, px: 10, radius: 11, fontRem: 0.78, weight: 600 },
  /** Bouton collé à un champ (field-row). */
  field: { h: 42, px: 16, radius: 11, fontRem: null, weight: 700 },
  /** Actions panneau X — même taille que les chips rubriques. */
  xAction: { ref: 'chip' },
};

/**
 * Teintes des familles d’outils (barre d’édition).
 * @type {Record<string, FamilyCtx>}
 */
export const FAMILY_CONTEXTS = {
  history: {
    bg: 'rgba(100, 116, 139, 0.1)',
    border: 'rgba(100, 116, 139, 0.18)',
  },
  clean: {
    bg: 'rgba(13, 148, 136, 0.09)',
    border: 'rgba(13, 148, 136, 0.2)',
  },
  format: {
    bg: 'rgba(15, 23, 42, 0.045)',
    border: 'rgba(15, 23, 42, 0.1)',
  },
  align: {
    bg: 'rgba(47, 109, 251, 0.08)',
    border: 'rgba(47, 109, 251, 0.16)',
  },
  assist: {
    bg: 'rgba(185, 28, 28, 0.09)',
    border: 'rgba(185, 28, 28, 0.2)',
  },
};

/**
 * Forme du libellé — Gras / Italique reconnaissables d’un coup d’œil.
 * @type {Record<string, FaceCtx>}
 */
export const FACE_CONTEXTS = {
  bold: { weight: 700, style: 'normal' },
  italic: { weight: 500, style: 'italic' },
};

/**
 * Palettes sémantiques.
 * @type {Record<string, Record<string, string>>}
 */
export const COLOR_CONTEXTS = {
  surface: {
    bg0: '#e8eef6',
    bg1: '#f4f7fb',
    paper: '#ffffff',
    ink: '#0f172a',
    muted: '#64748b',
    line: '#dbe3ee',
    lineStrong: '#c5d0e0',
    shadow: '0 1px 2px rgba(15, 23, 42, 0.05)',
  },
  accent: {
    base: '#2563eb',
    soft: '#dbeafe',
    hover: '#1d4ed8',
    ring: '#93c5fd',
  },
  danger: { base: '#dc2626', soft: '#fee2e2' },
  ok: { base: '#15803d', soft: '#dcfce7' },
  warn: { base: '#c2410c', soft: '#ffedd5' },
  bar: { base: '#0f172a', elev: '#1e293b' },
};

/**
 * @param {string} context
 * @returns {ButtonCtx}
 */
export function button(context) {
  const raw = BUTTON_CONTEXTS[context];
  if (!raw) {
    throw new Error(`desk-ui: bouton contexte inconnu « ${context} »`);
  }
  if (raw.ref) {
    const base = button(raw.ref);
    return {
      ...base,
      ...raw,
      h: raw.h ?? base.h,
      px: raw.px ?? base.px,
      radius: raw.radius ?? base.radius,
      fontRem: raw.fontRem ?? base.fontRem,
      weight: raw.weight ?? base.weight,
    };
  }
  return { ...raw };
}

/**
 * @param {string} context
 * @returns {FamilyCtx}
 */
export function family(context) {
  const f = FAMILY_CONTEXTS[context];
  if (!f) {
    throw new Error(`desk-ui: famille contexte inconnu « ${context} »`);
  }
  return { ...f };
}

/**
 * @param {string} context
 * @returns {Record<string, string>}
 */
export function color(context) {
  const c = COLOR_CONTEXTS[context];
  if (!c) {
    throw new Error(`desk-ui: couleur contexte inconnu « ${context} »`);
  }
  return { ...c };
}

/**
 * @param {string} context
 * @returns {FaceCtx}
 */
export function face(context) {
  const f = FACE_CONTEXTS[context];
  if (!f) {
    throw new Error(`desk-ui: visage contexte inconnu « ${context} »`);
  }
  return { ...f };
}

function px(n) {
  return `${Number(n)}px`;
}

function radiusCss(r) {
  if (typeof r === 'string') return r;
  if (r >= 999) return '999px';
  return px(r);
}

/**
 * Génère le bloc CSS `:root` (variables --btn-*, --family-*, --*).
 * @returns {string}
 */
export function deskUiCss() {
  const lines = [':root {'];

  for (const key of Object.keys(BUTTON_CONTEXTS)) {
    const b = button(key);
    lines.push(`  --btn-${key}-h: ${px(b.h)};`);
    lines.push(`  --btn-${key}-px: ${px(b.px)};`);
    lines.push(`  --btn-${key}-radius: ${radiusCss(b.radius)};`);
    if (b.fontRem != null) {
      lines.push(`  --btn-${key}-font: ${b.fontRem}rem;`);
    }
    lines.push(`  --btn-${key}-weight: ${b.weight};`);
    if (b.bg) lines.push(`  --btn-${key}-bg: ${b.bg};`);
    if (b.bgHover) lines.push(`  --btn-${key}-bg-hover: ${b.bgHover};`);
  }

  for (const [key, f] of Object.entries(FAMILY_CONTEXTS)) {
    lines.push(`  --family-${key}-bg: ${f.bg};`);
    lines.push(`  --family-${key}-border: ${f.border};`);
  }

  for (const [key, f] of Object.entries(FACE_CONTEXTS)) {
    lines.push(`  --face-${key}-weight: ${f.weight};`);
    lines.push(`  --face-${key}-style: ${f.style};`);
  }

  const surface = COLOR_CONTEXTS.surface;
  const accent = COLOR_CONTEXTS.accent;
  const danger = COLOR_CONTEXTS.danger;
  const ok = COLOR_CONTEXTS.ok;
  const warn = COLOR_CONTEXTS.warn;
  const bar = COLOR_CONTEXTS.bar;

  lines.push(`  --bg0: ${surface.bg0};`);
  lines.push(`  --bg1: ${surface.bg1};`);
  lines.push(`  --paper: ${surface.paper};`);
  lines.push(`  --ink: ${surface.ink};`);
  lines.push(`  --muted: ${surface.muted};`);
  lines.push(`  --line: ${surface.line};`);
  lines.push(`  --line-strong: ${surface.lineStrong};`);
  lines.push(`  --shadow: ${surface.shadow};`);
  lines.push(`  --accent: ${accent.base};`);
  lines.push(`  --accent-soft: ${accent.soft};`);
  lines.push(`  --accent-hover: ${accent.hover};`);
  lines.push(`  --accent-ring: ${accent.ring};`);
  lines.push(`  --danger: ${danger.base};`);
  lines.push(`  --danger-soft: ${danger.soft};`);
  lines.push(`  --ok: ${ok.base};`);
  lines.push(`  --ok-soft: ${ok.soft};`);
  lines.push(`  --warn: ${warn.base};`);
  lines.push(`  --warn-soft: ${warn.soft};`);
  lines.push(`  --bar: ${bar.base};`);
  lines.push(`  --bar-2: ${bar.elev};`);
  /* Alias historique — hauteur tactile = bouton action */
  lines.push(`  --tap: var(--btn-action-h);`);
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

/** Injecte (ou met à jour) les tokens dans le document. */
export function applyDeskUiTokens(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return;
  let el = doc.getElementById('desk-ui-tokens');
  if (!el) {
    el = doc.createElement('style');
    el.id = 'desk-ui-tokens';
    doc.head.appendChild(el);
  }
  el.textContent = deskUiCss();
}
