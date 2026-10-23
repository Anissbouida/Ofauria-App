/**
 * Ligne de GET /inventory (vue par ingredient, toutes zones confondues).
 * Partagee par la liste du module Stock et la fiche ingredient : une seule
 * definition, sinon les deux ecrans divergent sur les colonnes de zone.
 */
export interface InventoryItem {
  id: string;
  ingredient_id: string;
  ingredient_name: string;
  current_quantity: string;
  minimum_threshold: string;
  unit: string;
  unit_cost: string;
  supplier: string;
  category: string;
  category_id: string | null;
  last_restocked_at: string | null;
  active_lots_count: string;
  /** Zone scellee (ex-Économat) : contenants intacts. */
  economat_quantity?: string;
  /** Zone entamee (ex-Pesage) : contenants ouverts. */
  pesage_quantity?: string;
  economat_lots_count?: string;
  pesage_lots_count?: string;
  pesage_nearest_dlc?: string | null;
  container_size?: string | null;
  nearest_dlc: string | null;
  expired_lots_count: string;
  expiring_soon_count: string;
  active_lot_numbers: string | null;
  avg_daily_consumption: string;
}

/** Affichage compact d'une quantite : 12, 12.5, 0. */
export function fmtQty(n: number): string {
  return n.toFixed(n % 1 === 0 ? 0 : 1);
}
