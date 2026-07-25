/**
 * Client DeepL (EN-GB) pour le pupitre.
 * Clé : DEEPL_API_KEY (el-astro-api.env ou prod.env).
 */

function apiBase(apiKey) {
  // Clés free DeepL se terminent par :fx
  return String(apiKey || '').endsWith(':fx')
    ? 'https://api-free.deepl.com'
    : 'https://api.deepl.com';
}

/**
 * Traduit une liste de textes dans le même ordre.
 * @param {string[]} texts
 * @param {{ apiKey: string, targetLang?: string, sourceLang?: string, tagHandling?: string }} opts
 * @returns {Promise<string[]>}
 */
export async function translateTexts(texts, opts) {
  const apiKey = String(opts.apiKey || '').trim();
  if (!apiKey) {
    const err = new Error('Clé DeepL manquante (DEEPL_API_KEY)');
    err.code = 'DEEPL_KEY_MISSING';
    throw err;
  }

  const list = texts.map((t) => (t == null ? '' : String(t)));
  // DeepL refuse les chaînes vides : on garde les index et on ne traduit que le non-vide
  const nonempty = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i].trim()) nonempty.push({ i, text: list[i] });
  }
  if (!nonempty.length) return list.map(() => '');

  const params = new URLSearchParams();
  for (const item of nonempty) params.append('text', item.text);
  params.set('target_lang', opts.targetLang || 'EN-GB');
  if (opts.sourceLang) params.set('source_lang', opts.sourceLang);
  if (opts.tagHandling) params.set('tag_handling', opts.tagHandling);
  params.set('preserve_formatting', '1');

  const url = `${apiBase(apiKey)}/v2/translate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
    signal: AbortSignal.timeout(90_000),
  });

  const raw = await res.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    const err = new Error(`DeepL: réponse invalide (HTTP ${res.status})`);
    err.code = 'DEEPL_BAD_RESPONSE';
    throw err;
  }

  if (!res.ok) {
    const msg =
      json?.message ||
      json?.error?.message ||
      `Erreur DeepL (HTTP ${res.status})`;
    const err = new Error(msg);
    err.code = 'DEEPL_HTTP';
    err.status = res.status;
    throw err;
  }

  const translations = json?.translations;
  if (!Array.isArray(translations) || translations.length !== nonempty.length) {
    const err = new Error('DeepL: nombre de traductions incorrect');
    err.code = 'DEEPL_BAD_RESPONSE';
    throw err;
  }

  const out = list.slice();
  nonempty.forEach((item, idx) => {
    out[item.i] = translations[idx]?.text ?? '';
  });
  return out;
}

/**
 * Traduit titre + chapô + corps HTML vers l'anglais britannique.
 */
export async function translateArticleFrToUk(fields, apiKey) {
  const [title, excerpt, body] = await translateTexts(
    [fields.title || '', fields.excerpt || '', fields.body || ''],
    {
      apiKey,
      targetLang: 'EN-GB',
      sourceLang: 'FR',
      tagHandling: 'html',
    }
  );
  return { title, excerpt, body };
}
