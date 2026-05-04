import api from './client';

export const unsoldDecisionApi = {
  /** Produits invendus avec suggestions automatiques.
   *  closeType adapte la fenetre d'analyse : 'fin_journee' ignore les passations intermediaires
   *  pour inclure toutes les ventes et approvisionnements depuis la derniere fin de journee. */
  suggestions: (closeType?: 'passation' | 'fin_journee') =>
    api.get('/unsold-decisions/suggestions', { params: closeType ? { closeType } : undefined })
       .then(r => r.data.data),

  /** Enregistrer les decisions */
  save: (data: {
    sessionId?: string;
    closeType?: string;
    decisions: {
      productId: string;
      productName: string;
      categoryName?: string;
      initialQty: number;
      soldQty: number;
      remainingQty: number;
      suggestedDestination: string;
      suggestedReason: string;
      finalDestination: string;
      overrideReason?: string;
      shelfLifeDays?: number;
      displayLifeHours?: number;
      isReexposable?: boolean;
      maxReexpositions?: number;
      currentReexpositionCount?: number;
      isRecyclable?: boolean;
      recycleIngredientId?: string;
      saleType?: string;
      displayExpiresAt?: string;
      expiresAt?: string;
      producedAt?: string;
      unitCost?: number;
      discrepancyMotif?: string;
    }[];
    notes?: string;
  }) => api.post('/unsold-decisions', data).then(r => r.data.data),

  /** Historique des decisions */
  list: (params?: Record<string, string>) =>
    api.get('/unsold-decisions', { params }).then(r => r.data),

  /** Statistiques du tableau de bord */
  stats: (params?: { month?: number; year?: number }) =>
    api.get('/unsold-decisions/stats', { params }).then(r => r.data.data),

  /** Decisions d'une session */
  bySession: (sessionId: string) =>
    api.get(`/unsold-decisions/session/${sessionId}`).then(r => r.data.data),

  /** Phase 3 — Items en vitrine avec DLC ou DLV depassee. Modal bloquant fermeture journee. */
  expired: () =>
    api.get('/unsold-decisions/expired').then(r => r.data.data),

  /** Phase 3 — Confirmer la destruction des items expires */
  destroyExpired: (items: { productId: string; quantity: number; reason: string; unitCost?: number; productName?: string }[]) =>
    api.post('/unsold-decisions/destroy-expired', { items }).then(r => r.data.data),
};
