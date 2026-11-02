import api from './client';

// État thermique des lots (épic labo L4). kind = 'semi' | 'product'.
export const lotThermalApi = {
  freeze: (kind: 'semi' | 'product', id: string) =>
    api.post(`/lot-thermal/${kind}/${id}/freeze`).then(r => r.data.data),
  thaw: (kind: 'semi' | 'product', id: string, dureeVieHeures?: number) =>
    api.post(`/lot-thermal/${kind}/${id}/thaw`, { dureeVieHeures }).then(r => r.data.data),
};
