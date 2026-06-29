import api from './client';

export type RecipeExportScope = 'all' | 'base' | 'product';

export interface RecipeCategory {
  id: string;
  code: string;
  label: string;
  color: string;
  display_order: number;
}

export interface ComponentRole {
  code: string;
  label: string;
  description?: string | null;
  display_order: number;
}

export interface ComponentSources {
  recipes: { id: string; name: string; yield_unit: string; yield_quantity: string; cout_unitaire: string }[];
  ingredients: { id: string; name: string; unit: string; unit_cost: string }[];
}

export interface FormatComponent {
  id: string;
  role: string | null;
  source_recipe_id: string | null;
  source_ingredient_id: string | null;
  source_name: string;
  source_type: 'recipe' | 'ingredient';
  quantite: string;
  unite: string;
  ordre: number;
  cout_dh: string | null;
}

export interface FormatComponentsData {
  format: {
    id: string;
    recipe_id: string;
    contenant_id: string | null;
    nb_par_defaut: number;
    nb_parts: number | null;
    poids_cru_g: string | null;
    poids_cuit_g: string | null;
    cout_emballage_unitaire: string;
    is_default: boolean;
    contenant_nom: string | null;
    recipe_name: string;
    mode_cout: string;
    compo_par_piece: boolean | null;
    margin_multiplier: string | null;
    taux_main_oeuvre_dh_h: string | null;
    main_oeuvre_min: number | null;
    cout_energie_fournee: string | null;
    taux_frais_structure_pct: string | null;
    perte_standard_pct: string | null;
    yield_quantity: string | null;
    product_image: string | null;
    duree_etapes_min: string | null;
  };
  components: FormatComponent[];
  finance: CompositionFinance;
  parts: { nb_parts: number; cout_part: number | null; prix_part: number | null };
}

export interface FormatSummary {
  id: string;
  contenant_id: string;
  contenant_nom: string | null;
  nb_par_defaut: number;
  nb_parts: number | null;
  is_default: boolean;
  ordre: number;
  cout_emballage_unitaire: string;
  nb_composants: number;
  cout_compose_dh: string | null;
  prix_vente_unitaire: string | null;
}

export interface CompositionFinance {
  matiere_piece: number;
  mo_piece: number;
  energie_piece: number;
  struct_piece: number;
  cout_production_piece: number;
  prix_piece: number;
  marge_brute_piece: number;
  marge_pct: number;
}

export interface CompositionData {
  recipe: {
    id: string;
    name: string;
    yield_quantity: string;
    yield_unit: string;
    mode_cout: string;
    margin_multiplier: string | null;
    total_cost: string | null;
    pieces_par_fournee: number | null;
    format_nb_par_defaut: number | null;
    compo_par_piece: boolean | null;
    perte_standard_pct: string | null;
    taux_main_oeuvre_dh_h: string | null;
    main_oeuvre_min: number | null;
    cout_energie_fournee: string | null;
    taux_frais_structure_pct: string | null;
    duree_etapes_min: string | null;
    product_image: string | null;
  };
  components: {
    id: string;
    role: string | null;
    source_recipe_id: string | null;
    source_ingredient_id: string | null;
    source_name: string;
    source_type: 'recipe' | 'ingredient';
    quantite: string;
    unite: string;
    ordre: number;
    cout_dh: string | null;
  }[];
  finance: CompositionFinance;
}

export interface RecipeChild {
  type: 'recipe' | 'ingredient';
  role: string | null;
  source_id: string | null;
  name: string;
  quantite: string;
  unite: string;
  cout_dh: string | null;
  expandable: boolean;
}

export const recipesApi = {
  list: () => api.get('/recipes').then(r => r.data.data),
  listBase: () => api.get('/recipes/base').then(r => r.data.data),
  listCategories: () => api.get('/recipes/categories').then(r => r.data.data as RecipeCategory[]),
  getById: (id: string) => api.get(`/recipes/${id}`).then(r => r.data.data),
  getByProductId: (productId: string) => api.get(`/recipes/by-product/${productId}`).then(r => r.data.data),
  create: (data: Record<string, any>) => api.post('/recipes', data).then(r => r.data.data),
  update: (id: string, data: Record<string, any>) => api.put(`/recipes/${id}`, data).then(r => r.data.data),
  remove: (id: string) => api.delete(`/recipes/${id}`),
  versions: (id: string) => api.get(`/recipes/${id}/versions`).then(r => r.data.data),

  // --- Nomenclature par format (composition d'un produit composé) ---
  componentRoles: () => api.get('/recipes/component-roles').then(r => r.data.data as ComponentRole[]),
  componentSources: () => api.get('/recipes/component-sources').then(r => r.data.data as ComponentSources),
  formatComponents: (recipeId: string, formatId: string) =>
    api.get(`/recipes/${recipeId}/formats/${formatId}/components`).then(r => r.data.data as FormatComponentsData),
  saveFormatComponents: (recipeId: string, formatId: string, payload: Record<string, any>) =>
    api.put(`/recipes/${recipeId}/formats/${formatId}/components`, payload).then(r => r.data.data as FormatComponentsData),

  // Leviers financiers (frais indirects + multiplicateur) au niveau recette.
  saveFinance: (recipeId: string, payload: Record<string, any>) =>
    api.patch(`/recipes/${recipeId}/finance`, payload).then(r => r.data.data as CompositionData),
  recipeChildren: (recipeId: string) =>
    api.get(`/recipes/${recipeId}/children`).then(r => r.data.data as RecipeChild[]),

  // --- CRUD des formats d'un produit (couche production optionnelle) ---
  listFormats: (recipeId: string) =>
    api.get(`/recipes/${recipeId}/formats`).then(r => r.data.data as FormatSummary[]),
  createFormat: (recipeId: string, payload: Record<string, any>) =>
    api.post(`/recipes/${recipeId}/formats`, payload).then(r => r.data.data as FormatComponentsData),
  duplicateFormat: (recipeId: string, formatId: string, payload: Record<string, any>) =>
    api.post(`/recipes/${recipeId}/formats/${formatId}/duplicate`, payload).then(r => r.data.data as FormatComponentsData),
  updateFormat: (recipeId: string, formatId: string, payload: Record<string, any>) =>
    api.put(`/recipes/${recipeId}/formats/${formatId}`, payload).then(r => r.data.data as FormatComponentsData),
  deleteFormat: (recipeId: string, formatId: string) =>
    api.delete(`/recipes/${recipeId}/formats/${formatId}`),

  /** Import xlsx — phase 1 : analyse + plan (creations/maj/inchanges). Admin only. */
  importPreview: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/recipes/import/preview', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data.data);
  },
  /** Import xlsx — phase 2 : applique creations + mises a jour. Admin only. */
  importCommit: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/recipes/import/commit', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data.data);
  },
  /** Telecharge le xlsx export (declenche un download navigateur). Admin only.
   *  scope = 'all' (tout), 'base' (recettes de base), 'product' (produits finis). */
  exportXlsx: async (scope: RecipeExportScope = 'all', filename?: string) => {
    const resp = await api.get('/recipes/export', { params: { scope }, responseType: 'blob' });
    const stamp = new Date().toISOString().slice(0, 10);
    const defaultName = scope === 'base'
      ? `recettes-base-${stamp}.xlsx`
      : scope === 'product'
      ? `recettes-produits-${stamp}.xlsx`
      : `recettes-${stamp}.xlsx`;
    const url = URL.createObjectURL(resp.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || defaultName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  /** Telecharge un modele xlsx vide. Admin only. */
  downloadTemplate: async () => {
    const resp = await api.get('/recipes/import/template', { responseType: 'blob' });
    const url = URL.createObjectURL(resp.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recettes-modele-import.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
