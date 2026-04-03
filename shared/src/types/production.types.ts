import type { ProductionPlanStatus, ProductionPlanType } from '../constants/production-status.js';

export interface ProductionPlanItem {
  id: string;
  planId: string;
  productId: string;
  productName?: string;
  productImage?: string;
  plannedQuantity: number;
  actualQuantity?: number;
  notes?: string;
}

export interface ProductionIngredientNeed {
  id: string;
  planId: string;
  ingredientId: string;
  ingredientName?: string;
  unit?: string;
  neededQuantity: number;
  availableQuantity: number;
  isSufficient: boolean;
}

export interface ProductionPlan {
  id: string;
  planDate: string;
  type: ProductionPlanType;
  weekNumber?: number;
  status: ProductionPlanStatus;
  notes?: string;
  createdBy: string;
  createdByName?: string;
  confirmedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  items?: ProductionPlanItem[];
  ingredientNeeds?: ProductionIngredientNeed[];
}

export interface CreateProductionPlanRequest {
  planDate: string;
  type: ProductionPlanType;
  notes?: string;
  items: { productId: string; plannedQuantity: number; notes?: string }[];
}

export interface CompletePlanRequest {
  items: { planItemId: string; actualQuantity: number }[];
}
