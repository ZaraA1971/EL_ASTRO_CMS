/**
 * SEO + chrome FR/EN — une API par contexte.
 * pagePath(context, lang, opts?) · chrome(context, lang) · hreflang(data, context)
 */

export const SITE = 'https://electronlibre.info';

export const PATH_CONTEXTS = {
  home: { fr: '/', en: '/en/' },
  search: { fr: '/search/', en: '/en/search/' },
};

export const CHROME_CONTEXTS = {
  skip: { fr: 'Aller au contenu', en: 'Skip to content' },
  top: { fr: 'Remonter en haut', en: 'Back to top' },
  langSwitch: { fr: 'Langue', en: 'Language' },
  searchLabel: { fr: 'Rechercher :', en: 'Search:' },
  searchPlaceholder: { fr: 'Rechercher…', en: 'Search…' },
  searchSubmit: { fr: 'Rechercher', en: 'Search' },
  searchTitle: { fr: 'Recherche | ElectronLibre', en: 'Search | ElectronLibre' },
  searchDescription: {
    fr: 'Rechercher sur ElectronLibre',
    en: 'Search ElectronLibre',
  },
  searchHeading: { fr: 'Recherche', en: 'Search' },
  searchEmpty: {
    fr: 'Saisissez un mot-clé dans la barre ci-dessus.',
    en: 'Type a keyword above.',
  },
  searchResult: { fr: 'résultat', en: 'result' },
  searchResults: { fr: 'résultats', en: 'results' },
  searchFor: { fr: 'pour', en: 'for' },
  login: { fr: 'Connexion', en: 'Log in' },
  account: { fr: 'Compte', en: 'Account' },
  accountLong: { fr: 'Mon compte', en: 'My account' },
  clientSpace: { fr: 'Espace Client', en: 'Account' },
  subscribe: { fr: 'Abonnement', en: 'Subscribe' },
  about: { fr: 'À propos', en: 'About' },
  legal: { fr: 'Mentions légales', en: 'Legal notice' },
  menu: { fr: 'Menu catégories', en: 'Sections' },
  prev: { fr: '« Précédent', en: '« Previous' },
  next: { fr: 'Suivant »', en: 'Next »' },
  pagination: { fr: 'Pagination', en: 'Pagination' },
  breadcrumb: { fr: "Fil d'Ariane", en: 'Breadcrumb' },
  homeLabel: { fr: 'Accueil', en: 'Home' },
  featured: { fr: 'À la une', en: 'Featured' },
  emptyCategory: {
    fr: 'Aucun article importé dans cette catégorie pour l’instant.',
    en: 'No articles in this section yet.',
  },
  emptyTag: {
    fr: 'Aucun article pour ce mot-clé pour l’instant.',
    en: 'No articles for this keyword yet.',
  },
  homeTitle: {
    fr: 'ElectronLibre | Médias, technologies, IA et industries culturelles',
    en: 'ElectronLibre | Media, technology, AI and cultural industries',
  },
  homeDescription: {
    fr: 'ElectronLibre est un média indépendant d’analyse et d’information sur les technologies, l’intelligence artificielle, les médias, les plateformes et les industries culturelles.',
    en: 'ElectronLibre is an independent media covering technology, artificial intelligence, media, platforms and cultural industries.',
  },
  articleLang: { fr: 'Langue de l’article', en: 'Article language' },
  related: { fr: 'A lire aussi...', en: 'Related reading...' },
  browseTitle: { fr: 'Sujets liés', en: 'Related topics' },
  browseHint: {
    fr: 'Voir les articles sur ce mot-clé',
    en: 'Open articles with this keyword',
  },
  defineTitle: { fr: 'Définir', en: 'Define' },
  defineHelp: {
    fr: 'Cliquez un terme pour obtenir une définition IA dans le contexte de l’article.',
    en: 'Click a term to get an AI definition in this article’s context.',
  },
  updatePrefix: { fr: 'Mis à jour le', en: 'Updated' },
  paywall: {
    fr: 'Cet article est réservé aux abonnés ElectronLibre.',
    en: 'This article is reserved for ElectronLibre subscribers.',
  },
  subscribeCta: { fr: 'Je m’abonne', en: 'Subscribe' },
};

export function resolveLang(lang) {
  return String(lang || 'fr')
    .toLowerCase()
    .startsWith('en')
    ? 'en'
    : 'fr';
}

export function chrome(context, lang) {
  const row = CHROME_CONTEXTS[context];
  if (!row) throw new Error(`Unknown chrome context: ${context}`);
  return row[resolveLang(lang)];
}

function withPage(base, page) {
  const clean = String(base || '').replace(/\/+$/, '');
  const n = Number(page) || 1;
  return n <= 1 ? `${clean}/` : `${clean}/page/${n}/`;
}

export function pagePath(context, lang, opts = {}) {
  const l = resolveLang(lang);
  if (context === 'category') {
    const slug = String(opts.slug || '').replace(/^\/+|\/+$/g, '');
    if (!slug) return pagePath('home', l);
    const base =
      l === 'en'
        ? `/en/articles/category/${slug}`
        : `/articles/category/${slug}`;
    return withPage(base, opts.page);
  }
  if (context === 'tag') {
    const raw = String(opts.slug || '').trim();
    if (!raw) return pagePath('home', l);
    const base =
      l === 'en'
        ? `/en/articles/tag/${encodeURIComponent(raw)}`
        : `/articles/tag/${encodeURIComponent(raw)}`;
    return `${base}/`;
  }
  const row = PATH_CONTEXTS[context];
  if (!row) throw new Error(`Unknown path context: ${context}`);
  if (context === 'home') {
    const n = Number(opts.page) || 1;
    if (n > 1) {
      return l === 'en' ? `/en/page/${n}/` : `/page/${n}/`;
    }
  }
  return row[l];
}

export function absoluteUrl(pathOrUrl, site = SITE) {
  const s = String(pathOrUrl || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  const base = String(site || SITE).replace(/\/+$/, '');
  return `${base}${s.startsWith('/') ? s : `/${s}`}`;
}

/**
 * Liens hreflang pour une page.
 * data.path = URL courante ; data.alternates = { fr?, en? }.
 * home / search / category / tag : l’autre langue est déduite.
 * article : seulement les langues fournies (plus soi-même).
 */
export function hreflang(data, context, opts = {}) {
  const lang = resolveLang(data?.lang);
  const site = opts.site || SITE;
  const self = data?.path || pagePath(context, lang, opts);
  const alts = {};
  if (self) alts[lang] = self;
  const extra = data?.alternates || {};
  if (extra.fr) alts.fr = extra.fr;
  if (extra.en) alts.en = extra.en;
  if (
    context === 'home' ||
    context === 'search' ||
    context === 'category' ||
    context === 'tag'
  ) {
    if (!alts.fr) alts.fr = pagePath(context, 'fr', opts);
    if (!alts.en) alts.en = pagePath(context, 'en', opts);
  }

  const links = [];
  const seen = new Set();
  const add = (code, path) => {
    const href = absoluteUrl(path, site);
    if (!href || seen.has(code)) return;
    seen.add(code);
    links.push({ hreflang: code, href });
  };
  if (alts.fr) add('fr', alts.fr);
  if (alts.en) add('en', alts.en);
  if (alts.fr) add('x-default', alts.fr);
  else if (alts.en) add('x-default', alts.en);
  return links;
}

/** Alternates sitemap : uniquement s’il existe une vraie paire FR+EN. */
export function pairHreflang({ lang, selfPath, frPath, enPath }, opts = {}) {
  const l = resolveLang(lang);
  const alts = { [l]: selfPath };
  if (frPath) alts.fr = frPath;
  if (enPath) alts.en = enPath;
  if (!alts.fr || !alts.en) return [];
  return hreflang(
    { lang: l, path: selfPath, alternates: alts },
    'article',
    opts
  );
}
