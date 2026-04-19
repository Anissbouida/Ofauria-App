import { db } from '../config/database.js';

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
  // Temps de travail (labor tracking)
  // ═══════════════════════════════════════════════════════════════════════════

  async recordTempsTravail(data: {
    planId: string; planItemId?: string; employeeId: string;
    debut: string; fin?: string; dureeMinutes?: number; notes?: string;
  }) {
    // Snapshot the employee's hourly rate at record time
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
  // Cost calculation — aggregate all 4 components
  // ═══════════════════════════════════════════════════════════════════════════

  async calculateAndSave(planId: string, userId: string) {
    // 1. Coût matières — from actual ingredient consumption during production
    const matieresResult = await db.query(
      `SELECT it.ingredient_id, i.name, ABS(it.quantity_change) as qty,
              COALESCE(i.unit_cost, 0) as unit_cost,
              ABS(it.quantity_change) * COALESCE(i.unit_cost, 0) as total
       FROM inventory_transactions it
       JOIN ingredients i ON i.id = it.ingredient_id
       WHERE it.production_plan_id = $1 AND it.type = 'production'`,
      [planId]
    );
    const detailMatieres = matieresResult.rows.map(r => ({
      ingredient_id: r.ingredient_id, name: r.name,
      qty: parseFloat(r.qty), unit_cost: parseFloat(r.unit_cost),
      total: parseFloat(r.total),
    }));
    const coutMatieres = detailMatieres.reduce((s, d) => s + d.total, 0);

    // 2. Coût main d'oeuvre — from temps_travail
    const moResult = await db.query(
      `SELECT ptt.employee_id, e.first_name || ' ' || e.last_name as name,
              ptt.duree_minutes, ptt.hourly_rate_snapshot,
              ROUND(COALESCE(ptt.duree_minutes, 0) * COALESCE(ptt.hourly_rate_snapshot, 0) / 60.0, 2) as total
       FROM production_temps_travail ptt
       JOIN employees e ON e.id = ptt.employee_id
       WHERE ptt.plan_id = $1 AND ptt.duree_minutes IS NOT NULL`,
      [planId]
    );
    const detailMO = moResult.rows.map(r => ({
      employee_id: r.employee_id, name: r.name,
      minutes: parseInt(r.duree_minutes), hourly_rate: parseFloat(r.hourly_rate_snapshot),
      total: parseFloat(r.total),
    }));
    const coutMO = detailMO.reduce((s, d) => s + d.total, 0);

    // 3. Coût énergie — from equipement usage
    const energieResult = await db.query(
      `SELECT peu.equipement_id, pe.nom as name,
              peu.duree_minutes, peu.cout_horaire_snapshot,
              ROUND(COALESCE(peu.duree_minutes, 0) * COALESCE(peu.cout_horaire_snapshot, 0) / 60.0, 2) as total
       FROM production_equipement_usage peu
       JOIN production_equipements pe ON pe.id = peu.equipement_id
       WHERE peu.plan_id = $1 AND peu.duree_minutes IS NOT NULL`,
      [planId]
    );
    const detailEnergie = energieResult.rows.map(r => ({
      equipement_id: r.equipement_id, name: r.name,
      minutes: parseInt(r.duree_minutes), cout_horaire: parseFloat(r.cout_horaire_snapshot),
      total: parseFloat(r.total),
    }));
    const coutEnergie = detailEnergie.reduce((s, d) => s + d.total, 0);

    // 4. Coût pertes — from rendement pertes_detail × ingredient unit_cost
    const pertesResult = await db.query(
      `SELECT pr.pertes_detail, pr.pertes_total,
              COALESCE(p.cost_price, 0) as product_cost_price,
              ppi.product_id
       FROM production_rendement pr
       JOIN production_plan_items ppi ON ppi.id = pr.plan_item_id
       LEFT JOIN products p ON p.id = ppi.product_id
       WHERE pr.plan_id = $1`,
      [planId]
    );
    let coutPertes = 0;
    const detailPertes: { categorie: string; quantite: number; cout_unitaire: number; total: number }[] = [];
    for (const row of pertesResult.rows) {
      const costPerUnit = parseFloat(row.product_cost_price) || 0;
      const pertes = row.pertes_detail || [];
      for (const p of pertes) {
        const total = p.quantite * costPerUnit;
        detailPertes.push({ categorie: p.categorie, quantite: p.quantite, cout_unitaire: costPerUnit, total });
        coutPertes += total;
      }
    }

    // 5. Coût prévu — from recipe total_cost × planned_quantity
    const prevuResult = await db.query(
      `SELECT SUM(COALESCE(r.total_cost, 0) * ppi.planned_quantity / NULLIF(r.yield_quantity, 0)) as total
       FROM production_plan_items ppi
       LEFT JOIN recipes r ON r.product_id = ppi.product_id
       WHERE ppi.plan_id = $1 AND ppi.status != 'cancelled'`,
      [planId]
    );
    const coutPrevu = parseFloat(prevuResult.rows[0]?.total) || null;
    const coutTotal = coutMatieres + coutMO + coutEnergie + coutPertes;
    const ecartPct = coutPrevu && coutPrevu > 0
      ? Math.round((coutTotal - coutPrevu) / coutPrevu * 10000) / 100
      : null;

    // Upsert
    const result = await db.query(
      `INSERT INTO production_cout_reel
       (plan_id, cout_matieres, cout_main_oeuvre, cout_energie, cout_pertes,
        cout_prevu, ecart_pct,
        detail_matieres, detail_main_oeuvre, detail_energie, detail_pertes,
        calculated_by, calculated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
       ON CONFLICT (plan_id)
       DO UPDATE SET
         cout_matieres = EXCLUDED.cout_matieres,
         cout_main_oeuvre = EXCLUDED.cout_main_oeuvre,
         cout_energie = EXCLUDED.cout_energie,
         cout_pertes = EXCLUDED.cout_pertes,
         cout_prevu = EXCLUDED.cout_prevu,
         ecart_pct = EXCLUDED.ecart_pct,
         detail_matieres = EXCLUDED.detail_matieres,
         detail_main_oeuvre = EXCLUDED.detail_main_oeuvre,
         detail_energie = EXCLUDED.detail_energie,
         detail_pertes = EXCLUDED.detail_pertes,
         calculated_by = EXCLUDED.calculated_by,
         calculated_at = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [planId, coutMatieres, coutMO, coutEnergie, coutPertes,
       coutPrevu, ecartPct,
       JSON.stringify(detailMatieres), JSON.stringify(detailMO),
       JSON.stringify(detailEnergie), JSON.stringify(detailPertes),
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
         SUM(pcr.cout_energie) as total_energie,
         SUM(pcr.cout_pertes) as total_pertes,
         SUM(pcr.cout_matieres + pcr.cout_main_oeuvre + pcr.cout_energie + pcr.cout_pertes) as total_cout,
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
              SUM(pcr.cout_energie) as energie,
              SUM(pcr.cout_pertes) as pertes,
              SUM(pcr.cout_matieres + pcr.cout_main_oeuvre + pcr.cout_energie + pcr.cout_pertes) as total
       FROM production_cout_reel pcr
       JOIN production_plans pp ON pp.id = pcr.plan_id
       WHERE pp.store_id = $1 AND pp.plan_date >= $2 AND pp.plan_date <= $3
       GROUP BY pp.plan_date
       ORDER BY pp.plan_date ASC`,
      [storeId, dateFrom, dateTo]
    );
    return result.rows;
  },
};
