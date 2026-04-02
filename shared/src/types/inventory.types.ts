import type { Unit } from '../constants/units.js';

export interface Ingredient {
  id: string;
  name: string;
  unit: Unit;
  unitCost: number;
  supplier?: string;
  allergens: string[];
  createdAt: string;
}

export interface InventoryItem {
  id: string;
  ingredientId: string;
  ingredient?: Ingredient;
  currentQuantity: number;
  minimumThreshold: number;
  lastRestockedAt?: string;
  updatedAt: string;
}

export interface InventoryTransaction {
  id: string;
  ingredientId: string;
  ingredient?: Ingredient;
  type: 'restock' | 'usage' | 'adjustment' | 'waste';
  quantityChange: number;
  note?: string;
  performedBy: string;
  createdAt: string;
}

export interface RestockRequest {
  ingredientId: string;
  quantity: number;
  note?: string;
}
