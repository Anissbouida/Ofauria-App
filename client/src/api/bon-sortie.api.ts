import api from './client';
import type { BonSortie } from '@ofauria/shared';

/** Une pesee : mesure + (ouverture du contenant / choix du lot) dans la meme action. */
export interface WeighingPayload {
  /** Poids reel pese, en unite de base (kg / l) — jamais une recopie de la cible. */
  actualQuantity: number;
  /** Obligatoire des que la mesure sort de la bande de tolerance. */
  reason?: string;
  tareQuantity?: number;
  source?: 'manual' | 'scale';
  /** Lot reellement utilise (« Autre lot »), au pesage ou en economat. */
  lotId?: string;
  /** Quantite ouverte depuis l'economat (defaut serveur : contenants entiers ou le manque). */
  transferQty?: number;
  /** Nombre de contenants ouverts (ingredient defini par contenant). */
  containerCount?: number;
  notes?: string;
}

export const bonSortieApi = {
  // Generation manuelle (filet de securite : la confirmation du plan genere le bon).
  // Le backend peut renvoyer 200 avec data: null + reason (plan sans ingredients) :
  // on retourne l'enveloppe complete { data, reason } pour que l'UI puisse distinguer.
  // derogationDlc : autorise les lots hors DLC sur motif trace (mig 339)
  generate: (planId: string, storeId: string, derogationDlc?: { motif: string }) =>
    api.post('/bons-sortie/generate', { planId, storeId, derogationDlc })
       .then(r => ({ data: r.data.data, reason: r.data.reason as string | undefined })),

  getByPlan: (planId: string): Promise<BonSortie[]> =>
    api.get(`/bons-sortie/plan/${planId}`).then(r => r.data.data),

  getById: (bonId: string): Promise<BonSortie> =>
    api.get(`/bons-sortie/${bonId}`).then(r => r.data.data),

  // File d'attente magasinier : bons a preparer / en cours / prets pour le magasin
  warehouseQueue: (): Promise<BonSortie[]> =>
    api.get('/bons-sortie/warehouse/queue').then(r => r.data.data),

  // Historique magasinier : bons remis au chef / livres / annules
  warehouseHistory: (params?: { limit?: number; offset?: number; status?: string; search?: string; dateFrom?: string; dateTo?: string }) =>
    api.get('/bons-sortie/warehouse/history', { params }).then(r => r.data),

  // Lignes a ouvrir depuis l'economat, vue groupee multi-bons (module Economat)
  transferRequests: () =>
    api.get('/bons-sortie/warehouse/transfer-requests').then(r => r.data.data),

  // Lignes en rupture totale, vue groupee multi-bons « Ingredients a commander »
  ruptureRequests: () =>
    api.get('/bons-sortie/warehouse/rupture-requests').then(r => r.data.data),

  // ─── Magasinier : preparation ───
  markPreparation: (bonId: string) =>
    api.put(`/bons-sortie/${bonId}/preparation`).then(r => r.data.data),

  /** Pesee d'une ligne. Pour une ligne « a ouvrir », le serveur ouvre le contenant
   *  (transfert economat -> pesage) dans la meme transaction. */
  updateLigne: (ligneId: string, data: WeighingPayload) =>
    api.put(`/bons-sortie/ligne/${ligneId}`, data).then(r => r.data.data),

  /** Pesee groupee : toutes les lignes saisies partent en une seule transaction (tout ou rien). */
  weighLignes: (bonId: string, lines: Array<WeighingPayload & { ligneId: string }>) =>
    api.put(`/bons-sortie/${bonId}/peser`, { lines }).then(r => r.data.data),

  /** Lots utilisables pour une ligne, toutes zones (selecteur « Autre lot »). */
  lotsForLigne: (ligneId: string): Promise<Record<string, any>[]> =>
    api.get(`/bons-sortie/ligne/${ligneId}/lots`).then(r => r.data.data),

  /** Remettre au chef (preparation -> pret). `withMissing` : avec des ingredients
   *  manquants signales, que le chef verra a la reception. */
  markReady: (bonId: string, options: { withMissing?: boolean } = {}) =>
    api.put(`/bons-sortie/${bonId}/ready`, options).then(r => r.data.data),

  /** Apres reapprovisionnement : refait le FEFO sur les lignes manquantes / a ouvrir. */
  completePending: (bonId: string) =>
    api.put(`/bons-sortie/${bonId}/complete-pending`).then(r => r.data.data),

  // Regenerate bon for a plan
  regenerate: (planId: string, storeId?: string, derogationDlc?: { motif: string }) =>
    api.post(`/bons-sortie/plan/${planId}/regenerate`, { storeId, derogationDlc }).then(r => r.data.data),

  // Delta v1 point 4 : liste FEFO des lots Economat disponibles pour une ligne BSI.
  // Le magasinier l'utilise pour confirmer le lot suggere ou en choisir un autre.
  economatLotsForLigne: (ligneId: string) =>
    api.get(`/bons-sortie/ligne/${ligneId}/economat-lots`).then(r => r.data.data),
  transferLineFromEconomat: (
    ligneId: string,
    payload: { overrideLotId?: string; overrideQty?: number; reason?: string; containerCount?: number; containerTypeId?: string } = {},
  ) =>
    api.post(`/bons-sortie/ligne/${ligneId}/transfer-from-economat`, payload).then(r => r.data.data),

  // ─── Chef : reception ───
  /** Accepter la reception (pret -> prelevement -> verifie -> cloture, une transaction serveur). */
  acceptReception: (bonId: string) =>
    api.put(`/bons-sortie/${bonId}/accept-reception`).then(r => r.data.data),
  /** Refuser la reception avec motif (pret -> preparation). */
  chefReject: (bonId: string, reason: string) =>
    api.put(`/bons-sortie/${bonId}/chef-reject`, { reason }).then(r => r.data.data),

  // Annulation (avant prelevement) et regeneration
};
