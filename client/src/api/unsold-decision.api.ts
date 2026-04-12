import api from './client';

export const unsoldDecisionApi = {
  /** Produits invendus avec suggestions automatiques */
  suggestions: () =>
    api.get('/unsold-decisions/suggestions').then(r => r.data.data),

  /** Enregistrer les decisions */
  save: (data: {
    sessionId?: string;
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
};
