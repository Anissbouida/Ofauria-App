import { db } from '../config/database.js';

/**
 * Réservation de matière par ordre (plan d'exécution multi-industries, étape 8, tâche 5 ;
 * mig 644, capacité « reservation_matiere », éteinte par défaut).
 *
 * À la confirmation, chaque besoin de l'ordre réserve ce qui est libre dans l'établissement
 * (stock des lots utilisables moins les réservations des autres ordres). La part non couverte
 * est notée et renvoyée en avertissement. La résolution (consommée au démarrage, libérée au
 * retour en brouillon ou à l'annulation) est faite par un déclencheur sur l'ordre.
 */
type Runner = { query: (q: string, p?: unknown[]) => Promise<{ rows: any[] }> };

export const materialReservationRepository = {
  /** Réserve les besoins de l'ordre ; renvoie les avertissements de couverture partielle. */
  async reserveForPlan(runner: Runner, planId: string, userId?: string | null): Promise<string[]> {
    const plan = (await runner.query(`SELECT store_id FROM production_plans WHERE id = $1`, [planId])).rows[0];
    if (!plan?.store_id) return [];
    // Une reconfirmation repart de zéro : les réservations encore actives de l'ordre sont libérées.
    await runner.query(`UPDATE material_reservations SET status = 'liberee', resolved_at = now() WHERE plan_id = $1 AND status = 'reservee'`, [planId]);
    const needs = (await runner.query(
      `SELECT n.ingredient_id, sum(n.needed_quantity)::float8 AS needed, i.name, i.unit
         FROM production_ingredient_needs n JOIN ingredients i ON i.id = n.ingredient_id
        WHERE n.plan_id = $1 GROUP BY n.ingredient_id, i.name, i.unit ORDER BY i.name`, [planId])).rows;
    const warnings: string[] = [];
    for (const n of needs) {
      // Verrou par matière et établissement : deux confirmations simultanées ne réservent pas le même stock.
      await runner.query(`SELECT pg_advisory_xact_lock(hashtext('matres:' || $1::text || ':' || $2::text))`, [n.ingredient_id, plan.store_id]);
      const free = Number((await runner.query(
        `SELECT COALESCE(free, 0)::float8 AS free FROM v_material_free_stock WHERE ingredient_id = $1 AND store_id = $2`,
        [n.ingredient_id, plan.store_id])).rows[0]?.free ?? 0);
      const qty = Math.max(0, Math.min(n.needed, free));
      const shortage = Math.max(0, Math.round((n.needed - qty) * 10000) / 10000);
      await runner.query(
        `INSERT INTO material_reservations (plan_id, ingredient_id, store_id, quantity, shortage, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
        [planId, n.ingredient_id, plan.store_id, qty, shortage, userId ?? null]);
      if (shortage > 0) warnings.push(`Réservation partielle : ${n.name} — ${qty} ${n.unit ?? ''} réservés sur ${n.needed} (${shortage} non couverts).`.replace(/\s+/g, ' '));
    }
    return warnings;
  },

  /** Réservations d'un ordre (écran de l'ordre). */
  async forPlan(planId: string, runner: Runner = db) {
    return (await runner.query(
      `SELECT r.id, r.ingredient_id, i.name AS ingredient_name, i.unit, r.quantity::float8 AS quantity, r.shortage::float8 AS shortage,
              r.status, r.created_at, r.resolved_at
         FROM material_reservations r JOIN ingredients i ON i.id = r.ingredient_id
        WHERE r.plan_id = $1 ORDER BY r.created_at DESC, i.name`, [planId])).rows;
  },

  /** Part non couverte des réservations actives d'un ordre (garde « composants réservés »). */
  async uncovered(planId: string, runner: Runner = db): Promise<{ count: number; reserved: boolean }> {
    const r = (await runner.query(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE shortage > 0)::int AS short
         FROM material_reservations WHERE plan_id = $1 AND status = 'reservee'`, [planId])).rows[0];
    return { count: r.short, reserved: r.total > 0 };
  },
};
