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

// ─── Bon de sortie ingrédients (BSI) ───
export interface BonSortieLigne {
  id: string;
  bon_id: string;
  ingredient_id: string | null;
  packaging_id: string | null;
  ingredient_lot_id: string | null;
  suggested_economat_lot_id: string | null;
  substitute_lot_id: string | null;
  needed_quantity: string | number;
  allocated_quantity: string | number;
  actual_quantity: string | number | null;
  transfer_required_qty: string | number | null;
  unit: string | null;
  status: 'en_attente' | 'preleve' | 'ecart' | 'substitue' | 'rupture' | 'annule';
  source_location: 'PESAGE' | 'ECONOMAT_REQUIRES_TRANSFER' | 'RUPTURE' | null;
  ecart_quantity: string | number | null;
  ecart_reason: string | null;
  tare_quantity: string | number | null;
  weighed_at: string | null;
  weighed_by: string | null;
  weighing_source: 'manual' | 'scale' | 'auto' | null;
  tolerance_applied: string | number | null;
  notes: string | null;
  ingredient_name?: string;
  ingredient_unit?: string;
  lot_number?: string | null;
  [key: string]: unknown;
}

export interface BonSortie {
  id: string;
  plan_id: string;
  store_id: string;
  numero: string;
  status: 'genere' | 'preparation' | 'preparation_partielle' | 'pret' | 'prelevement' | 'verifie' | 'cloture' | 'annule';
  generated_by: string | null; generated_at: string | null;
  preparation_by: string | null; preparation_at: string | null;
  ready_by: string | null; ready_at: string | null;
  chef_reject_by: string | null; chef_reject_at: string | null; chef_reject_reason: string | null;
  prelevement_by: string | null; prelevement_at: string | null;
  verified_by: string | null; verified_at: string | null;
  closed_by: string | null; closed_at: string | null;
  cancelled_by?: string | null; cancelled_at?: string | null; cancel_reason?: string | null;
  plan_date?: string;
  lines?: BonSortieLigne[];
  [key: string]: unknown;
}

export interface ProductionPlanEvent {
  id: number;
  entity: 'plan' | 'bon';
  bon_id: string | null;
  bon_numero: string | null;
  from_status: string | null;
  to_status: string;
  reason: string | null;
  actor_name: string | null;
  created_at: string;
}
