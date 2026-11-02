import api from './client';

// État thermique des lots (épic labo L4). kind = 'semi' | 'product'.
export const lotThermalApi = {
  listFreezable: (storeId?: string, etat?: string) =>
    api.get('/lot-thermal/freezable', { params: { storeId, etat } }).then(r => r.data.data as FreezableLot[]),
  freeze: (kind: 'semi' | 'product', id: string) =>
    api.post(`/lot-thermal/${kind}/${id}/freeze`).then(r => r.data.data),
  thaw: (kind: 'semi' | 'product', id: string, dureeVieHeures?: number) =>
    api.post(`/lot-thermal/${kind}/${id}/thaw`, { dureeVieHeures }).then(r => r.data.data),
};

export interface FreezableLot {
  kind: 'semi' | 'product';
  id: string;
  lot_number: string;
  item_name: string;
  item_kind: string;
  quantity: number;
  unit: string;
  etat_thermique: 'frais' | 'surgele' | 'decongele';
  surgele_a: string | null;
  decongele_a: string | null;
  dlc_effective: string | null;
  expires_at: string | null;
  dlc_affichee: string | null;
  produced_at: string;
}
