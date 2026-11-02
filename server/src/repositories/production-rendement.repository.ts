import { db } from '../config/database.js';

// Freinte STANDARD (épic labo L3) : résolue depuis le format par défaut actif de
// l'article (poids_cru_g → poids_cuit_g, mig 199), pour comparer à la freinte
// réelle mesurée. Fragments SQL partagés par findByPlanItem / findByPlan.
const FREINTE_STD_JOIN = `
  LEFT JOIN LATERAL (
    SELECT rf.poids_cru_g, rf.poids_cuit_g, rf.freinte_par_etape
      FROM recipe_formats rf
      LEFT JOIN recipes rr ON rr.id = rf.recipe_id
     WHERE rf.is_active AND rf.is_default
       AND (rf.product_id = ppi.product_id
            OR rr.product_id = ppi.product_id
            OR rr.id = ppi.base_recipe_id)
     ORDER BY (rf.product_id = ppi.product_id) DESC NULLS LAST
     LIMIT 1
  ) fmt ON true`;
const FREINTE_STD_EXPR = `CASE WHEN fmt.poids_cru_g > 0 AND fmt.poids_cuit_g IS NOT NULL
  THEN ROUND((fmt.poids_cru_g - fmt.poids_cuit_g) / fmt.poids_cru_g * 100, 2) END`;

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
    // Bilan massique (épic labo L3, mig 427) — tous optionnels.
    massePetrieKg?: number | null;
    patonsNombre?: number | null;
    patonsPoidsUnitaireG?: number | null;
    masseCuiteKg?: number | null;
  }) {
    const pertesTotal = data.pertesDetail.reduce((sum, p) => sum + p.quantite, 0);
    const rendementReel = data.quantiteBrute > 0
      ? Math.round((data.quantiteNetteReelle / data.quantiteBrute) * 10000) / 100
      : 0;

    // Freinte réelle (%) = (masse pétrie − masse cuite) / masse pétrie × 100,
    // seulement si les deux masses sont fournies et cohérentes.
    const petrie = data.massePetrieKg ?? null;
    const cuite = data.masseCuiteKg ?? null;
    const freinteReelle = (petrie != null && cuite != null && petrie > 0)
      ? Math.round(((petrie - cuite) / petrie) * 10000) / 100
      : null;

    const result = await db.query(
      `INSERT INTO production_rendement
       (plan_item_id, plan_id, quantite_brute, quantite_nette_cible, seuil_rendement,
        quantite_nette_reelle, rendement_reel, vers_magasin, vers_frigo,
        pertes_total, pertes_detail, recorded_by, notes,
        masse_petrie_kg, patons_nombre, patons_poids_unitaire_g, masse_cuite_kg, freinte_reelle_pct)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
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
         masse_petrie_kg = EXCLUDED.masse_petrie_kg,
         patons_nombre = EXCLUDED.patons_nombre,
         patons_poids_unitaire_g = EXCLUDED.patons_poids_unitaire_g,
         masse_cuite_kg = EXCLUDED.masse_cuite_kg,
         freinte_reelle_pct = EXCLUDED.freinte_reelle_pct,
         updated_at = NOW()
       RETURNING *`,
      [data.planItemId, data.planId, data.quantiteBrute, data.quantiteNetteCible || null,
       data.seuilRendement || null, data.quantiteNetteReelle, rendementReel,
       data.versMagasin, data.versFrigo, pertesTotal,
       JSON.stringify(data.pertesDetail), data.recordedBy, data.notes || null,
       petrie, data.patonsNombre ?? null, data.patonsPoidsUnitaireG ?? null, cuite, freinteReelle]
    );
    return result.rows[0];
  },

  // ─── Get rendement for a plan item ───
  async findByPlanItem(planItemId: string) {
    const result = await db.query(
      `SELECT pr.*, u.first_name as recorded_by_name,
              fmt.poids_cru_g, fmt.poids_cuit_g, fmt.freinte_par_etape,
              ${FREINTE_STD_EXPR} AS freinte_standard_pct
       FROM production_rendement pr
       JOIN production_plan_items ppi ON ppi.id = pr.plan_item_id
       LEFT JOIN users u ON u.id = pr.recorded_by
       ${FREINTE_STD_JOIN}
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
              u.first_name as recorded_by_name,
              fmt.poids_cru_g, fmt.poids_cuit_g, fmt.freinte_par_etape,
              ${FREINTE_STD_EXPR} AS freinte_standard_pct
       FROM production_rendement pr
       JOIN production_plan_items ppi ON ppi.id = pr.plan_item_id
       LEFT JOIN products p ON p.id = ppi.product_id
       LEFT JOIN recipes r ON r.id = ppi.base_recipe_id
       LEFT JOIN production_contenants pc ON pc.id = ppi.contenant_id
       LEFT JOIN users u ON u.id = pr.recorded_by
       ${FREINTE_STD_JOIN}
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
