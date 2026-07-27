/**
 * Comptes X publiables depuis le Pupitre.
 * Secrets : X_{EL|BULLETIN}_API_KEY / _API_SECRET / _ACCESS_TOKEN / _ACCESS_SECRET
 */

export const X_ACCOUNTS = Object.freeze({
  el: Object.freeze({
    id: 'el',
    handle: '@3l3ctr0nLibr3',
    label: 'ElectronLibre',
    envPrefix: 'X_EL',
  }),
  bulletin: Object.freeze({
    id: 'bulletin',
    handle: '@Bulletin_UE',
    label: 'Bulletin UE',
    envPrefix: 'X_BULLETIN',
  }),
});

export const DEFAULT_X_ACCOUNT = 'el';

export function normalizeXAccount(raw) {
  const id = String(raw || '')
    .trim()
    .toLowerCase();
  return X_ACCOUNTS[id] ? id : null;
}

/**
 * @param {Record<string, string>} env — process.env + file env déjà fusionné côté api.mjs
 * @param {string} accountId
 */
export function getXAccountCredentials(env, accountId) {
  const meta = X_ACCOUNTS[accountId];
  if (!meta) return null;
  const p = meta.envPrefix;
  const apiKey = String(env[`${p}_API_KEY`] || '').trim();
  const apiSecret = String(env[`${p}_API_SECRET`] || '').trim();
  const accessToken = String(env[`${p}_ACCESS_TOKEN`] || '').trim();
  const accessSecret = String(env[`${p}_ACCESS_SECRET`] || '').trim();
  const configured = Boolean(apiKey && apiSecret && accessToken && accessSecret);
  return {
    ...meta,
    configured,
    apiKey,
    apiSecret,
    accessToken,
    accessSecret,
  };
}

/**
 * @param {Record<string, string>} env
 */
export function listXAccountsPublic(env) {
  return Object.keys(X_ACCOUNTS).map((id) => {
    const creds = getXAccountCredentials(env, id);
    return {
      id: creds.id,
      handle: creds.handle,
      label: creds.label,
      configured: creds.configured,
    };
  });
}

export function anyXAccountConfigured(env) {
  return listXAccountsPublic(env).some((a) => a.configured);
}
