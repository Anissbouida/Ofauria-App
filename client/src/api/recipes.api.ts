import api from './client';

export type RecipeExportScope = 'all' | 'base' | 'product';

export interface RecipeCategory {
  id: string;
  code: string;
  label: string;
  color: string;
  display_order: number;
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
