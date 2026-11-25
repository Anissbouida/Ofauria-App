import { db } from '../config/database.js';
import { resolvePolicy } from './policies.js';

/**
 * Audit 2026-11 C-19 — capacité physique des équipements (mig 679).
 *
 * Un équipement déclare ce qu'il traite par cycle (24 plaques, 60 kg…) et combien de cycles
 * tiennent dans une journée. Une fiche, ou un de ses formats, déclare sa charge par fournée
 * sur chaque équipement qu'elle occupe. La charge d'un jour est la somme, sur les articles
 * non annulés des ordres non annulés de ce jour et de cet établissement, des fournées
 * planifiées × charge par fournée.
 *
 * Analogie Oracle : la « capacité des ressources » d'un plan de charge (CRP) d'Oracle
 * Manufacturing, réduite à une journée et à une seule unité par ressource.
 */
type Queryable = { query: (q: string, p?: unknown[]) => Promise<{ rows: any[] }> };

export type CapacityLine = { planId: string; itemId: string; label: string; batches: number; load: number };
export type EquipmentLoad = {
  equipementId: string; name: string; unit: string | null;
  /** Capacité de la journée ; null si l'équipement n'a pas de capacité renseignée. */
  capacity: number | null;
  load: number;
  /** Part de la charge qui vient de l'ordre demandé (0 sans ordre). */
  planLoad: number;
  overloaded: boolean;
  lines: CapacityLine[];
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Charge des équipements pour une journée et un établissement. */
export async function equipmentLoad(q: Queryable, args: { date: string; storeId: string; planId?: string | null }): Promise<EquipmentLoad[]> {
  const rows = (await q.query(
    `WITH items AS (
       SELECT ppi.id AS item_id, pp.id AS plan_id, ppi.format_id, ppi.planned_quantity, ppi.nb_contenants,
              COALESCE(p.name, br.name) AS label,
              COALESCE(ppi.alt_recipe_id, ppi.base_recipe_id,
                (SELECT r.id FROM recipes r
                  WHERE r.archived_at IS NULL
                    AND (r.product_id = ppi.product_id
                         OR r.id IN (SELECT rf.recipe_id FROM recipe_formats rf WHERE rf.product_id = ppi.product_id AND rf.is_active))
                  ORDER BY (r.product_id = ppi.product_id) DESC NULLS LAST LIMIT 1)) AS recipe_id
         FROM production_plan_items ppi
         JOIN production_plans pp ON pp.id = ppi.plan_id
         LEFT JOIN products p ON p.id = ppi.product_id
         LEFT JOIN recipes br ON br.id = ppi.base_recipe_id
        WHERE pp.plan_date = $1::date AND pp.store_id = $2
          AND pp.status <> 'cancelled' AND ppi.status <> 'cancelled'
     )
     SELECT e.id AS equipement_id, e.nom, e.capacite_unite,
            (e.capacite_par_cycle * e.cycles_par_jour)::float8 AS capacity,
            i.plan_id, i.item_id, i.label,
            -- Fournées : celles du dimensionnement (lot 2), sinon quantité ÷ rendement de la fiche.
            COALESCE(i.nb_contenants::numeric, CEIL(i.planned_quantity / NULLIF(r.yield_quantity, 0)), 1)::float8 AS batches,
            re.charge_par_fournee::float8 AS charge
       FROM items i
       JOIN recipes r ON r.id = i.recipe_id
       JOIN recipe_equipements re ON re.recipe_id = i.recipe_id
        AND (re.format_id = i.format_id
             OR (re.format_id IS NULL AND NOT EXISTS (
                   SELECT 1 FROM recipe_equipements x
                    WHERE x.recipe_id = i.recipe_id AND x.format_id = i.format_id AND x.equipement_id = re.equipement_id)))
       JOIN production_equipements e ON e.id = re.equipement_id AND e.is_active
      ORDER BY e.nom, i.label`,
    [args.date, args.storeId])).rows;

  const byEq = new Map<string, EquipmentLoad>();
  for (const r of rows) {
    let eq = byEq.get(r.equipement_id);
    if (!eq) {
      eq = { equipementId: r.equipement_id, name: r.nom, unit: r.capacite_unite, capacity: r.capacity === null ? null : Number(r.capacity), load: 0, planLoad: 0, overloaded: false, lines: [] };
      byEq.set(r.equipement_id, eq);
    }
    const batches = Number(r.batches);
    const load = r3(batches * Number(r.charge));
    eq.lines.push({ planId: r.plan_id, itemId: r.item_id, label: r.label, batches, load });
    eq.load = r3(eq.load + load);
    if (args.planId && r.plan_id === args.planId) eq.planLoad = r3(eq.planLoad + load);
  }
  for (const eq of byEq.values()) eq.overloaded = eq.capacity !== null && eq.load > eq.capacity + 1e-9;
  return [...byEq.values()];
}

const UNIT_LABELS: Record<string, string> = { plaque: 'plaque(s)', contenant: 'contenant(s)', kg: 'kg', piece: 'pièce(s)' };
const fmt = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 3 });

export function overloadMessage(eq: EquipmentLoad): string {
  const u = UNIT_LABELS[eq.unit ?? ''] ?? '';
  return `${eq.name} saturé : ${fmt(eq.load)} ${u} demandés pour une capacité de ${fmt(eq.capacity ?? 0)} ${u} dans la journée`;
}

/**
 * Contrôle d'un ordre à la confirmation : seuls les équipements que cet ordre charge et qui
 * dépassent leur capacité sont retenus. Selon la politique : rien, avertissements, ou refus.
 */
export async function checkPlanCapacity(q: Queryable, planId: string): Promise<{ mode: 'off' | 'warn' | 'block'; overloaded: EquipmentLoad[] }> {
  const p = (await q.query(`SELECT plan_date::text AS d, store_id, target_role FROM production_plans WHERE id = $1`, [planId])).rows[0];
  if (!p?.store_id || !p?.d) return { mode: 'off', overloaded: [] };
  const mode = String((await resolvePolicy<{ mode: string }>('production.equipment_capacity',
    { storeId: p.store_id, workshop: p.target_role ?? null })).value.mode) as 'off' | 'warn' | 'block';
  if (mode === 'off') return { mode, overloaded: [] };
  const loads = await equipmentLoad(q, { date: p.d, storeId: p.store_id, planId });
  return { mode, overloaded: loads.filter(e => e.overloaded && e.planLoad > 0) };
}

export const equipmentCapacityRepository = {
  load: (date: string, storeId: string, planId?: string | null) => equipmentLoad(db, { date, storeId, planId }),

  /** Journée et établissement d'un ordre (null si l'ordre n'existe pas). */
  async planDay(planId: string): Promise<{ d: string; store_id: string | null } | null> {
    return (await db.query(`SELECT plan_date::text AS d, store_id FROM production_plans WHERE id = $1`, [planId])).rows[0] ?? null;
  },

  async recipeEquipments(recipeId: string) {
    return (await db.query(
      `SELECT re.id, re.format_id, re.equipement_id, re.charge_par_fournee::float8 AS charge_par_fournee,
              e.nom AS equipement_nom, e.capacite_unite, e.capacite_par_cycle::float8 AS capacite_par_cycle, e.cycles_par_jour
         FROM recipe_equipements re JOIN production_equipements e ON e.id = re.equipement_id
        WHERE re.recipe_id = $1 ORDER BY re.format_id NULLS FIRST, e.nom`, [recipeId])).rows;
  },

  /** Remplace la liste des équipements d'une fiche (une ligne par format et équipement). */
  async setRecipeEquipments(recipeId: string, rows: { formatId?: string | null; equipementId: string; chargeParFournee: number }[]) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const r = await client.query(`SELECT 1 FROM recipes WHERE id = $1 FOR UPDATE`, [recipeId]);
      if (!r.rows.length) throw Object.assign(new Error('Fiche introuvable'), { statusCode: 404 });
      const seen = new Set<string>();
      for (const row of rows) {
        const k = `${row.formatId ?? ''}|${row.equipementId}`;
        if (seen.has(k)) throw Object.assign(new Error('Un équipement figure deux fois pour le même format'), { statusCode: 400 });
        seen.add(k);
        if (row.formatId) {
          const f = await client.query(`SELECT 1 FROM recipe_formats WHERE id = $1 AND recipe_id = $2`, [row.formatId, recipeId]);
          if (!f.rows.length) throw Object.assign(new Error('Format étranger à la fiche'), { statusCode: 400 });
        }
      }
      await client.query(`DELETE FROM recipe_equipements WHERE recipe_id = $1`, [recipeId]);
      for (const row of rows) {
        await client.query(
          `INSERT INTO recipe_equipements (recipe_id, format_id, equipement_id, charge_par_fournee) VALUES ($1, $2, $3, $4)`,
          [recipeId, row.formatId ?? null, row.equipementId, row.chargeParFournee]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return this.recipeEquipments(recipeId);
  },
};
