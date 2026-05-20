import api from './client';

export interface MarkupCategory {
  categoryId: number;
  categoryName: string;
  markupPercent: number | null; // null = pas d'override, utilise le taux global
  updatedAt: string | null;
  updatedByName: string | null;
}

export interface MarkupHistoryEntry {
  scope: 'global' | 'category';
  category_id: number | null;
  category_name: string | null;
  old_percent: string | null;
  new_percent: string | null;
  changed_at: string;
  changed_by_name: string | null;
}

export interface MarkupConfig {
  globalPercent: number;
  categories: MarkupCategory[];
  history: MarkupHistoryEntry[];
}

export const productionMarkupApi = {
  get: (): Promise<MarkupConfig> => api.get('/production-markup').then(r => r.data.data),
  update: (data: {
    globalPercent?: number;
    categories?: { categoryId: number; percent: number | null }[];
  }): Promise<MarkupConfig> => api.put('/production-markup', data).then(r => r.data.data),
};
