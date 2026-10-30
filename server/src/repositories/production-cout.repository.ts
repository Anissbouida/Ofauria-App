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
  // Formule : Cout de revient = Matieres + Main d'oeuvre + Energie + Charges fixes
  // MO calculee depuis production_item_etapes (qui a valide chaque etape)
  // Energie = usages equipements (production_equipement_usage) × cout horaire snapshot
  // Charges fixes = taux forfaitaire sur matieres (TAUX_CHARGES_FIXES_ESTIME)
  // Pertes = valorisation des pertes du rendement au cout matiere unitaire :
  //   un « dont » informatif, PAS un terme additif (la matiere perdue est deja
  //   dans cout_matieres — l'additionner la compterait deux fois). Cf. mig 339.
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

    // 2b. Energie — usages equipements enregistres sur le plan (four, petrin, cellule...)
    // duree × cout horaire fige a l'enregistrement (cout_horaire_snapshot). Un usage
    // sans duree (fin non saisie) ne coute rien : il apparait avec 0 pour etre visible.
    const energieResult = await db.query(
      `SELECT pe.id as equipement_id, pe.nom as name,
              SUM(COALESCE(peu.duree_minutes, 0)) as minutes,
              MAX(COALESCE(peu.cout_horaire_snapshot, pe.cout_horaire, 0)) as cout_horaire,
              ROUND(SUM(COALESCE(peu.duree_minutes, 0) * COALESCE(peu.cout_horaire_snapshot, pe.cout_horaire, 0)) / 60.0, 2) as total
       FROM production_equipement_usage peu
       JOIN production_equipements pe ON pe.id = peu.equipement_id
       WHERE peu.plan_id = $1
       GROUP BY pe.id, pe.nom
       ORDER BY total DESC`,
      [planId]
    );
    const detailEnergie = energieResult.rows.map(r => ({
      equipement_id: r.equipement_id, name: r.name,
      minutes: parseInt(r.minutes), cout_horaire: parseFloat(r.cout_horaire),
      total: parseFloat(r.total),
    }));
    const coutEnergie = Math.round(detailEnergie.reduce((s, d) => s + d.total, 0) * 100) / 100;

    // 2c. Pertes — pertes_detail du rendement, valorisees au cout matiere unitaire
    // de l'item (snapshot theo_cout_matiere_u, mig 261 ; repli : cout matiere du
    // plan / unites produites). Agrege par categorie (pertes_cuisson, casse...).
    const pertesResult = await db.query(
      `SELECT pr.pertes_detail, ppi.theo_cout_matiere_u
       FROM production_rendement pr
       JOIN production_plan_items ppi ON ppi.id = pr.plan_item_id
       WHERE pr.plan_id = $1`,
      [planId]
    );
    const unitesProduitesResult = await db.query(
      `SELECT COALESCE(SUM(actual_quantity), 0) as total FROM production_plan_items
       WHERE plan_id = $1 AND status != 'cancelled'`,
      [planId]
    );
    const unitesProduites = parseFloat(unitesProduitesResult.rows[0]?.total) || 0;
    const coutMatiereUnitaireRepli = unitesProduites > 0 ? coutMatieres / unitesProduites : 0;
    const pertesParCategorie = new Map<string, { quantite: number; total: number }>();
    for (const r of pertesResult.rows) {
      const cu = r.theo_cout_matiere_u != null ? parseFloat(r.theo_cout_matiere_u) : coutMatiereUnitaireRepli;
      const details: { categorie?: string; quantite?: number | string }[] = Array.isArray(r.pertes_detail) ? r.pertes_detail : [];
      for (const p of details) {
        const q = parseFloat(String(p.quantite ?? 0)) || 0;
        if (q <= 0) continue;
        const cat = p.categorie || 'autres';
        const agg = pertesParCategorie.get(cat) || { quantite: 0, total: 0 };
        agg.quantite += q;
        agg.total += q * cu;
        pertesParCategorie.set(cat, agg);
      }
    }
    const detailPertes = Array.from(pertesParCategorie, ([categorie, a]) => ({
      categorie, quantite: a.quantite,
      cout_unitaire: a.quantite > 0 ? Math.round(a.total / a.quantite * 100) / 100 : 0,
      total: Math.round(a.total * 100) / 100,
    }));
    const coutPertes = Math.round(detailPertes.reduce((s, d) => s + d.total, 0) * 100) / 100;

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

    // Cout prevu (mig 261, audit A6b + mig 268, audit A10). Deux totaux :
    //   - prevu           = SUM(theo × planned_quantity)   [mix standard]
    //   - prevu_mix_reel  = SUM(theo × actual_quantity)    [meme prix theorique
    //     mais applique au mix effectivement produit ; actual NULL -> planned]
    // ecart_mix = prevu - prevu_mix_reel isole l'effet du changement de mix.
    // Le reste (cout_total - prevu_mix_reel) est un ecart prix + pertes.
    // Repli legacy identique a la mig 261 pour les items sans snapshot.
    const prevuResult = await db.query(
      `SELECT
         SUM(
           CASE
             WHEN ppi.theo_snapshot_at IS NOT NULL AND ppi.theo_cout_complet_u IS NOT NULL
               THEN ppi.theo_cout_complet_u * ppi.planned_quantity
             WHEN r.yield_quantity > 0
               THEN COALESCE(vtc.total_cost, 0) * ppi.planned_quantity / r.yield_quantity
             ELSE 0
           END
         ) AS total_prevu,
         SUM(
           CASE
             WHEN ppi.theo_snapshot_at IS NOT NULL AND ppi.theo_cout_complet_u IS NOT NULL
               THEN ppi.theo_cout_complet_u * COALESCE(ppi.actual_quantity, ppi.planned_quantity)
             WHEN r.yield_quantity > 0
               THEN COALESCE(vtc.total_cost, 0) * COALESCE(ppi.actual_quantity, ppi.planned_quantity) / r.yield_quantity
             ELSE 0
           END
         ) AS total_prevu_mix_reel
       FROM production_plan_items ppi
       LEFT JOIN recipes r ON r.product_id = ppi.product_id
       LEFT JOIN v_recipe_total_cost vtc ON vtc.id = r.id
       WHERE ppi.plan_id = $1 AND ppi.status != 'cancelled'`,
      [planId]
    );
    const coutPrevu = parseFloat(prevuResult.rows[0]?.total_prevu) || null;
    const coutPrevuMixReel = parseFloat(prevuResult.rows[0]?.total_prevu_mix_reel) || null;
    const ecartMix = coutPrevu != null && coutPrevuMixReel != null
      ? Math.round((coutPrevu - coutPrevuMixReel) * 100) / 100
      : null;
    // Revient = matieres + MO + energie + charges (les pertes sont un « dont »).
    const coutTotal = coutMatieres + coutMO + coutEnergie + coutCharges;
    const ecartPct = coutPrevu && coutPrevu > 0
      ? Math.round((coutTotal - coutPrevu) / coutPrevu * 10000) / 100
      : null;

    // Upsert (mig 268 : + cout_prevu_mix_reel, ecart_mix ; mig 339 : energie/pertes reels)
    const result = await db.query(
      `INSERT INTO production_cout_reel
       (plan_id, cout_matieres, cout_main_oeuvre, cout_energie, cout_pertes,
        cout_charges_fixes, detail_charges_fixes,
        cout_prevu, ecart_pct, cout_prevu_mix_reel, ecart_mix,
        detail_matieres, detail_main_oeuvre, detail_energie, detail_pertes,
        calculated_by, calculated_at)
       VALUES ($1, $2, $3, $13, $14, $4, $5, $6, $7, $11, $12, $8, $9, $15, $16, $10, NOW())
       ON CONFLICT (plan_id)
       DO UPDATE SET
         cout_matieres = EXCLUDED.cout_matieres,
         cout_main_oeuvre = EXCLUDED.cout_main_oeuvre,
         cout_energie = EXCLUDED.cout_energie,
         cout_pertes = EXCLUDED.cout_pertes,
         cout_charges_fixes = EXCLUDED.cout_charges_fixes,
         detail_charges_fixes = EXCLUDED.detail_charges_fixes,
         cout_prevu = EXCLUDED.cout_prevu,
         ecart_pct = EXCLUDED.ecart_pct,
         cout_prevu_mix_reel = EXCLUDED.cout_prevu_mix_reel,
         ecart_mix = EXCLUDED.ecart_mix,
         detail_matieres = EXCLUDED.detail_matieres,
         detail_main_oeuvre = EXCLUDED.detail_main_oeuvre,
         detail_energie = EXCLUDED.detail_energie,
         detail_pertes = EXCLUDED.detail_pertes,
         calculated_by = EXCLUDED.calculated_by,
         calculated_at = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [planId, coutMatieres, coutMO, coutCharges,
       JSON.stringify(detailCharges), coutPrevu, ecartPct,
       JSON.stringify(detailMatieres), JSON.stringify(detailMO),
       userId,
       coutPrevuMixReel, ecartMix,
       coutEnergie, coutPertes,
       JSON.stringify(detailEnergie), JSON.stringify(detailPertes)]
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

  // ═══════════════════════════════════════════════════════════════════════════
  // Ecart MO : standard (gamme mig 388) vs reel (etapes mig 089) — roadmap lot 1
  // ═══════════════════════════════════════════════════════════════════════════

  // Detail par item d'un plan + totaux (sur les seuls items ayant une gamme,
  // sinon std est NULL et non sommable).
  async getMoEcartByPlan(planId: string) {
    const result = await db.query(
      `SELECT me.*, p.name AS product_name,
              COALESCE(ppi.actual_quantity, ppi.planned_quantity) AS quantity,
              rt.name AS routing_name
       FROM v_production_mo_ecart me
       JOIN production_plan_items ppi ON ppi.id = me.plan_item_id
       JOIN products p ON p.id = me.product_id
       LEFT JOIN routings rt ON rt.id = me.routing_id
       WHERE me.plan_id = $1 AND ppi.status != 'cancelled'
       ORDER BY p.name`,
      [planId]
    );
    const items = result.rows.map(r => ({
      plan_item_id: r.plan_item_id,
      product_id: r.product_id,
      product_name: r.product_name,
      quantity: r.quantity != null ? parseInt(r.quantity) : null,
      routing_id: r.routing_id,
      routing_name: r.routing_name,
      std_minutes: r.std_minutes != null ? parseInt(r.std_minutes) : null,
      std_cost: r.std_cost != null ? parseFloat(r.std_cost) : null,
      reel_minutes: parseInt(r.reel_minutes),
      reel_cost: parseFloat(r.reel_cost),
      ecart_minutes: r.ecart_minutes != null ? parseInt(r.ecart_minutes) : null,
      ecart_cost: r.ecart_cost != null ? parseFloat(r.ecart_cost) : null,
    }));
    const withStd = items.filter(i => i.std_cost != null);
    const stdMinutes = withStd.reduce((s, i) => s + (i.std_minutes ?? 0), 0);
    const stdCost = Math.round(withStd.reduce((s, i) => s + (i.std_cost ?? 0), 0) * 100) / 100;
    const reelMinutes = withStd.reduce((s, i) => s + i.reel_minutes, 0);
    const reelCost = Math.round(withStd.reduce((s, i) => s + i.reel_cost, 0) * 100) / 100;
    const totals = {
      std_minutes: stdMinutes,
      std_cost: stdCost,
      reel_minutes: reelMinutes,
      reel_cost: reelCost,
      ecart_minutes: reelMinutes - stdMinutes,
      ecart_cost: Math.round((reelCost - stdCost) * 100) / 100,
      nb_items: items.length,
      nb_items_sans_gamme: items.length - withStd.length,
    };
    return { items, totals };
  },

  // Agrege par produit sur une periode (plans completes d'un magasin), trie par
  // ecart decroissant. Ne garde que les produits ayant au moins une gamme.
  async getMoEcartByProduct(storeId: string, dateFrom?: string, dateTo?: string) {
    const params: unknown[] = [storeId];
    let dateFilter = '';
    if (dateFrom) { params.push(dateFrom); dateFilter += ` AND pp.plan_date >= $${params.length}`; }
    if (dateTo) { params.push(dateTo); dateFilter += ` AND pp.plan_date <= $${params.length}`; }

    const result = await db.query(
      `SELECT me.product_id, p.name AS product_name,
              COUNT(*) FILTER (WHERE me.std_cost IS NOT NULL) AS nb_avec_gamme,
              SUM(me.std_minutes) AS std_minutes,
              ROUND(SUM(me.std_cost), 2) AS std_cost,
              SUM(me.reel_minutes) FILTER (WHERE me.std_cost IS NOT NULL) AS reel_minutes,
              ROUND(SUM(me.reel_cost) FILTER (WHERE me.std_cost IS NOT NULL), 2) AS reel_cost
       FROM v_production_mo_ecart me
       JOIN production_plans pp ON pp.id = me.plan_id
       JOIN products p ON p.id = me.product_id
       WHERE pp.store_id = $1 AND pp.status = 'completed'${dateFilter}
       GROUP BY me.product_id, p.name
       HAVING SUM(me.std_cost) IS NOT NULL
       ORDER BY ROUND(SUM(me.reel_cost - me.std_cost), 2) DESC NULLS LAST`,
      params
    );
    return result.rows.map(r => {
      const stdCost = r.std_cost != null ? parseFloat(r.std_cost) : 0;
      const reelCost = r.reel_cost != null ? parseFloat(r.reel_cost) : 0;
      return {
        product_id: r.product_id,
        product_name: r.product_name,
        nb_avec_gamme: parseInt(r.nb_avec_gamme),
        std_minutes: r.std_minutes != null ? parseInt(r.std_minutes) : 0,
        std_cost: stdCost,
        reel_minutes: r.reel_minutes != null ? parseInt(r.reel_minutes) : 0,
        reel_cost: reelCost,
        ecart_cost: Math.round((reelCost - stdCost) * 100) / 100,
      };
    });
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Cout de revient par sortie de coupe (mig 302/397) — roadmap lot 2
  // ═══════════════════════════════════════════════════════════════════════════

  // Regroupe les sorties par article de plan, avec cout alloue par sortie.
  async getOutputCostByPlan(planId: string) {
    const result = await db.query(
      `SELECT oc.output_id, oc.plan_item_id, oc.label, oc.quantity, oc.equiv_pieces,
              oc.unit_cost, oc.cost_share,
              p.name  AS output_product_name,
              ip.name AS item_product_name
       FROM v_production_output_cost oc
       JOIN production_plan_items ppi ON ppi.id = oc.plan_item_id
       LEFT JOIN products p  ON p.id  = oc.product_id
       LEFT JOIN products ip ON ip.id = ppi.product_id
       WHERE oc.plan_id = $1
       ORDER BY ip.name, oc.label`,
      [planId]
    );
    type OutputLine = {
      output_id: string; label: string; product_name: string | null;
      quantity: number; equiv_pieces: number;
      unit_cost: number | null; cost_share: number | null;
    };
    type OutputGroup = {
      plan_item_id: string;
      item_product_name: string | null;
      outputs: OutputLine[];
      total_cost: number;
      complete: boolean;
    };
    const groups = new Map<string, OutputGroup>();
    for (const row of result.rows) {
      const g: OutputGroup = groups.get(row.plan_item_id) ?? {
        plan_item_id: row.plan_item_id,
        item_product_name: row.item_product_name,
        outputs: [],
        total_cost: 0,
        complete: true,
      };
      const costShare = row.cost_share != null ? parseFloat(row.cost_share) : null;
      g.outputs.push({
        output_id: String(row.output_id),
        label: row.label,
        product_name: row.output_product_name,
        quantity: parseFloat(row.quantity),
        equiv_pieces: parseFloat(row.equiv_pieces),
        unit_cost: row.unit_cost != null ? parseFloat(row.unit_cost) : null,
        cost_share: costShare,
      });
      if (costShare != null) g.total_cost += costShare;
      else g.complete = false; // au moins une sortie sans coût (pas de snapshot ni recette)
      groups.set(row.plan_item_id, g);
    }
    return Array.from(groups.values()).map(g => ({
      ...g,
      total_cost: Math.round(g.total_cost * 100) / 100,
    }));
  },
};
