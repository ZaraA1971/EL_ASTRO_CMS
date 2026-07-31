/** État mutable partagé — importer `{ state }` (binding vif, jamais cloner). */
export const state = {
  user: null,
  /** Marque host — remplie via GET /api/desk/me (`brand`). */
  brand: {
    name: "Pupitre",
    product: "",
    shortName: "Pupitre",
  },
  caps: { manageUsers: false, editAll: false, publish: false, audience: false },
  view: "list", // list | edit | users | user-edit | newsletter | audience | media | login
  /** Rubriques (chips) — chargées via GET /api/desk/categories */
  rubrics: null,
  articles: [],
  total: 0,
  page: 1,
  limit: 25,
  pages: 1,
  q: "",
  filterDraft: "",
  article: null,
  /** Empreinte titre+corps après chargement / enregistrement / publish — pour griser Publier. */
  editBaseline: "",
  editDirty: false,
  mode: "visual", // visual | html | preview
  /** Aperçu : "full" (corps) | "visitor" (teaser paywall si abonnés). */
  previewView: "full",
  users: [],
  usersTotal: 0,
  usersQ: "",
  usersRole: "",
  usersStatus: "",
  usersMeta: { roles: ["subscriber", "other"], statuses: ["active", "disabled", "expired"] },
  authorPick: null, // { name, slug, userId } depuis l’autocomplete
  editUser: null, // null = create
  generatedPassword: "",
  /** Brouillon MDP (conservé si erreur d’enregistrement — jamais renvoyé par l’API). */
  userPasswordDraft: "",
  /** Erreurs de champ { login?, email?, password? } */
  userFieldErrors: {},
  /** true = panneau de confirmation suppression compte affiché */
  userDeleteConfirm: false,
  nlDate: new Date().toISOString().slice(0, 10),
  // Défaut sûr : admin seulement (évite l’envoi « tout le monde » par oubli de décocher)
  nlGroups: { admin: true, redacteurs: false, abonnes: false },
  nlPreview: null,
  nlHistory: [],
  nlDryRun: true,
  audData: null,
  audChart: null,
  status: "",
  error: "",
  saving: false,
  translating: false,
  generatingKeywords: false,
  assisting: false, // corriger | reformuler | chapo
  x: {
    account: "el",
    text: "",
    variants: [],
    loading: false,
    busy: "", // generate
  },
  mediaPicker: {
    open: false,
    q: "",
    page: 1,
    pages: 1,
    total: 0,
    items: [],
    loading: false,
    uploading: false,
    error: "",
    alt: "",
    selectedId: null,
    status: "",
  },
  _searchTimers: {},
  _searchSeq: { users: 0, list: 0, listAc: 0, usersAc: 0, authors: 0 },
  _ac: {}, // états autocomplétion générique (createAutocomplete)
};
