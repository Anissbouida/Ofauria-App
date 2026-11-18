import { db } from '../config/database.js';
import { policyNumber } from '../services/policies.js';

/**
 * Synthèse chiffrée d'un ordre de fabrication (M8-05) : ce que l'écran affichait en le
 * recalculant dans le navigateur (quantités, rendement moyen, pertes, coût par pièce).
 * Lecture seule ; le coût vient de production_cout_reel (calculé par computePlanCost, G0-23).
 */
export interface PlanSummary {
  quantities: { planned: number; done: number; donePct: number; activeItems: number; producedItems: number };
  yield: {
    /** Moyenne simple des rendements saisis (même définition que les statistiques de rendement). */
    average: number | null;
    recorded: number;
    /** Articles produits dont le rendement n'est pas saisi. */
    missing: number;
    /** Seuil le plus bas des articles saisis ; sinon la politique « Rendement cible ». */
    threshold: number | null;
    belowThreshold: boolean;
    lossesTotal: number;
    toFridgeTotal: number;
  };
  cost: { total: number | null; perUnit: number | null; unitBase: number; variancePct: number | null };
}

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

type ItemRow = { status: string; planned_quantity: unknown; actual_quantity: unknown; has_yield: boolean };
type YieldRow = { rendement_reel: unknown; seuil_rendement: unknown; pertes_total: unknown; vers_frigo: unknown };
type CostRow = { cout_total: unknown; ecart_pct: unknown } | null;

const PRODUCED = ['produced', 'transferred', 'received'];

/** Calcul pur (testé sans base). `policyThreshold` : seuil par défaut quand aucun article n'en porte. */
export function summarize(items: ItemRow[], yields: YieldRow[], cost: CostRow, policyThreshold: number | null): PlanSummary {
  const active = items.filter(i => i.status !== 'cancelled');
  const planned = active.reduce((s, i) => s + n(i.planned_quantity), 0);
  const done = active.reduce((s, i) => s + n(i.actual_quantity), 0);
  const produced = active.filter(i => PRODUCED.includes(i.status));
  const average = yields.length ? round(yields.reduce((s, y) => s + n(y.rendement_reel), 0) / yields.length, 1) : null;
  const seuils = yields.map(y => n(y.seuil_rendement)).filter(v => v > 0);
  const threshold = seuils.length ? Math.min(...seuils) : policyThreshold;
  // Coût par pièce : sur la quantité produite, à défaut la quantité prévue (comme le panneau Coûts).
  const unitBase = active.reduce((s, i) => s + (n(i.actual_quantity) || n(i.planned_quantity)), 0);
  const total = cost?.cout_total != null ? n(cost.cout_total) : null;
  return {
    quantities: { planned, done, donePct: planned > 0 ? Math.round(done / planned * 100) : 0, activeItems: active.length, producedItems: produced.length },
    yield: {
      average, recorded: yields.length,
      missing: produced.filter(i => !i.has_yield).length,
      threshold, belowThreshold: average != null && threshold != null && average < threshold,
      lossesTotal: round(yields.reduce((s, y) => s + n(y.pertes_total), 0), 3),
      toFridgeTotal: round(yields.reduce((s, y) => s + n(y.vers_frigo), 0), 3),
    },
    cost: {
      total, unitBase,
      perUnit: total != null && unitBase > 0 ? round(total / unitBase) : null,
      variancePct: cost?.ecart_pct != null ? n(cost.ecart_pct) : null,
    },
  };
}

export const planSummaryRepository = {
  async get(planId: string): Promise<PlanSummary | null> {
    const plan = (await db.query(
      `SELECT p.store_id, p.target_role, (SELECT t.code FROM production_order_types t WHERE t.id = p.order_type_id) AS order_type
         FROM production_plans p WHERE p.id = $1::uuid`, [planId])).rows[0];
    if (!plan) return null;
    const [items, yields, cost] = await Promise.all([
      db.query(
        `SELECT ppi.status, ppi.planned_quantity, ppi.actual_quantity,
                EXISTS (SELECT 1 FROM production_rendement pr WHERE pr.plan_item_id = ppi.id) AS has_yield
           FROM production_plan_items ppi WHERE ppi.plan_id = $1::uuid`, [planId]),
      db.query(
        `SELECT rendement_reel, seuil_rendement, pertes_total, vers_frigo FROM production_rendement WHERE plan_id = $1::uuid`, [planId]),
      db.query(`SELECT cout_total, ecart_pct FROM production_cout_reel WHERE plan_id = $1::uuid`, [planId]),
    ]);
    const policy = await policyNumber('production.yield_target', 'pct',
      { orderType: plan.order_type, workshop: plan.target_role, storeId: plan.store_id }).catch(() => null);
    return summarize(items.rows, yields.rows, cost.rows[0] ?? null, policy);
  },
};
