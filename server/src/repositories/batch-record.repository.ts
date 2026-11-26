import { db } from '../config/database.js';

/**
 * Dossier de lot d'un ordre de fabrication (feuille de route, étape 4.2) : tout ce qu'exige la
 * revue d'un lot avant libération (laboratoire pharmaceutique, agroalimentaire). Lecture seule,
 * à partir des données déjà saisies :
 *   - matières consommées par lot fournisseur ;
 *   - pesées du bon de sortie (quantité prévue, pesée, écart, qui a pesé, qui a réceptionné) ;
 *   - étapes (début, fin, opérateur) et relevés de procédé (consigne, mesure, conformité) ;
 *   - contrôles qualité rattachés à l'ordre ;
 *   - lots produits, quantités et libération.
 */
const WHO = (a: string) => `NULLIF(TRIM(COALESCE(${a}.first_name, '') || ' ' || COALESCE(${a}.last_name, '')), '')`;

export const batchRecordRepository = {
  async forPlan(planId: string) {
    const plan = (await db.query(
      `SELECT p.id, p.of_number, p.plan_date, p.status, p.notes, p.created_at, p.confirmed_at, p.completed_at,
              ot.label AS order_type, ${WHO('cb')} AS created_by_name
         FROM production_plans p
         LEFT JOIN production_order_types ot ON ot.id = p.order_type_id
         LEFT JOIN users cb ON cb.id = p.created_by
        WHERE p.id = $1`, [planId])).rows[0];
    if (!plan) return null;

    const [items, materials, weighings, steps, readings, inspections, lots] = await Promise.all([
      db.query(
        `SELECT pi.id, COALESCE(pr.name, rc.name) AS product_name, pi.planned_quantity::float8, pi.actual_quantity::float8, pi.status
           FROM production_plan_items pi LEFT JOIN products pr ON pr.id = pi.product_id LEFT JOIN recipes rc ON rc.id = pi.base_recipe_id
          WHERE pi.plan_id = $1 ORDER BY 2`, [planId]),
      db.query(
        `SELECT i.name AS ingredient_name, i.unit, l.lot_number, l.supplier_lot_number, l.expiration_date,
                SUM(u.quantity_used)::float8 AS quantity
           FROM production_lot_usage u JOIN ingredients i ON i.id = u.ingredient_id
           LEFT JOIN ingredient_lots l ON l.id = u.ingredient_lot_id
          WHERE u.production_plan_id = $1
          GROUP BY i.name, i.unit, l.lot_number, l.supplier_lot_number, l.expiration_date
          ORDER BY i.name, l.lot_number`, [planId]),
      db.query(
        `SELECT b.numero AS bon_number, COALESCE(i.name, pk.name) AS ingredient_name, COALESCE(bl.unit, i.unit) AS unit,
                bl.needed_quantity::float8, bl.actual_quantity::float8, bl.ecart_quantity::float8, bl.ecart_reason, bl.tolerance_applied,
                bl.weighed_at, ${WHO('w')} AS weighed_by_name, b.status AS bon_status, ${WHO('rc')} AS received_by_name
           FROM production_bons_sortie b
           JOIN production_bons_sortie_lignes bl ON bl.bon_id = b.id
           LEFT JOIN ingredients i ON i.id = bl.ingredient_id
           LEFT JOIN packaging_items pk ON pk.id = bl.packaging_id
           LEFT JOIN users w ON w.id = bl.weighed_by
           LEFT JOIN users rc ON rc.id = b.closed_by
          WHERE b.plan_id = $1 AND b.status <> 'annule'
          ORDER BY b.numero, ingredient_name`, [planId]),
      db.query(
        `SELECT e.id, e.ordre, e.nom, e.status, e.started_at, e.completed_at, e.controle_qualite, COALESCE(pr.name, rc.name) AS product_name,
                ${WHO('sb')} AS started_by_name, ${WHO('cb')} AS completed_by_name
           FROM production_item_etapes e JOIN production_plan_items pi ON pi.id = e.plan_item_id
           LEFT JOIN products pr ON pr.id = pi.product_id LEFT JOIN recipes rc ON rc.id = pi.base_recipe_id
           LEFT JOIN users sb ON sb.id = e.started_by LEFT JOIN users cb ON cb.id = e.completed_by
          WHERE pi.plan_id = $1 ORDER BY product_name, e.ordre`, [planId]),
      db.query(
        `SELECT r.etape_id, r.parametre, r.consigne, r.tolerance, r.mesure, r.conforme, r.est_ccp, r.note, r.mesure_a, ${WHO('m')} AS measured_by_name
           FROM production_step_readings r JOIN production_item_etapes e ON e.id = r.etape_id
           JOIN production_plan_items pi ON pi.id = e.plan_item_id LEFT JOIN users m ON m.id = r.mesure_par
          WHERE pi.plan_id = $1 ORDER BY r.mesure_a`, [planId]),
      db.query(
        `SELECT q.title, q.template_name, q.inspected_on, q.conformity, q.status, q.notes, q.control_stage, ${WHO('ib')} AS inspected_by_name
           FROM quality_inspections q LEFT JOIN users ib ON ib.id = q.inspected_by
          WHERE q.plan_id = $1 ORDER BY q.inspected_on, q.created_at`, [planId]),
      db.query(
        `SELECT pl.lot_number, pr.name AS product_name, pl.quantity_total::float8, pl.produced_at, pl.expires_at, pl.status,
                pl.released_at, pl.release_note, ${WHO('rb')} AS released_by_name
           FROM product_lots pl JOIN products pr ON pr.id = pl.product_id LEFT JOIN users rb ON rb.id = pl.released_by
          WHERE pl.production_plan_id = $1 ORDER BY pl.lot_number`, [planId]),
    ]);

    // Écarts de pesée hors tolérance et relevés non conformes : signalés en tête du dossier.
    const alerts: string[] = [];
    for (const w of weighings.rows) {
      if (w.actual_quantity !== null && w.needed_quantity && w.tolerance_applied !== null && w.tolerance_applied !== undefined
          && Math.abs(Number(w.actual_quantity) - Number(w.needed_quantity)) > Number(w.tolerance_applied) + 1e-9) {
        alerts.push(`Pesée hors tolérance : ${w.ingredient_name} (${w.actual_quantity} pour ${w.needed_quantity} ${w.unit ?? ''})`);
      }
      if (w.weighed_by_name && w.received_by_name && w.weighed_by_name === w.received_by_name) {
        alerts.push(`Même personne à la pesée et à la réception : ${w.ingredient_name}`);
      }
    }
    for (const r of readings.rows) if (r.conforme === false) alerts.push(`Relevé non conforme : ${r.parametre} = ${r.mesure}`);
    for (const q of inspections.rows) if (q.conformity === false) alerts.push(`Contrôle non conforme : ${q.title ?? q.template_name}`);
    for (const l of lots.rows) if (!l.released_at && l.status === 'pending_release') alerts.push(`Lot non libéré : ${l.lot_number}`);

    return {
      plan, items: items.rows, materials: materials.rows, weighings: weighings.rows,
      steps: steps.rows.map(s => ({ ...s, readings: readings.rows.filter(r => r.etape_id === s.id) })),
      inspections: inspections.rows, lots: lots.rows, alerts, generated_at: new Date().toISOString(),
    };
  },
};
