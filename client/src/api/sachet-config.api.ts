import api from './client';

export interface SachetCategoryConfig {
  id: number;
  name: string;
  articlesPerSachet: number | null;
  needsSachet: boolean;
}

export interface SachetConfig {
  defaultArticlesPerSachet: number;
  categories: SachetCategoryConfig[];
}

export interface SachetConfigUpdate {
  defaultArticlesPerSachet?: number;
  categories?: Array<{
    id: number;
    articlesPerSachet: number | null;
    needsSachet: boolean;
  }>;
}

export interface SachetSuggestionResult {
  suggested: number;
  breakdown: Array<{
    productId: string;
    categoryId: number | null;
    categoryName: string | null;
    quantity: number;
    ratio: number | null;
    needsSachet: boolean;
    weight: number;
  }>;
}

export interface SachetReport {
  range: { from: string | null; to: string | null };
  perSaleswoman: Array<{
    userId: string;
    userName: string;
    storeName: string | null;
    salesCount: number;
    sachetsGiven: number;
    sachetsSuggested: number;
    overshoot: number;
    overshootRatio: number;
    topReason: string | null;
  }>;
  reasons: Array<{ reason: string; count: number }>;
  totals: {
    salesCount: number;
    sachetsGiven: number;
    sachetsSuggested: number;
    overshoot: number;
  };
}

export const sachetConfigApi = {
  get: () => api.get('/sachet-config').then(r => r.data.data) as Promise<SachetConfig>,
  update: (data: SachetConfigUpdate) =>
    api.put('/sachet-config', data).then(r => r.data.data) as Promise<SachetConfig>,
  suggest: (items: Array<{ productId: string; quantity: number }>) =>
    api.post('/sachet-config/suggest', { items }).then(r => r.data.data) as Promise<SachetSuggestionResult>,
  report: (params: { dateFrom?: string; dateTo?: string; storeId?: string }) =>
    api.get('/sachet-config/report', { params }).then(r => r.data.data) as Promise<SachetReport>,
};
