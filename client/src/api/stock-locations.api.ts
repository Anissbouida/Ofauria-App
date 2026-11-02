import api from './client';

export interface StockLocation {
  id: string;
  store_id: string | null;
  code: string;
  name: string;
  type: 'sec' | 'positif' | 'negatif' | 'pesage' | 'vitrine' | 'labo';
  parent_id: string | null;
  equipement_id: string | null;
  temp_min: number | string | null;
  temp_max: number | string | null;
  temp_min_effectif: number | string | null;
  temp_max_effectif: number | string | null;
  equipement_nom: string | null;
  parent_code: string | null;
  parent_name: string | null;
  capacite_unite: string | null;
  capacite_valeur: number | string | null;
  is_active: boolean;
  lot_count: number;
}

export interface StockLocationInput {
  storeId?: string | null;
  code: string;
  name: string;
  type: string;
  parentId?: string | null;
  equipementId?: string | null;
  tempMin?: number | null;
  tempMax?: number | null;
  capaciteUnite?: string | null;
  capaciteValeur?: number | null;
}

export const stockLocationsApi = {
  list: (storeId?: string, includeInactive = false) =>
    api.get('/stock-locations', { params: { storeId, includeInactive } }).then(r => r.data.data as StockLocation[]),
  create: (data: StockLocationInput) =>
    api.post('/stock-locations', data).then(r => r.data.data as StockLocation),
  update: (id: string, data: Partial<StockLocationInput>) =>
    api.put(`/stock-locations/${id}`, data).then(r => r.data.data as StockLocation),
  deactivate: (id: string) =>
    api.delete(`/stock-locations/${id}`).then(r => r.data.data),
};
