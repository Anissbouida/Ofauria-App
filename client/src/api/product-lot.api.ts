import api from './client';

export const productLotApi = {
  /** Lots produits avec DLC ou DLV depassee, encore en stock (vitrine + backroom > 0) */
  expiredActive: () =>
    api.get('/product-lots/expired-active').then(r => r.data.data),

  /** Envoyer un lot produit aux pertes avec motif */
  sendToLosses: (lotId: string, reason: string, note?: string) =>
    api.post(`/product-lots/${lotId}/send-to-losses`, { reason, note }).then(r => r.data.data),

  /** Envoyer le stock orphelin (sans lot) d'un produit aux pertes */
  sendOrphanToLosses: (productId: string, reason: string, note?: string) =>
    api.post(`/product-lots/send-orphan-to-losses`, { productId, reason, note }).then(r => r.data.data),
};
