import { z } from 'zod';

/**
 * G0-07 — entrées, ajustements et seuil du stock de matières.
 * Les clés inconnues sont conservées (`passthrough`) : le contrôleur en lit
 * d'autres selon le type de mouvement.
 */
const blank = (v: unknown) => (v === '' || v === null || v === undefined ? undefined : v);
const uuid = z.string().guid('Ingrédient invalide');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue : AAAA-MM-JJ');
const MAX_QTY = 100_000_000;

export const restockSchema = z.object({
  ingredientId: uuid,
  quantity: z.coerce.number().finite().positive('Quantité attendue > 0').max(MAX_QTY),
  note: z.preprocess(blank, z.string().max(1000).optional()),
  supplierLotNumber: z.preprocess(blank, z.string().trim().max(100).optional()),
  expirationDate: z.preprocess(blank, isoDate.optional()),
  manufacturedDate: z.preprocess(blank, isoDate.optional()),
}).passthrough();

/** G0-18 : clôture d'une anomalie de stock, avec le motif de régularisation. */
export const resolveStockAnomalySchema = z.object({
  note: z.string().trim().min(3, 'Indiquez comment l\'anomalie a été régularisée').max(1000),
});

export const adjustStockSchema = z.object({
  ingredientId: uuid,
  // Signée : un ajustement peut retirer du stock.
  quantity: z.coerce.number().finite().min(-MAX_QTY).max(MAX_QTY),
  type: z.preprocess(blank, z.enum(['restock', 'usage', 'adjustment', 'waste', 'recycle', 'production']).optional()),
  note: z.preprocess(blank, z.string().max(1000).optional()),
  reasonCode: z.preprocess(blank, z.string().regex(/^[a-z0-9_]{1,40}$/).optional()),
}).passthrough();

export const stockThresholdSchema = z.object({
  ingredientId: uuid,
  threshold: z.coerce.number().finite().min(0, 'Seuil négatif refusé').max(MAX_QTY),
}).passthrough();

/** G2-03 — fusion de deux fiches d'ingrédient : la fiche en trop (source) et la fiche gardée (cible). */
export const mergeIngredientsSchema = z.object({ sourceId: uuid, targetId: uuid });

/** G2-04 — correction tracée du coût unitaire d'un ingrédient. */
export const correctIngredientCostSchema = z.object({
  ingredientId: uuid,
  newCost: z.coerce.number().finite().positive('Le nouveau coût doit être supérieur à 0').max(1_000_000),
  reason: z.string().trim().min(5, 'Indiquez le motif de la correction').max(500),
});

/** G2-06 — allergènes d'un ingrédient : codes du référentiel, « contient » et « traces ». */
export const ingredientAllergensSchema = z.object({
  contains: z.array(z.string().max(40)).max(14),
  traces: z.array(z.string().max(40)).max(14),
});

/** Points de commande (G5-02). */
export const reorderRecalculateSchema = z.object({}).passthrough();
export const reorderApplySchema = z.object({ ids: z.array(z.string().guid()).min(1).max(5000) });
export const reorderUpdateSchema = z.object({
  reorderPoint: z.number().finite().min(0).optional(),
  safetyStock: z.number().finite().min(0).optional(),
  maxStock: z.number().finite().min(0).nullable().optional(),
  mode: z.enum(['manuel', 'calcule']).optional(),
});

/** Mig 634 : valeurs nutritionnelles pour 100 g (null = effacer). */
const nutrientValue = z.number().min(0).max(4000).nullable().optional();
export const ingredientNutritionSchema = z.object({
  nutrition: z.object({
    energy_kj: nutrientValue, energy_kcal: nutrientValue, fat: nutrientValue, saturated_fat: nutrientValue,
    carbohydrates: nutrientValue, sugars: nutrientValue, fibre: nutrientValue, protein: nutrientValue, salt: nutrientValue,
  }).strict().nullable(),
});
