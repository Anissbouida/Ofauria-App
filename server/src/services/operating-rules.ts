import { getParameter } from './module-parameters.service.js';

/**
 * Réglages du modèle opérationnel et des règles de gestion (mig 692), réglés depuis
 * Paramètres › Paramètres métier ou l'assistant de configuration. Les valeurs par défaut
 * reproduisent exactement le comportement d'avant : un réglage absent ne change rien.
 */

/** Source de la demande du plan directeur : prévision (sur stock), commandes, ou les deux. */
export type DemandSource = 'forecast' | 'orders' | 'both';
export async function demandSource(): Promise<DemandSource> {
  const v = (await getParameter<{ mode?: string }>('production.demand_source'))?.mode;
  return v === 'forecast' || v === 'orders' ? v : 'both';
}
export async function demandTerms() {
  const s = await demandSource();
  return { forecast: s !== 'orders', orders: s !== 'forecast' };
}

/** Parcours d'une production : étapes obligatoires. */
export type ProductionFlow = { recipe_required: boolean; material_issue_required: boolean; quality_before_transfer: boolean; transfer_reception: boolean };
export async function productionFlow(): Promise<ProductionFlow> {
  const v = await getParameter<Partial<ProductionFlow>>('production.flow');
  return {
    recipe_required: v?.recipe_required === true,
    material_issue_required: v?.material_issue_required !== false,
    quality_before_transfer: v?.quality_before_transfer !== false,
    transfer_reception: v?.transfer_reception !== false,
  };
}

/** Alertes de stock bas (listes d'alerte, tableau de bord, propositions d'achat). */
export async function lowStockAlertsEnabled(): Promise<boolean> {
  return (await getParameter<{ enabled?: boolean }>('stock.low_stock_alerts'))?.enabled !== false;
}
