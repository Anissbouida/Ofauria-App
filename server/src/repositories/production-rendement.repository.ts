import { db } from '../config/database.js';

export const productionRendementRepository = {

  // ─── Record yield for a plan item ───
  async record(data: {
    planItemId: string;
    planId: string;
    quantiteBrute: number;
    quantiteNetteCible?: number;
    seuilRendement?: number;
    quantiteNetteReelle: number;
    versMagasin: number;
    versFrigo: number;
    pertesDetail: { categorie: string; quantite: number; notes?: string }[];
    recordedBy: string;
    notes?: string;
  }) {
    const pertesTotal = data.pertesDetail.reduce((sum, p) => sum + p.quantite, 0);
    const rendementReel = data.quantiteBrute > 0
      ? Math.round((data.quantiteNetteReelle / data.quantiteBrute) * 10000) / 100
      : 0;

    const result = await db.query(
      `INSERT INTO production_rendement
       (plan_item_id, plan_id, quantite_brute, quantite_nette_cible, seuil_rendement,
        quantite_nette_reelle, rendement_reel, vers_magasin, vers_frigo,
        pertes_total, pertes_detail, recorded_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (plan_item_id)
       DO UPDATE SET
         quantite_brute = EXCLUDED.quantite_brute,
         quantite_nette_cible = EXCLUDED.quantite_nette_cible,
         seuil_rendement = EXCLUDED.seuil_rendement,
         quantite_nette_reelle = EXCLUDED.quantite_nette_reelle,
         rendement_reel = EXCLUDED.rendement_reel,
         vers_magasin = EXCLUDED.vers_magasin,
         vers_frigo = EXCLUDED.vers_frigo,
         pertes_total = EXCLUDED.pertes_total,
         pertes_detail = EXCLUDED.pertes_detail,
         recorded_by = EXCLUDED.recorded_by,
         notes = EXCLUDED.notes,
         updated_at = NOW()
       RETURNING *`,
      [data.planItemId, data.planId, data.quantiteBrute, data.quantiteNetteCible || null,
       data.seuilRendement || null, data.quantiteNetteReelle, rendementReel,
       data.versMagasin, data.versFrigo, pertesTotal,
       JSON.stringify(data.pertesDetail), data.recordedBy, data.notes || null]
    );
    return result.rows[0];
  },

  // ─── Get rendement for a plan item ───
  async findByPlanItem(planItemId: string) {
    const result = await db.query(
      `SELECT pr.*, u.first_name as recorded_by_name
       FROM production_rendement pr
       LEFT JOIN users u ON u.id = pr.recorded_by
       WHERE pr.plan_item_id = $1`,
      [planItemId]
    );
    return result.rows[0] || null;
  },

  // ─── Get all rendements for a plan ───
  async findByPlan(planId: string) {
    const result = await db.query(
      `SELECT pr.*,
              COALESCE(p.name, r.name) as product_name,
              ppi.planned_quantity, ppi.actual_quantity,
              pc.nom as contenant_nom,
              u.first_name as recorded_by_name
       FROM production_rendement pr
       JOIN production_plan_items ppi ON ppi.id = pr.plan_item_id
       LEFT JOIN products p ON p.id = ppi.product_id
       LEFT JOIN recipes r ON r.id = ppi.base_recipe_id
       LEFT JOIN production_contenants pc ON pc.id = ppi.contenant_id
       LEFT JOIN users u ON u.id = pr.recorded_by
       WHERE pr.plan_id = $1
       ORDER BY pr.recorded_at ASC`,
      [planId]
    );
    return result.rows;
  },

  // ─── Dashboard: rendement stats over a period ───
  async getStats(storeId: string, dateFrom?: string, dateTo?: string) {
    const params: unknown[] = [storeId];
    let dateFilter = '';
    if (dateFrom) {
      params.push(dateFrom);
      dateFilter += ` AND pp.plan_date >= $${params.length}`;
    }
    if (dateTo) {
      params.push(dateTo);
      dateFilter += ` AND pp.plan_date <= $${params.length}`;
    }

    const result = await db.query(
      `SELECT
         COUNT(pr.id) as total_items,
         AVG(pr.rendement_reel) as avg_rendement,
         MIN(pr.rendement_reel) as min_rendement,
         MAX(pr.rendement_reel) as max_rendement,
         SUM(pr.vers_magasin) as total_vers_magasin,
         SUM(pr.vers_frigo) as total_vers_frigo,
         SUM(pr.pertes_total) as total_pertes,
         SUM(pr.quantite_brute) as total_brute,
         SUM(pr.quantite_nette_reelle) as total_nette
       FROM production_rendement pr
       JOIN production_plans pp ON pp.id = pr.plan_id
       WHERE pp.store_id = $1${dateFilter}`,
      params
    );
    return result.rows[0];
  },

  // ─── Rendement by product (for dashboard chart) ───
  async getByProduct(storeId: string, dateFrom?: string, dateTo?: string) {
    const params: unknown[] = [storeId];
    let dateFilter = '';
    if (dateFrom) { params.push(dateFrom); dateFilter += ` AND pp.plan_date >= $${params.length}`; }
    if (dateTo) { params.push(dateTo); dateFilter += ` AND pp.plan_date <= $${params.length}`; }

    const result = await db.query(
      `SELECT
         COALESCE(p.name, r.name) as product_name,
         ppi.product_id,
         COUNT(pr.id) as nb_productions,
         AVG(pr.rendement_reel) as avg_rendement,
         SUM(pr.pertes_total) as total_pertes,
         SUM(pr.vers_magasin) as total_vers_magasin,
         SUM(pr.vers_frigo) as total_vers_frigo
       FROM production_rendement pr
       JOIN production_plan_items ppi ON ppi.id = pr.plan_item_id
       JOIN production_plans pp ON pp.id = pr.plan_id
       LEFT JOIN products p ON p.id = ppi.product_id
       LEFT JOIN recipes r ON r.id = ppi.base_recipe_id
       WHERE pp.store_id = $1${dateFilter}
       GROUP BY p.name, r.name, ppi.product_id
       ORDER BY AVG(pr.rendement_reel) ASC`,
      params
    );
    return result.rows;
  },

  // ─── Get contenant info for rendement target ───
  async getTargetForItem(planItemId: string) {
    const result = await db.query(
      `SELECT ppi.contenant_id, ppi.nb_contenants, ppi.quantite_nette_cible,
              pc.quantite_theorique, pc.pertes_fixes, pc.seuil_rendement_defaut,
              pc.categories_pertes,
              ppp.surcharge_quantite_theorique, ppp.surcharge_pertes_fixes,
              ppp.surcharge_seuil_rendement
       FROM production_plan_items ppi
       LEFT JOIN production_contenants pc ON pc.id = ppi.contenant_id
       LEFT JOIN produit_profil_production ppp ON ppp.produit_id = ppi.product_id
       WHERE ppi.id = $1`,
      [planItemId]
    );
    if (!result.rows[0]) return null;
    const r = result.rows[0];
    return {
      quantiteTheorique: r.surcharge_quantite_theorique ?? r.quantite_theorique ?? 0,
      pertesFixes: r.surcharge_pertes_fixes ?? r.pertes_fixes ?? 0,
      seuilRendement: r.surcharge_seuil_rendement ?? r.seuil_rendement_defaut ?? 90,
      nbContenants: r.nb_contenants ?? 1,
      quantiteNetteCible: r.quantite_nette_cible ?? 0,
      categoriesPertes: r.categories_pertes || [],
    };
  },
};
