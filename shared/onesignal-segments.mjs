/**
 * Groupes / segments OneSignal — source unique (API + pupitre).
 *
 * API : resolvePushSegments(input)
 *        togglePushSelection(selected, name)
 *        mergeSegmentLists(fetched)
 */

/** Groupes intégrés — toujours proposés si l’API ne répond pas. */
export const BUILTIN_PUSH_SEGMENTS = Object.freeze([
  { name: 'All', label: 'Tout le monde' },
  { name: 'Subscribed Users', label: 'Abonnés' },
  { name: 'Active Users', label: 'Actifs' },
  { name: 'Inactive Users', label: 'Inactifs' },
]);

export function segmentLabel(name) {
  const n = String(name || '').trim();
  const found = BUILTIN_PUSH_SEGMENTS.find((s) => s.name === n);
  return found?.label || n;
}

export function parseSegmentsResponse(json) {
  const raw = Array.isArray(json?.segments)
    ? json.segments
    : Array.isArray(json)
      ? json
      : [];
  return raw
    .map((s) => ({
      id: String(s?.id || '').trim(),
      name: String(s?.name || '').trim(),
      description: String(s?.description || '').trim(),
    }))
    .filter((s) => s.name);
}

export function mergeSegmentLists(fetched = []) {
  const byName = new Map();
  for (const s of BUILTIN_PUSH_SEGMENTS) {
    byName.set(s.name, { id: '', name: s.name, label: s.label, builtin: true });
  }
  for (const s of fetched) {
    byName.set(s.name, {
      id: s.id || '',
      name: s.name,
      label: segmentLabel(s.name),
      description: s.description || '',
      builtin: false,
    });
  }
  return [...byName.values()].sort((a, b) => {
    if (a.name === 'All') return -1;
    if (b.name === 'All') return 1;
    return String(a.label).localeCompare(String(b.label), 'fr');
  });
}

/** Noms de groupes à envoyer — défaut All. */
export function resolvePushSegments(input) {
  const names = Array.isArray(input) ? input : input ? [input] : [];
  const out = [];
  for (const n of names) {
    const name = String(n || '').trim();
    if (!name || out.includes(name)) continue;
    out.push(name);
  }
  return out.length ? out : ['All'];
}

/**
 * Puce groupe : « Tout le monde » est exclusif.
 * Décocher le dernier groupe spécifique revient à All.
 */
export function togglePushSelection(selected, name) {
  const n = String(name || '').trim();
  if (!n) return resolvePushSegments(selected);
  if (n === 'All') return ['All'];
  const cur = resolvePushSegments(selected).filter((x) => x !== 'All');
  const next = cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n];
  return next.length ? next : ['All'];
}
