import { db } from '../config/database.js';

const TAUX_CHARGES_FIXES_ESTIME = 0.40;

export const productionCoutRepository = {

  // ═══════════════════════════════════════════════════════════════════════════
  // Equipements CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  async listEquipements(storeId?: string) {
    const filter = storeId ? 'WHERE (store_id = $1 OR store_id IS NULL) AND is_active = true' : 'WHERE is_active = true';
    const params = storeId ? [storeId] : [];
    const result = await db.query(
      `SELECT * FROM production_equipements ${filter} ORDER BY type, nom`, params
    );
    return result.rows;
  },

  async getEquipement(id: string) {
    const result = await db.query(`SELECT * FROM production_equipements WHERE id = $1`, [id]);
    return result.rows[0] || null;
  },

  async createEquipement(data: {
    nom: string; type: string; cout_horaire: number;
    puissance_kw?: number; cout_kwh?: number; notes?: string; store_id?: string;
  }) {
    const result = await db.query(
      `INSERT INTO production_equipements (nom, type, cout_horaire, puissance_kw, cout_kwh, notes, store_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [data.nom, data.type, data.cout_horaire, data.puissance_kw || null,
       data.cout_kwh || 1.50, data.notes || null, data.store_id || null]
    );
    return result.rows[0];
  },

  async updateEquipement(id: string, data: Partial<{
    nom: string; type: string; cout_horaire: number;
    puissance_kw: number; cout_kwh: number; notes: string; is_active: boolean;
  }>) {
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    for (const [key, val] of Object.entries(data)) {
      if (val !== undefined) {
        sets.push(`${key} = $${idx}`);
        params.push(val);
        idx++;
      }
    }
    if (sets.length === 0) return null;
    sets.push('updated_at = NOW()');
    params.push(id);
    const result = await db.query(
      `UPDATE production_equipements SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, params
    );
    return result.rows[0];
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Temps de travail (legacy manual labor tracking)
  // ═══════════════════════════════════════════════════════════════════════════

  async recordTempsTravail(data: {
    planId: string; planItemId?: string; employeeId: string;
    debut: string; fin?: string; dureeMinutes?: number; notes?: string;
  }) {
    const empResult = await db.query(
      `SELECT hourly_rate, monthly_salary FROM employees WHERE id = $1`, [data.employeeId]
    );
    const emp = empResult.rows[0];
    const rate = emp?.hourly_rate ?? (emp?.monthly_salary ? Math.round(emp.monthly_salary / 191 * 100) / 100 : null);

    const duree = data.dureeMinutes ?? (data.fin
      ? Math.round((new Date(data.fin).getTime() - new Date(data.debut).getTime()) / 60000)
      : null);

    const result = await db.query(
      `INSERT INTO production_temps_travail
       (plan_id, plan_item_id, employee_id, debut, fin, duree_minutes, hourly_rate_snapshot, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [data.planId, data.planItemId || null, data.employeeId,
       data.debut, data.fin || null, duree, rate, data.notes || null]
    );
    return result.rows[0];
  },

  async getTempsTravail(planId: string) {
    const result = await db.query(
      `SELECT ptt.*, e.first_name, e.last_name, e.role
       FROM production_temps_travail ptt
       JOIN employees e ON e.id = ptt.employee_id
       WHERE ptt.plan_id = $1
       ORDER BY ptt.debut ASC`,
      [planId]
    );
    return result.rows;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Equipement usage
  // ═══════════════════════════════════════════════════════════════════════════

  async recordEquipementUsage(data: {
    planId: string; equipementId: string;
    debut: string; fin?: string; dureeMinutes?: number; notes?: string;
  }) {
    const eqResult = await db.query(
      `SELECT cout_horaire FROM production_equipements WHERE id = $1`, [data.equipementId]
    );
    const coutHoraire = eqResult.rows[0]?.cout_horaire ?? 0;

    const duree = data.dureeMinutes ?? (data.fin
      ? Math.round((new Date(data.fin).getTime() - new Date(data.debut).getTime()) / 60000)
      : null);

    const result = await db.query(
      `INSERT INTO production_equipement_usage
       (plan_id, equipement_id, debut, fin, duree_minutes, cout_horaire_snapshot, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [data.planId, data.equipementId, data.debut, data.fin || null,
       duree, coutHoraire, data.notes || null]
    );
    return result.rows[0];
  },

  async getEquipementUsage(planId: string) {
    const result = await db.query(
      `SELECT peu.*, pe.nom as equipement_nom, pe.type as equipement_type
       FROM production_equipement_usage peu
       JOIN production_equipements pe ON pe.id = peu.equipement_id
       WHERE peu.plan_id = $1
       ORDER BY peu.debut ASC`,
      [planId]
    );
    return result.rows;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Cost calculation
  // Formule : Cout de revient = Matieres + Main d'oeuvre + Charges fixes
  // MO calculee depuis production_item_etapes (qui a valide chaque etape)
  // Charges fixes = quote-part mensuelle / nombre de plans du mois
  // ═══════════════════════════════════════════════════════════════════════════

  async calculateAndSave(planId: string, userId: string) {
    // 1. Cout matieres — FIFO reel via production_lot_usage, fallback inventory_transactions
    const lotUsageResult = await db.query(
      `SELECT plu.ingredient_id, i.name,
              SUM(plu.quantity_used) as qty,
              SUM(plu.quantity_used * COALESCE(il.unit_cost, 0)) as total,
              CASE WHEN SUM(plu.quantity_used) > 0
                   THEN SUM(plu.quantity_used * COALESCE(il.unit_cost, 0)) / SUM(plu.quantity_used)
                   ELSE 0 END as unit_cost_avg
       FROM production_lot_usage plu
       JOIN ingredient_lots il ON il.id = plu.ingredient_lot_id
       JOIN ingredients i ON i.id = plu.ingredient_id
       WHERE plu.production_plan_id = $1
       GROUP BY plu.ingredient_id, i.name`,
      [planId]
    );
    const lotCoveredIds = new Set(lotUsageResult.rows.map(r => r.ingredient_id));

    const fallbackResult = await db.query(
      `SELECT it.ingredient_id, i.name,
              SUM(ABS(it.quantity_change)) as qty,
              COALESCE(i.unit_cost, 0) as unit_cost,
              SUM(ABS(it.quantity_change)) * COALESCE(i.unit_cost, 0) as total
       FROM inventory_transactions it
       JOIN ingredients i ON i.id = it.ingredient_id
       WHERE it.production_plan_id = $1 AND it.type = 'production'
       GROUP BY it.ingredient_id, i.name, i.unit_cost`,
      [planId]
    );

    const detailMatieres: { ingredient_id: string; name: string; qty: number; unit_cost: number; total: number }[] = [];
    for (const r of lotUsageResult.rows) {
      detailMatieres.push({
        ingredient_id: r.ingredient_id, name: r.name,
        qty: parseFloat(r.qty), unit_cost: parseFloat(r.unit_cost_avg),
        total: parseFloat(r.total),
      });
    }
    for (const r of fallbackResult.rows) {
      if (lotCoveredIds.has(r.ingredient_id)) continue;
      detailMatieres.push({
        ingredient_id: r.ingredient_id, name: r.name,
        qty: parseFloat(r.qty), unit_cost: parseFloat(r.unit_cost),
        total: parseFloat(r.total),
      });
    }
    const coutMatieres = detailMatieres.reduce((s, d) => s + d.total, 0);

    // 2. Cout main d'oeuvre — depuis production_item_etapes
    // Chaque etape completee a un completed_by (user) et duree_reelle_min.
    // Taux horaire = monthly_salary / 191 (norme marocaine 44h/semaine)
    const moResult = await db.query(
      `SELECT e.id as employee_id, e.first_name || ' ' || e.last_name as name,
              SUM(pie.duree_reelle_min) as total_minutes,
              COALESCE(e.hourly_rate, ROUND(e.monthly_salary / 191, 2)) as hourly_rate,
              ROUND(SUM(pie.duree_reelle_min) * COALESCE(e.hourly_rate, ROUND(e.monthly_salary / 191, 2)) / 60.0, 2) as total
       FROM production_item_etapes pie
       JOIN production_plan_items ppi ON ppi.id = pie.plan_item_id
       JOIN users u ON u.id = pie.completed_by
       JOIN employees e ON e.user_id = u.id
       WHERE ppi.plan_id = $1
         AND pie.status = 'completed'
         AND pie.duree_reelle_min IS NOT NULL
         AND pie.completed_by IS NOT NULL
       GROUP BY e.id, e.first_name, e.last_name, e.hourly_rate, e.monthly_salary`,
      [planId]
    );
    const detailMO = moResult.rows.map(r => ({
      employee_id: r.employee_id, name: r.name,
      minutes: parseInt(r.total_minutes), hourly_rate: parseFloat(r.hourly_rate),
      total: parseFloat(r.total),
    }));
    const coutMO = detailMO.reduce((s, d) => s + d.total, 0);

    // 3. Charges fixes = TAUX_CHARGES_FIXES_ESTIME × cout matieres
    const coutCharges = Math.round(coutMatieres * TAUX_CHARGES_FIXES_ESTIME * 100) / 100;
    const detailCharges: { label: string; taux: number; base: number; part: number }[] = [];
    if (coutCharges > 0) {
      detailCharges.push({
        label: 'Charges fixes estimees',
        taux: TAUX_CHARGES_FIXES_ESTIME,
        base: coutMatieres,
        part: coutCharges,
      });
    }

    // Cout prevu (from recipes)
    const prevuResult = await db.query(
      `SELECT SUM(COALESCE(r.total_cost, 0) * ppi.planned_quantity / NULLIF(r.yield_quantity, 0)) as total
       FROM production_plan_items ppi
       LEFT JOIN recipes r ON r.product_id = ppi.product_id
       WHERE ppi.plan_id = $1 AND ppi.status != 'cancelled'`,
      [planId]
    );
    const coutPrevu = parseFloat(prevuResult.rows[0]?.total) || null;
    const coutTotal = coutMatieres + coutMO + coutCharges;
    const ecartPct = coutPrevu && coutPrevu > 0
      ? Math.round((coutTotal - coutPrevu) / coutPrevu * 10000) / 100
      : null;

    // Upsert
    const result = await db.query(
      `INSERT INTO production_cout_reel
       (plan_id, cout_matieres, cout_main_oeuvre, cout_energie, cout_pertes,
        cout_charges_fixes, detail_charges_fixes,
        cout_prevu, ecart_pct,
        detail_matieres, detail_main_oeuvre, detail_energie, detail_pertes,
        calculated_by, calculated_at)
       VALUES ($1, $2, $3, 0, 0, $4, $5, $6, $7, $8, $9, '[]', '[]', $10, NOW())
       ON CONFLICT (plan_id)
       DO UPDATE SET
         cout_matieres = EXCLUDED.cout_matieres,
         cout_main_oeuvre = EXCLUDED.cout_main_oeuvre,
         cout_energie = 0,
         cout_pertes = 0,
         cout_charges_fixes = EXCLUDED.cout_charges_fixes,
         detail_charges_fixes = EXCLUDED.detail_charges_fixes,
         cout_prevu = EXCLUDED.cout_prevu,
         ecart_pct = EXCLUDED.ecart_pct,
         detail_matieres = EXCLUDED.detail_matieres,
         detail_main_oeuvre = EXCLUDED.detail_main_oeuvre,
         detail_energie = '[]',
         detail_pertes = '[]',
         calculated_by = EXCLUDED.calculated_by,
         calculated_at = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [planId, coutMatieres, coutMO, coutCharges,
       JSON.stringify(detailCharges), coutPrevu, ecartPct,
       JSON.stringify(detailMatieres), JSON.stringify(detailMO),
       userId]
    );
    return result.rows[0];
  },

  // ─── Get cost for a plan ───
  async findByPlan(planId: string) {
    const result = await db.query(
      `SELECT pcr.*, u.first_name as calculated_by_name
       FROM production_cout_reel pcr
       LEFT JOIN users u ON u.id = pcr.calculated_by
       WHERE pcr.plan_id = $1`,
      [planId]
    );
    return result.rows[0] || null;
  },

  // ─── Batch calculate all uncalculated completed plans ───
  async calculateAllUncalculated(userId: string) {
    const result = await db.query(
      `SELECT pp.id FROM production_plans pp
       LEFT JOIN production_cout_reel pcr ON pcr.plan_id = pp.id
       WHERE pp.status = 'completed' AND pcr.id IS NULL
       ORDER BY pp.plan_date DESC`
    );
    let calculated = 0;
    for (const row of result.rows) {
      try {
        await this.calculateAndSave(row.id, userId);
        calculated++;
      } catch (err) {
        console.error(`Batch calculate failed for plan ${row.id}:`, err);
      }
    }
    return { total: result.rows.length, calculated };
  },

  // ─── Dashboard: plans with cost (per-plan breakdown) ───
  async getPlansWithCost(storeId: string, dateFrom?: string, dateTo?: string) {
    const params: unknown[] = [storeId];
    let dateFilter = '';
    if (dateFrom) { params.push(dateFrom); dateFilter += ` AND pp.plan_date >= $${params.length}`; }
    if (dateTo) { params.push(dateTo); dateFilter += ` AND pp.plan_date <= $${params.length}`; }

    const result = await db.query(
      `SELECT
         pp.id as plan_id,
         pp.plan_date,
         pp.status,
         pp.target_role,
         pp.created_by,
         u.first_name || ' ' || u.last_name as created_by_name,
         pcr.calculated_at,
         COALESCE(pcr.cout_matieres, 0) as plan_cout_matieres,
         COALESCE(pcr.cout_main_oeuvre, 0) as plan_cout_mo,
         COALESCE(pcr.cout_charges_fixes, 0) as plan_cout_charges,
         COALESCE(pcr.cout_matieres, 0) + COALESCE(pcr.cout_main_oeuvre, 0) + COALESCE(pcr.cout_charges_fixes, 0) as plan_cout_revient,
         pcr.detail_charges_fixes as plan_detail_charges,
         (
           SELECT json_agg(sub ORDER BY sub.product_name)
           FROM (
             SELECT
               ppi.id as item_id,
               ppi.product_id,
               p.name as product_name,
               ppi.planned_quantity,
               ppi.actual_quantity,
               ppi.status as item_status,
               COALESCE(item_mat.cout_matieres_item, 0) as cout_matieres_item,
               COALESCE(item_mo.cout_mo_item, 0) as cout_mo_item
             FROM production_plan_items ppi
             JOIN products p ON p.id = ppi.product_id
             LEFT JOIN LATERAL (
               SELECT SUM(plu.quantity_used * COALESCE(il.unit_cost, 0)) as cout_matieres_item
               FROM production_lot_usage plu
               JOIN ingredient_lots il ON il.id = plu.ingredient_lot_id
               WHERE plu.production_plan_id = pp.id
                 AND plu.ingredient_id IN (
                   SELECT ri.ingredient_id FROM recipe_ingredients ri
                   JOIN recipes r ON r.id = ri.recipe_id
                   WHERE r.product_id = ppi.product_id
                 )
             ) item_mat ON true
             LEFT JOIN LATERAL (
               SELECT ROUND(SUM(pie.duree_reelle_min * COALESCE(e.hourly_rate, ROUND(e.monthly_salary / 191, 2)) / 60.0), 2) as cout_mo_item
               FROM production_item_etapes pie
               JOIN users usr ON usr.id = pie.completed_by
               JOIN employees e ON e.user_id = usr.id
               WHERE pie.plan_item_id = ppi.id
                 AND pie.status = 'completed'
                 AND pie.duree_reelle_min IS NOT NULL
                 AND pie.completed_by IS NOT NULL
             ) item_mo ON true
             WHERE ppi.plan_id = pp.id AND ppi.status != 'cancelled'
           ) sub
         ) as items
       FROM production_plans pp
       LEFT JOIN users u ON u.id = pp.created_by
       LEFT JOIN production_cout_reel pcr ON pcr.plan_id = pp.id
       WHERE pp.store_id = $1 AND pp.status = 'completed'${dateFilter}
       ORDER BY pp.plan_date DESC`,
      params
    );
    return result.rows;
  },

  // ─── Dashboard: cost stats over a period ───
  async getStats(storeId: string, dateFrom?: string, dateTo?: string) {
    const params: unknown[] = [storeId];
    let dateFilter = '';
    if (dateFrom) { params.push(dateFrom); dateFilter += ` AND pp.plan_date >= $${params.length}`; }
    if (dateTo) { params.push(dateTo); dateFilter += ` AND pp.plan_date <= $${params.length}`; }

    const result = await db.query(
      `SELECT
         COUNT(pcr.id) as total_plans,
         SUM(pcr.cout_matieres) as total_matieres,
         SUM(pcr.cout_main_oeuvre) as total_main_oeuvre,
         SUM(COALESCE(pcr.cout_charges_fixes, 0)) as total_charges,
         SUM(pcr.cout_matieres + pcr.cout_main_oeuvre + COALESCE(pcr.cout_charges_fixes, 0)) as total_cout,
         SUM(pcr.cout_prevu) as total_prevu,
         AVG(pcr.ecart_pct) as avg_ecart_pct
       FROM production_cout_reel pcr
       JOIN production_plans pp ON pp.id = pcr.plan_id
       WHERE pp.store_id = $1${dateFilter}`,
      params
    );
    return result.rows[0];
  },

  // ─── Cost breakdown by day (for chart) ───
  async getByDay(storeId: string, dateFrom: string, dateTo: string) {
    const result = await db.query(
      `SELECT pp.plan_date,
              SUM(pcr.cout_matieres) as matieres,
              SUM(pcr.cout_main_oeuvre) as main_oeuvre,
              SUM(COALESCE(pcr.cout_charges_fixes, 0)) as charges,
              SUM(pcr.cout_matieres + pcr.cout_main_oeuvre + COALESCE(pcr.cout_charges_fixes, 0)) as total
       FROM production_cout_reel pcr
       JOIN production_plans pp ON pp.id = pcr.plan_id
       WHERE pp.store_id = $1 AND pp.plan_date >= $2 AND pp.plan_date <= $3
       GROUP BY pp.plan_date
       ORDER BY pp.plan_date ASC`,
      [storeId, dateFrom, dateTo]
    );
    return result.rows;
  },

  // ─── Cost aggregated by product ───
  async getByProduct(storeId: string, dateFrom?: string, dateTo?: string) {
    const params: unknown[] = [storeId];
    let dateFilter = '';
    if (dateFrom) { params.push(dateFrom); dateFilter += ` AND pp.plan_date >= $${params.length}`; }
    if (dateTo) { params.push(dateTo); dateFilter += ` AND pp.plan_date <= $${params.length}`; }

    const result = await db.query(
      `SELECT
         ppi.product_id,
         p.name as product_name,
         COUNT(DISTINCT pp.id) as nb_plans,
         SUM(COALESCE(ppi.actual_quantity, ppi.planned_quantity)) as total_quantity,
         SUM(
           COALESCE((
             SELECT SUM(plu.quantity_used * COALESCE(il.unit_cost, 0))
             FROM production_lot_usage plu
             JOIN ingredient_lots il ON il.id = plu.ingredient_lot_id
             WHERE plu.production_plan_id = pp.id
               AND plu.ingredient_id IN (
                 SELECT ri.ingredient_id FROM recipe_ingredients ri
                 JOIN recipes r ON r.id = ri.recipe_id
                 WHERE r.product_id = ppi.product_id
               )
           ), 0)
         ) as total_matieres
       FROM production_plan_items ppi
       JOIN production_plans pp ON pp.id = ppi.plan_id
       JOIN products p ON p.id = ppi.product_id
       JOIN production_cout_reel pcr ON pcr.plan_id = pp.id
       WHERE pp.store_id = $1 AND pp.status = 'completed' AND ppi.status != 'cancelled'${dateFilter}
       GROUP BY ppi.product_id, p.name
       ORDER BY total_matieres DESC`,
      params
    );
    return result.rows;
  },
};
