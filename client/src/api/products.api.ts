import api from './client';

export const productsApi = {
  list: (params?: Record<string, string>) => api.get('/products', { params }).then(r => r.data),
  topSelling: (params?: Record<string, string>) => api.get('/products/top-selling', { params }).then(r => r.data.data),
  getById: (id: string) => api.get(`/products/${id}`).then(r => r.data.data),
  create: (data: Record<string, any>) => api.post('/products', data).then(r => r.data.data),
  update: (id: string, data: Record<string, any>) => api.put(`/products/${id}`, data).then(r => r.data.data),
  remove: (id: string) => api.delete(`/products/${id}`).then(r => r.data),
  bulkDelete: (ids: string[]) =>
    api.post('/products/bulk-delete', { ids }).then(r => r.data.data as { deleted: number; failed: Array<{ id: string; reason: string }> }),
  importProducts: (items: ImportProductItem[]) =>
    api.post('/products/import', { items }).then(r => r.data.data as { created: number; skipped: number; errors: Array<{ name: string; reason: string }> }),
  toggleAvailability: (id: string) => api.patch(`/products/${id}/toggle-availability`).then(r => r.data.data),
  uploadImage: (id: string, file: File) => {
    const form = new FormData();
    form.append('image', file);
    return api.post(`/products/${id}/image`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data.data);
  },
  adjustStock: (id: string, data: { quantity: number; type?: string; note?: string }) =>
    api.post(`/products/${id}/stock`, data).then(r => r.data.data),
  stockHistory: (id: string, params?: Record<string, string>) =>
    api.get(`/products/${id}/stock-history`, { params }).then(r => r.data),
  lowStock: () => api.get('/products/alerts/low-stock').then(r => r.data.data),
  // Paliers tarifaires (mig 171)
  listPricingTiers: (id: string) => api.get(`/products/${id}/pricing-tiers`).then(r => r.data.data as PricingTier[]),
  replacePricingTiers: (id: string, tiers: Array<Omit<PricingTier, 'id' | 'product_id' | 'created_at' | 'updated_at'>>) =>
    api.put(`/products/${id}/pricing-tiers`, { tiers }).then(r => r.data.data as PricingTier[]),
  // Prix par canal (mig 173)
  listChannelPricing: (id: string) => api.get(`/products/${id}/channel-pricing`).then(r => r.data.data as ChannelPricing[]),
  replaceChannelPricing: (id: string, items: Array<{ channel_id: string; price_override: number | null; price_per_kg_override: number | null }>) =>
    api.put(`/products/${id}/channel-pricing`, { items }).then(r => r.data.data as ChannelPricing[]),
  // Destinations de recyclage (audit P1.3, mig 106+116)
  listRecycleDestinations: (id: string) =>
    api.get(`/products/${id}/recycle-destinations`).then(r => r.data.data as RecycleDestination[]),
  replaceRecycleDestinations: (id: string, destinations: Array<Omit<RecycleDestination, 'id' | 'product_id' | 'ingredient_name' | 'ingredient_unit'>>) =>
    api.put(`/products/${id}/recycle-destinations`, { destinations }).then(r => r.data.data as RecycleDestination[]),
};

export interface ImportProductItem {
  name: string;
  category?: string | null;
  price: number;
  costPrice?: number | null;
  saleUnit?: 'unit' | 'weight';
  isAvailable?: boolean;
}

export interface RecycleDestination {
  id?: string;
  product_id?: string;
  ingredientId: string;
  ingredient_id?: string;
  ingredient_name?: string;
  ingredient_unit?: string;
  label?: string | null;
  displayOrder?: number;
  display_order?: number;
  isActive?: boolean;
  is_active?: boolean;
  yieldRatio?: number;
  yield_ratio?: number | string;
}

export interface ChannelPricing {
  id: string;
  product_id: string;
  channel_id: string;
  channel_code?: string;
  channel_label?: string;
  price_override: number | string | null;
  price_per_kg_override: number | string | null;
}

export interface PricingTier {
  id: string;
  product_id: string;
  min_grammes: number;
  max_grammes: number | null;
  prix_per_kg: number | string;
  display_order: number;
  created_at?: string;
  updated_at?: string;
}
