import { db } from '../config/database.js';
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

/** Rythme de production : règle, quand il change, l'horizon du plan directeur et le
 *  contrôle de capacité des équipements (settings-center.write). */
export type ProductionRhythm = 'artisanal' | 'industrial' | 'continuous';
export const RHYTHM_PRESETS: Record<ProductionRhythm, { mrp_horizon_days: number; equipment_capacity: 'off' | 'warn' | 'block'; label: string }> = {
  artisanal: { mrp_horizon_days: 3, equipment_capacity: 'warn', label: 'Artisanal' },
  industrial: { mrp_horizon_days: 14, equipment_capacity: 'block', label: 'Industriel' },
  continuous: { mrp_horizon_days: 28, equipment_capacity: 'block', label: 'En continu' },
};
export const asRhythm = (v: unknown): ProductionRhythm | null => v === 'artisanal' || v === 'industrial' || v === 'continuous' ? v : null;

/** Canal de vente principal : écran d'accueil « Selon le secteur ». */
export type SalesChannel = 'direct' | 'retail' | 'wholesale' | 'multi';
export async function salesChannel(): Promise<SalesChannel> {
  const v = (await getParameter<{ channel?: string }>('sales.channel'))?.channel;
  return v === 'direct' || v === 'retail' || v === 'wholesale' ? v : 'multi';
}
/** Accueil imposé par le canal ; null = celui du secteur (multicanal). */
export function channelHomeRoute(channel: SalesChannel): string | null {
  return channel === 'retail' ? '/pos' : channel === 'wholesale' ? '/sales' : channel === 'direct' ? '/orders' : null;
}

/** Organisation du stock : par établissement (défaut) ou centralisée sur un dépôt. */
export async function stockOrganization(): Promise<'central' | 'per_store'> {
  return (await getParameter<{ mode?: string }>('stock.organization'))?.mode === 'central' ? 'central' : 'per_store';
}
/** Dépôt central : premier établissement actif de type dépôt, sinon mixte, sinon production. */
export async function centralStoreId(): Promise<string | null> {
  const r = await db.query(`SELECT id FROM stores WHERE is_active IS NOT FALSE AND kind IN ('warehouse','mixed','workshop')
    ORDER BY CASE kind WHEN 'warehouse' THEN 0 WHEN 'mixed' THEN 1 ELSE 2 END, name LIMIT 1`);
  return r.rows[0]?.id ?? null;
}
/** Établissement de livraison d'un achat : le dépôt central si le stock est centralisé. */
export async function purchaseStoreId(userStoreId?: string | null): Promise<string | undefined> {
  if ((await stockOrganization()) === 'central') return (await centralStoreId()) ?? userStoreId ?? undefined;
  return userStoreId ?? undefined;
}
/** Périmètre du tableau « À commander » : tous les établissements si le stock est centralisé. */
export async function purchasingBoardStore(userStoreId?: string | null): Promise<string | undefined> {
  return (await stockOrganization()) === 'central' ? undefined : userStoreId ?? undefined;
}
