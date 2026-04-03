export const PRODUCTION_STATUS = {
  DRAFT: 'draft',
  CONFIRMED: 'confirmed',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
} as const;

export type ProductionPlanStatus = (typeof PRODUCTION_STATUS)[keyof typeof PRODUCTION_STATUS];

export const PRODUCTION_STATUS_LABELS: Record<ProductionPlanStatus, string> = {
  draft: 'Brouillon',
  confirmed: 'Confirme',
  in_progress: 'En cours',
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
