import { db } from '../config/database.js';

/**
 * Aperçu d'impact des réglages de production (C-09) : combien d'ordres ouverts un changement
 * de type d'ordre ou de politique touche. Lecture seule.
 *   brouillon : le réglage s'appliquera à la confirmation, sans risque ;
 *   en cours  : confirmé, en attente d'ingrédients, prêt ou en production — le parcours est
 *               déjà engagé (bon de sortie généré, consommation choisie).
 */
const UNDERWAY = ['confirmed', 'awaiting_ingredients', 'ready_to_produce', 'in_progress'];
export type PolicyScope = 'company' | 'store' | 'workshop' | 'order_type' | 'product';

type Runner = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export const productionImpactRepository = {
  async forOrderType(typeId: string, runner: Runner = db): Promise<{ draft: number; underway: number }> {
    const r = await runner.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'draft')::int AS draft,
              COUNT(*) FILTER (WHERE status = ANY($2::text[]))::int AS underway
         FROM production_plans WHERE order_type_id = $1::uuid`, [typeId, UNDERWAY]);
    return r.rows[0];
  },

  /** Ordres non terminés concernés par une valeur de politique posée à ce niveau. */
  async forPolicyScope(scopeType: PolicyScope, scopeId: string): Promise<{ draft: number; underway: number }> {
    const cond = scopeType === 'store' ? `AND p.store_id = $2::uuid`
      : scopeType === 'workshop' ? `AND p.target_role = $2::text`
      // Niveau « type d'ordre » : rangé sous le CODE du type (policies.ts, levels.orderTypes).
      : scopeType === 'order_type' ? `AND p.order_type_id = (SELECT t.id FROM production_order_types t WHERE t.code = $2::text)`
      : scopeType === 'product' ? `AND EXISTS (SELECT 1 FROM production_plan_items i WHERE i.plan_id = p.id AND i.product_id = $2::uuid)`
      : '';
    const r = await db.query(
      `SELECT COUNT(*) FILTER (WHERE p.status = 'draft')::int AS draft,
              COUNT(*) FILTER (WHERE p.status = ANY($1::text[]))::int AS underway
         FROM production_plans p WHERE p.status NOT IN ('completed', 'cancelled') ${cond}`,
      cond ? [UNDERWAY, scopeId] : [UNDERWAY]);
    return r.rows[0];
  },
};
