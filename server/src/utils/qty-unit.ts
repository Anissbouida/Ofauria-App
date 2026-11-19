import { z } from 'zod';

/**
 * M3-04 — quantité + unité à la place des colonnes de poids `_g` / `_kg` (mig 557).
 *
 * Les écrans écrivent `<nom>_qty` + `<nom>_unit_id` (l'unité saisie : 420 g reste 420 g) ;
 * le déclencheur trg_qty_unit_sync tient l'ancienne colonne à jour, convertie dans
 * l'unité de son nom. Un appel ancien qui n'envoie que l'ancienne colonne reste accepté :
 * sa valeur est reprise telle quelle dans l'unité du nom.
 */
export const WEIGHT_UNITS = ['g', 'kg'] as const;
export type WeightUnit = typeof WEIGHT_UNITS[number];
export const weightUnitSchema = z.enum(WEIGHT_UNITS, { message: 'Unité de poids attendue : g ou kg' });

const FACTOR: Record<WeightUnit, number> = { g: 1, kg: 1000 };

/** Convertit une quantité d'une unité de poids à l'autre (arrondi à 1e-6). */
export function convertWeight(qty: number | null | undefined, from: WeightUnit, to: WeightUnit): number | null {
  if (qty === null || qty === undefined || !Number.isFinite(qty)) return null;
  return Math.round((qty * FACTOR[from]) / FACTOR[to] * 1e6) / 1e6;
}

export type QtyUnit = { qty: number | null; unit: WeightUnit };

/**
 * Saisie à écrire : la quantité + unité si elle est fournie, sinon l'ancienne colonne
 * dans l'unité de son nom ; `undefined` = rien de fourni (champ inchangé).
 */
export function pickQtyUnit(
  qty: number | null | undefined, unit: WeightUnit | null | undefined,
  legacy: number | null | undefined, legacyUnit: WeightUnit,
): QtyUnit | undefined {
  if (qty !== undefined) return { qty, unit: unit ?? legacyUnit };
  if (legacy !== undefined) return { qty: legacy, unit: legacyUnit };
  return undefined;
}

/** Sous-requête SQL : identifiant de l'unité (référentiel units) pour un code passé en paramètre. */
export const unitIdSql = (param: string) => `(SELECT id FROM ref_entries WHERE table_id = 'units' AND code = ${param})`;
/** Sous-requête SQL : code de l'unité d'une colonne `<nom>_unit_id`. */
export const unitCodeSql = (col: string) => `(SELECT code FROM ref_entries WHERE id = ${col})`;
