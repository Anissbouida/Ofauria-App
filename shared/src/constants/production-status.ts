export const PRODUCTION_STATUS = {
  DRAFT: 'draft',
  CONFIRMED: 'confirmed',
  AWAITING_INGREDIENTS: 'awaiting_ingredients',
  READY_TO_PRODUCE: 'ready_to_produce',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;

export type ProductionPlanStatus = (typeof PRODUCTION_STATUS)[keyof typeof PRODUCTION_STATUS];

export const PRODUCTION_STATUS_LABELS: Record<ProductionPlanStatus, string> = {
  draft: 'Brouillon',
  confirmed: 'Confirmé',
  awaiting_ingredients: 'En attente d\'ingrédients',
  ready_to_produce: 'Prêt à produire',
  in_progress: 'En production',
  completed: 'Terminé',
  cancelled: 'Annulé',
};

// Bon de sortie ingrédients (BSI) — mêmes valeurs que la contrainte SQL (mig 108).
export const BON_SORTIE_STATUS = {
  GENERE: 'genere',
  PREPARATION: 'preparation',
  PREPARATION_PARTIELLE: 'preparation_partielle',
  PRET: 'pret',
  PRELEVEMENT: 'prelevement',
  VERIFIE: 'verifie',
  CLOTURE: 'cloture',
  ANNULE: 'annule',
} as const;

export type BonSortieStatus = (typeof BON_SORTIE_STATUS)[keyof typeof BON_SORTIE_STATUS];

export const BON_SORTIE_STATUS_LABELS: Record<BonSortieStatus, string> = {
  genere: 'À prendre en charge',
  preparation: 'En préparation',
  preparation_partielle: 'Partiel — en attente appro',
  pret: 'Prêt à remettre',
  prelevement: 'Remis au chef',
  verifie: 'Vérifié',
  cloture: 'Livré',
  annule: 'Annulé',
};

export const PRODUCTION_TYPE = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
} as const;

export type ProductionPlanType = (typeof PRODUCTION_TYPE)[keyof typeof PRODUCTION_TYPE];

export const PRODUCTION_TYPE_LABELS: Record<ProductionPlanType, string> = {
  daily: 'Quotidien',
  weekly: 'Hebdomadaire',
};
