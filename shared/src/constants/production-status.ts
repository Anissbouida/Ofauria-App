export const PRODUCTION_STATUS = {
  DRAFT: 'draft',
  CONFIRMED: 'confirmed',
  AWAITING_INGREDIENTS: 'awaiting_ingredients',
  READY_TO_PRODUCE: 'ready_to_produce',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
} as const;

export type ProductionPlanStatus = (typeof PRODUCTION_STATUS)[keyof typeof PRODUCTION_STATUS];

export const PRODUCTION_STATUS_LABELS: Record<ProductionPlanStatus, string> = {
  draft: 'Brouillon',
  confirmed: 'Confirme',
  awaiting_ingredients: 'En attente ingredients',
  ready_to_produce: 'Pret a produire',
  in_progress: 'En production',
  completed: 'Termine',
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
