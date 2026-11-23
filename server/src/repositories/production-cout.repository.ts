import { policyNumber, resolvePolicy } from '../services/policies.js';
import { subcontractingRepository } from './subcontracting.repository.js';
import { db, withTransaction } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { imputePlan, chargedHourlyRates, standardCost, type PlanImputation } from '../services/cost-engine.js';
import { planItemCosts, itemHours, spread, type ItemCost } from '../services/plan-item-costs.js';


/**
 * M1-03 — heures légales par mois : celles de la paie (payroll_settings, 191 h par défaut),
 * et non plus un nombre recopié ici. Un seul réglage : Personnel › Paramètres de paie.
 */
const MONTHLY_HOURS_SQL = `COALESCE((SELECT NULLIF(monthly_legal_hours, 0) FROM payroll_settings WHERE id = 1), 191)`;
async function monthlyLegalHours(): Promise<number> {
  return Number((await db.query(`SELECT ${MONTHLY_HOURS_SQL} AS h`)).rows[0].h);
}

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
    // M1-03 : sans prix saisi, la politique « Prix du kWh » (établissement, puis société).
    const coutKwh = data.cout_kwh || await policyNumber('production.kwh_price', 'price', { storeId: data.store_id ?? null });
    const result = await db.query(
      `INSERT INTO production_equipements (nom, type, cout_horaire, puissance_kw, cout_kwh, notes, store_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [data.nom, data.type, data.cout_horaire, data.puissance_kw || null,
       coutKwh, data.notes || null, data.store_id || null]
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
    const rate = emp?.hourly_rate ?? (emp?.monthly_salary ? Math.round(emp.monthly_salary / (await monthlyLegalHours()) * 100) / 100 : null);

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
  // Charges fixes = taux forfaitaire sur matieres (politique production.fixed_charges_rate)
  // Pertes = valorisation des pertes du rendement au cout matiere unitaire :
  //   un « dont » informatif, PAS un terme additif (la matiere perdue est deja
  //   dans cout_matieres — l'additionner la compterait deux fois). Cf. mig 339.
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Coût de revient d'un plan, détaillé (G0-23) : matières, emballages, main-d'œuvre,
   * énergie, charges indirectes. SEULE fonction qui le calcule ; le tableau de bord, la
   * fiche du plan et les rapports lisent ce qu'elle a enregistré (cout_total). N'écrit rien.
   */
  async computePlanCost(planId: string) {
    // 1. Cout matieres — FIFO reel via production_lot_usage, fallback inventory_transactions
    const lotUsageResult = await db.query(
      `SELECT plu.ingredient_id, i.name,
              SUM(plu.quantity_used) as qty,
              SUM(plu.quantity_used * COALESCE(plu.unit_cost_at_use, il.unit_cost, 0)) as total,
              CASE WHEN SUM(plu.quantity_used) > 0
                   THEN SUM(plu.quantity_used * COALESCE(plu.unit_cost_at_use, il.unit_cost, 0)) / SUM(plu.quantity_used)
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
    // Semi-finis consommés (bases : pâte feuilletée, crème pâtissière…) : un lot vaut le coût de
    // production de son plan ÷ quantité produite ; plan non chiffré : coût de la fiche par unité
    // de rendement. Sans cela, un croissant ne portait que ses ingrédients directs.
    const semiResult = await db.query(
      `SELECT l.recipe_id, r.name, l.unit, SUM(u.quantity)::float8 AS qty,
              COALESCE(MAX(src.unit_cost), MAX(v.total_cost / NULLIF(r.yield_quantity, 0)), 0)::float8 AS unit_cost,
              BOOL_OR(src.unit_cost IS NOT NULL) AS from_plan
         FROM semi_finished_lot_usage u
         JOIN semi_finished_lots l ON l.id = u.semi_finished_lot_id
         JOIN recipes r ON r.id = l.recipe_id
         LEFT JOIN v_recipe_total_cost_v2 v ON v.id = r.id
         LEFT JOIN LATERAL (
           SELECT pcr.cout_production / NULLIF((SELECT SUM(l2.quantity_produced) FROM semi_finished_lots l2
                                                 WHERE l2.production_plan_id = l.production_plan_id), 0) AS unit_cost
             FROM production_cout_reel pcr WHERE pcr.plan_id = l.production_plan_id AND pcr.cout_production > 0
         ) src ON true
        WHERE u.parent_plan_id = $1 AND u.released_at IS NULL
        GROUP BY l.recipe_id, r.name, l.unit`, [planId]);
    let coutSemiFinis = 0;
    for (const r of semiResult.rows) {
      const qty = Number(r.qty) || 0, unit = Number(r.unit_cost) || 0;
      if (!(qty > 0)) continue;
      const total = Math.round(qty * unit * 100) / 100;
      coutSemiFinis += total;
      detailMatieres.push({ ingredient_id: `semi:${r.recipe_id}`, name: `${r.name} (semi-fini${r.from_plan ? '' : ', coût fiche'})`,
        qty, unit_cost: Math.round(unit * 10000) / 10000, total });
    }
    const coutMatieres = detailMatieres.reduce((s, d) => s + d.total, 0);

    // 1b. Emballages (G0-23) — sorties d'emballage rattachees au plan, qu'elles viennent
    // du bon de sortie (prelevement) ou de la declaration de production, au cout fige
    // sur le mouvement (repli : cout catalogue).
    const emballagesResult = await db.query(
      `SELECT t.packaging_id, pi.name, pi.unit,
              SUM(-t.quantity_change) AS qty,
              ROUND(SUM(-t.quantity_change * COALESCE(t.unit_cost, pi.unit_cost, 0)), 2) AS total
         FROM packaging_stock_transactions t
         JOIN packaging_items pi ON pi.id = t.packaging_id
        WHERE t.reference_type = 'production_plan' AND t.reference_id = $1 AND t.type = 'consumption'
        GROUP BY t.packaging_id, pi.name, pi.unit
       HAVING SUM(-t.quantity_change) > 0
        ORDER BY pi.name`,
      [planId]
    );
    const detailEmballages = emballagesResult.rows.map(r => {
      const qty = parseFloat(r.qty), total = parseFloat(r.total);
      return { packaging_id: r.packaging_id as string, name: r.name as string, unit: r.unit as string | null,
        qty, unit_cost: qty > 0 ? Math.round(total / qty * 10000) / 10000 : 0, total };
    });
    let coutEmballages = Math.round(detailEmballages.reduce((s, d) => s + d.total, 0) * 100) / 100;

    // 2. Cout main d'oeuvre — depuis production_item_etapes
    // Chaque etape completee a un completed_by (user) et duree_reelle_min.
    // Taux horaire = salaire mensuel / heures légales du mois (réglage de la paie)
    const moResult = await db.query(
      `SELECT e.id as employee_id, e.first_name || ' ' || e.last_name as name,
              SUM(pie.duree_reelle_min) as total_minutes,
              COALESCE(e.hourly_rate, ROUND(e.monthly_salary / ${MONTHLY_HOURS_SQL}, 2)) as hourly_rate,
              ROUND(SUM(pie.duree_reelle_min) * COALESCE(e.hourly_rate, ROUND(e.monthly_salary / ${MONTHLY_HOURS_SQL}, 2)) / 60.0, 2) as total
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
    let coutMO = detailMO.reduce((s, d) => s + d.total, 0);

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
    let coutEnergie = Math.round(detailEnergie.reduce((s, d) => s + d.total, 0) * 100) / 100;

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
    let coutPertes = Math.round(detailPertes.reduce((s, d) => s + d.total, 0) * 100) / 100;

    // 3. Charges fixes = taux paramétrable (mig 403, repli constante) × cout matieres
    //    ou, si le gerant l'a choisi (G0-23), charges mensuelles saisies (loyer, energie,
    //    autres) reparties au prorata des matieres des plans du meme mois et etablissement.
    // 2d. Machine (étape 9 multi-industries) : taux horaire du poste × temps réel des étapes
    //     rattachées à un poste (production_item_etapes.work_center_id). Composante éteinte par
    //     défaut (politique production.cost_components) : coût réel d'Ofauria inchangé.
    const comps = await this.costComponents(planId);
    const machineResult = comps.machine ? await db.query(
      `SELECT wc.id AS work_center_id, wc.name, SUM(pie.duree_reelle_min)::float8 AS minutes,
              wc.hourly_cost::float8 AS hourly_cost,
              ROUND(SUM(pie.duree_reelle_min) * wc.hourly_cost / 60.0, 2)::float8 AS total
         FROM production_item_etapes pie
         JOIN production_plan_items ppi ON ppi.id = pie.plan_item_id
         JOIN work_centers wc ON wc.id = pie.work_center_id
        WHERE ppi.plan_id = $1 AND pie.status = 'completed' AND pie.duree_reelle_min IS NOT NULL
        GROUP BY wc.id, wc.name, wc.hourly_cost ORDER BY total DESC`, [planId]) : { rows: [] };
    const detailMachine = machineResult.rows.map(r => ({ work_center_id: r.work_center_id, name: r.name, minutes: r.minutes, hourly_cost: r.hourly_cost, total: r.total }));
    const coutMachine = Math.round(detailMachine.reduce((t, d) => t + d.total, 0) * 100) / 100;

    const charges = await this.chargesSettings(planId);
    let coutCharges: number;
    const detailCharges: { label: string; taux: number; base: number; part: number }[] = [];
    let analytic: PlanImputation | null = null;
    const moTimedByItem = new Map<string, number>(), moStdByItem = new Map<string, number>(), machineByItem = new Map<string, number>();
    if (charges.method === 'analytic') {
      // Mig 655 : MO directe pointée au coût employeur (brut + charges patronales) ÷ heures légales.
      const rates = await chargedHourlyRates(planId);
      for (const d of detailMO) {
        const rate = rates.byEmployee.get(d.employee_id);
        if (rate != null && rate > 0) { d.hourly_rate = rate; d.total = Math.round(d.minutes * rate / 60 * 100) / 100; }
      }
      const timedRows = (await db.query(
        `SELECT pie.plan_item_id, e.id AS employee_id, SUM(pie.duree_reelle_min)::float8 AS minutes
           FROM production_item_etapes pie
           JOIN production_plan_items ppi ON ppi.id = pie.plan_item_id
           JOIN employees e ON e.user_id = pie.completed_by
          WHERE ppi.plan_id = $1 AND pie.status = 'completed' AND pie.duree_reelle_min IS NOT NULL
          GROUP BY pie.plan_item_id, e.id`, [planId])).rows;
      for (const t of timedRows) {
        const rate = rates.byEmployee.get(t.employee_id) ?? 0;
        moTimedByItem.set(t.plan_item_id, (moTimedByItem.get(t.plan_item_id) ?? 0) + t.minutes / 60 * rate);
      }
      // Lot B (mig 657) : lignes sans pointage → temps standard de la gamme × taux chargé moyen de la MO directe.
      const hrs = await itemHours(planId);
      let stdMinutes = 0;
      for (const [itemId, h] of hrs) {
        if (h.stdLabour > 0 && rates.directRate > 0) {
          moStdByItem.set(itemId, Math.round(h.stdLabour * rates.directRate * 100) / 100);
          stdMinutes += h.stdLabour * 60;
        }
      }
      if (stdMinutes > 0) {
        const total = Math.round([...moStdByItem.values()].reduce((a, b) => a + b, 0) * 100) / 100;
        detailMO.push({ employee_id: 'standard', name: 'Temps standard des gammes (lignes non pointées)',
          minutes: Math.round(stdMinutes), hourly_rate: Math.round(rates.directRate * 100) / 100, total });
      }
      coutMO = detailMO.reduce((s, d) => s + d.total, 0);
      if (comps.machine) {
        const mrows = (await db.query(
          `SELECT pie.plan_item_id, SUM(pie.duree_reelle_min * wc.hourly_cost / 60.0)::float8 AS total
             FROM production_item_etapes pie
             JOIN production_plan_items ppi ON ppi.id = pie.plan_item_id
             JOIN work_centers wc ON wc.id = pie.work_center_id
            WHERE ppi.plan_id = $1 AND pie.status = 'completed' AND pie.duree_reelle_min IS NOT NULL
            GROUP BY pie.plan_item_id`, [planId])).rows;
        for (const m of mrows) machineByItem.set(m.plan_item_id, m.total);
      }
      coutCharges = 0; // calculé plus bas, une fois les composantes directes connues
    } else if (charges.method === 'monthly') {
      const month = await this.monthMaterials(planId);
      const base = month.others + coutMatieres;
      const share = base > 0 ? coutMatieres / base : 0;
      coutCharges = Math.round(charges.monthly * share * 100) / 100;
      if (coutCharges > 0) {
        detailCharges.push({ label: 'Charges mensuelles réparties (prorata des matières du mois)', taux: Math.round(share * 10000) / 10000, base: charges.monthly, part: coutCharges });
      }
    } else {
      coutCharges = Math.round(coutMatieres * charges.rate * 100) / 100;
      if (coutCharges > 0) {
        detailCharges.push({ label: 'Charges fixes estimees', taux: charges.rate, base: coutMatieres, part: coutCharges });
      }
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
         SUM(COALESCE(CASE WHEN ppi.theo_snapshot_at IS NOT NULL THEN ppi.theo_cout_complet_u END, t.complet_u, 0)
             * ppi.planned_quantity) AS total_prevu,
         SUM(COALESCE(CASE WHEN ppi.theo_snapshot_at IS NOT NULL THEN ppi.theo_cout_complet_u END, t.complet_u, 0)
             * COALESCE(ppi.actual_quantity, ppi.planned_quantity)) AS total_prevu_mix_reel
       FROM production_plan_items ppi
       -- Mig 656 : sans coût figé, le coût théorique par le format de la fiche (fn_plan_item_theo).
       LEFT JOIN LATERAL fn_plan_item_theo(ppi.id) t ON ppi.theo_snapshot_at IS NULL OR ppi.theo_cout_complet_u IS NULL
       WHERE ppi.plan_id = $1 AND ppi.status != 'cancelled'`,
      [planId]
    );
    let coutPrevu = parseFloat(prevuResult.rows[0]?.total_prevu) || null;
    let coutPrevuMixReel = parseFloat(prevuResult.rows[0]?.total_prevu_mix_reel) || null;
    let ecartMix = coutPrevu != null && coutPrevuMixReel != null
      ? Math.round((coutPrevu - coutPrevuMixReel) * 100) / 100
      : null;
    // M9 : façon du sous-traitant (prix unitaire × quantité reçue), 0 hors sous-traitance.
    const facon = comps.sous_traitance ? await subcontractingRepository.feeCost(planId) : { amount: 0, detail: null };
    const coutSousTraitance = facon.amount;
    const detailSousTraitance = facon.detail;
    // Étape 9 : une composante éteinte vaut zéro (son détail est vidé).
    if (!comps.emballage) { coutEmballages = 0; detailEmballages.length = 0; }
    if (!comps.main_oeuvre) { coutMO = 0; detailMO.length = 0; }
    if (!comps.energie) { coutEnergie = 0; detailEnergie.length = 0; }
    if (!comps.pertes) { coutPertes = 0; detailPertes.length = 0; }
    if (charges.method === 'analytic' && comps.charges) {
      // Mig 655 : charges imputées par le moteur analytique (centres, capacité normale).
      analytic = await imputePlan(planId, {
        matieres: coutMatieres, matieresAchat: coutMatieres - coutSemiFinis, emballages: coutEmballages, mainOeuvre: coutMO, energie: coutEnergie,
        machine: coutMachine, sousTraitance: coutSousTraitance, prevu: coutPrevu,
      });
      coutCharges = analytic.total;
      for (const l of analytic.lines) {
        detailCharges.push({ label: `${l.name} — ${l.driverLabel}`, taux: Math.round((l.rateFixed + l.rateVariable) * 10000) / 10000, base: l.quantity, part: l.total });
      }
      for (const l of analytic.directLines) {
        detailCharges.push({ label: `${l.label} (charge directe — ${l.productName})`, taux: l.rate, base: l.quantity, part: l.total });
      }
    }
    if (!comps.charges) { coutCharges = 0; detailCharges.length = 0; analytic = null; }
    // Revient = matieres + emballages + MO + energie + charges + façon (les pertes sont un « dont »).
    // Meme somme que la colonne calculee production_cout_reel.cout_total (mig 527, 584).
    const coutTotal = coutMatieres + coutEmballages + coutMO + coutEnergie + coutCharges + coutSousTraitance + coutMachine;
    let ecartPct = coutPrevu && coutPrevu > 0
      ? Math.round((coutTotal - coutPrevu) / coutPrevu * 10000) / 100
      : null;

    type Alloc = { key: string; applied: string; fallback: string | null; source: unknown;
      items: ({ plan_item_id: string; product_name: string; quantity: number; cost: number } & Record<string, unknown>)[] };
    let allocation: Alloc = await this.allocate(planId, coutTotal);
    // Lot A (mig 657) : en mode analytique, chaque article porte son propre coût (matières de sa
    // fiche, charges selon ses unités d'œuvre) ; des parts saisies à la main restent prioritaires.
    let itemCosts: ItemCost[] | null = null;
    let theoNeeds: Map<string, number> | null = null;
    if (analytic && allocation.applied !== 'manuelle') {
      if (!comps.main_oeuvre) { moTimedByItem.clear(); moStdByItem.clear(); }
      const ic = await planItemCosts(planId, {
        detailMatieres, emballages: coutEmballages, energie: coutEnergie, sousTraitance: coutSousTraitance,
        mo: { timedByItem: moTimedByItem, stdByItem: moStdByItem }, machineByItem: comps.machine ? machineByItem : new Map(),
        analytic,
      });
      itemCosts = ic.items;
      theoNeeds = ic.needs;
      const revs = spread(Math.round(coutTotal * 100) / 100, itemCosts.map(i => i.cout_revient));
      const sumRev = itemCosts.reduce((t, i) => t + i.cout_revient, 0);
      const sumProd = itemCosts.reduce((t, i) => t + i.cout_production, 0);
      allocation = {
        key: 'analytique', applied: 'analytique', fallback: null, source: allocation.source,
        items: itemCosts.map((ic, k) => ({
          plan_item_id: ic.plan_item_id, product_name: ic.product_name, quantity: ic.quantity,
          basis: ic.cout_revient,
          share: sumRev > 0 ? Math.round(ic.cout_revient / sumRev * 1e10) / 1e10 : 0,
          production_share: sumProd > 0 ? Math.round(ic.cout_production / sumProd * 1e10) / 1e10 : 0,
          share_pct: sumRev > 0 ? Math.round(ic.cout_revient / sumRev * 100000) / 1000 : 0,
          cost: revs[k], unit_cost: ic.quantity > 0 ? Math.round(revs[k] / ic.quantity * 10000) / 10000 : null,
          manual_pct: null,
        })),
      };
    }
    const niveaux = analytic ? await this.costLevels(planId, {
      matieres: coutMatieres, emballages: coutEmballages, mo: coutMO, energie: coutEnergie, machine: coutMachine,
      sousTraitance: coutSousTraitance, analytic, total: coutTotal, allocation, itemCosts,
    }) : null;
    // Lot E : écart au coût standard (mêmes charges que le réel), décomposé.
    if (niveaux && itemCosts && itemCosts.length) {
      (niveaux as Record<string, unknown>).ecarts = await this.standardVariance(planId, {
        items: itemCosts, needs: theoNeeds ?? new Map(), detailMatieres,
        reel: { matieres: coutMatieres, emballages: coutEmballages, main_oeuvre: coutMO, charges: coutCharges,
                autres: coutEnergie + coutMachine + coutSousTraitance, total: coutTotal },
      });
      // Le prévu enregistré devient le coût standard complet (mêmes charges que le réel) :
      // au mix prévu (quantités planifiées) et au mix réel ; l'écart du bandeau suit.
      const ec = (niveaux as Record<string, unknown>).ecarts as { standard: { total: number }; standard_prevu: number };
      if (ec.standard_prevu > 0) {
        coutPrevu = ec.standard_prevu;
        coutPrevuMixReel = ec.standard.total;
        ecartMix = Math.round((coutPrevu - coutPrevuMixReel) * 100) / 100;
        ecartPct = Math.round((coutTotal - coutPrevu) / coutPrevu * 10000) / 100;
      }
      if (analytic) {
        const standard = { key: 'standard', label: 'Coûts standards (fiches + charges des centres)', total: ec.standard.total,
          note: 'Fiches techniques × quantités produites, temps de gamme et charges des centres du mois : la référence de l\'écart.' };
        analytic.methods = [...analytic.methods.filter(m => m.key !== 'standard'), standard];
      }
    }

    return {
      niveaux, analytic,
      coutChargesAppro: analytic?.appro ?? 0, coutChargesProduction: analytic?.production ?? 0,
      coutChargesStructure: analytic?.structure ?? 0, coutChargesDirectes: analytic?.directes ?? 0,
      coutMatieres, coutEmballages, coutMO, coutEnergie, coutPertes, coutCharges, coutSousTraitance, coutMachine, coutTotal,
      detailSousTraitance, detailMachine, components: comps,
      coutPrevu, coutPrevuMixReel, ecartMix, ecartPct, chargesMethod: charges.method,
      detailMatieres, detailEmballages, detailMO, detailEnergie, detailPertes, detailCharges,
      allocation,
    };
  },

  /** Composantes du coût réel pour l'ordre (politique production.cost_components, étape 9). */
  async costComponents(planId: string) {
    const plan = (await db.query(
      `SELECT p.store_id, p.target_role, (SELECT t.code FROM production_order_types t WHERE t.id = p.order_type_id) AS order_type
         FROM production_plans p WHERE p.id = $1`, [planId])).rows[0];
    const v = (await resolvePolicy<Record<string, boolean>>('production.cost_components',
      plan ? { storeId: plan.store_id, workshop: plan.target_role, orderType: plan.order_type } : {})).value ?? {};
    const on = (k: string, d: boolean) => (typeof v[k] === 'boolean' ? v[k] : d);
    return {
      emballage: on('emballage', true), main_oeuvre: on('main_oeuvre', true), machine: on('machine', false),
      energie: on('energie', true), sous_traitance: on('sous_traitance', true), pertes: on('pertes', true), charges: on('charges', true),
    };
  },

  /**
   * Répartition du coût réel d'un plan entre ses articles (M3-05), selon la politique
   * production.cost_allocation_key du plan (établissement, atelier, type d'ordre) :
   *   poids           — quantité produite × poids unitaire (poids cuit du format, sinon
   *                     poids d'une pièce de la fiche) ; un article sans poids connu fait
   *                     retomber tout le plan sur la quantité (signalé) ;
   *   quantite        — quantité produite (prévue si rien n'est encore produit) ;
   *   valeur_de_vente — quantité × prix de vente ;
   *   manuelle        — parts saisies sur le plan (production_plan_items.cost_share_pct, total 100).
   * La somme des parts réparties égale toujours le coût total.
   */
  async allocate(planId: string, total: number) {
    const plan = (await db.query(
      `SELECT p.store_id, p.target_role, (SELECT t.code FROM production_order_types t WHERE t.id = p.order_type_id) AS order_type
         FROM production_plans p WHERE p.id = $1`, [planId])).rows[0];
    const policy = await resolvePolicy('production.cost_allocation_key',
      plan ? { storeId: plan.store_id, workshop: plan.target_role, orderType: plan.order_type } : {});
    const wanted = String(policy.value.key ?? 'poids') as 'poids' | 'quantite' | 'valeur_de_vente' | 'manuelle';
    const items = (await db.query(
      `SELECT ppi.id, p.name AS product_name,
              COALESCE(ppi.actual_quantity, ppi.planned_quantity)::float8 AS qty,
              COALESCE(rf.poids_cuit_g / 1000.0, r.piece_weight_kg)::float8 AS unit_kg,
              COALESCE(p.price, 0)::float8 AS price, ppi.cost_share_pct::float8 AS share_pct
         FROM production_plan_items ppi
         JOIN products p ON p.id = ppi.product_id
         LEFT JOIN recipe_formats rf ON rf.id = ppi.format_id
         LEFT JOIN recipes r ON r.id = COALESCE(ppi.alt_recipe_id, (SELECT r2.id FROM recipes r2 WHERE r2.product_id = ppi.product_id AND r2.archived_at IS NULL LIMIT 1))
        WHERE ppi.plan_id = $1 AND ppi.status <> 'cancelled'
        ORDER BY p.name`, [planId])).rows as { id: string; product_name: string; qty: number; unit_kg: number | null; price: number; share_pct: number | null }[];
    let key = wanted;
    let fallback: string | null = null;
    if (key === 'poids' && items.some(i => !(i.unit_kg && i.unit_kg > 0))) { key = 'quantite'; fallback = 'Poids unitaire manquant sur un article : répartition à la quantité'; }
    if (key === 'manuelle' && Math.abs(items.reduce((t, i) => t + (i.share_pct ?? 0), 0) - 100) > 0.01) { key = 'quantite'; fallback = 'Parts manuelles absentes ou différentes de 100 % : répartition à la quantité'; }
    if (key === 'valeur_de_vente' && items.reduce((t, i) => t + i.qty * i.price, 0) <= 0) { key = 'quantite'; fallback = 'Aucun prix de vente : répartition à la quantité'; }
    const basis = (i: typeof items[number]) =>
      key === 'poids' ? i.qty * (i.unit_kg ?? 0) : key === 'valeur_de_vente' ? i.qty * i.price : key === 'manuelle' ? (i.share_pct ?? 0) : i.qty;
    const sum = items.reduce((t, i) => t + basis(i), 0);
    const rows = items.map(i => {
      const share = sum > 0 ? basis(i) / sum : items.length ? 1 / items.length : 0;
      return { plan_item_id: i.id, product_name: i.product_name, quantity: i.qty, basis: Math.round(basis(i) * 1000) / 1000,
               // share : part non arrondie, enregistrée (detail_repartition) et lue par les rapports (G0-23).
               share: Math.round(share * 1e10) / 1e10,
               share_pct: Math.round(share * 100000) / 1000, cost: Math.round(total * share * 100) / 100,
               unit_cost: i.qty > 0 ? Math.round(total * share / i.qty * 10000) / 10000 : null, manual_pct: i.share_pct };
    });
    // Arrondis : l'écart de centimes va sur la plus grosse part, la somme égale le total.
    const diff = Math.round((total - rows.reduce((t, r) => t + r.cost, 0)) * 100) / 100;
    if (rows.length && diff !== 0) { const big = rows.reduce((a, b) => (b.cost > a.cost ? b : a)); big.cost = Math.round((big.cost + diff) * 100) / 100; }
    return { key: wanted, applied: key, fallback, source: policy.source, items: rows };
  },

  /** Parts manuelles du plan (clé « manuelle ») : total 100 %, ou toutes retirées. */
  async setCostShares(planId: string, shares: { planItemId: string; pct: number | null }[]) {
    const vals = shares.filter(x => x.pct !== null).map(x => x.pct as number);
    if (vals.length && Math.abs(vals.reduce((t, v) => t + v, 0) - 100) > 0.01) throw new Error('Les parts doivent totaliser 100 %');
    if (vals.length && vals.length !== shares.length) throw new Error('Saisissez la part de chaque article, ou aucune');
    return withTransaction(async () => {
      for (const x of shares) {
        await db.query(`UPDATE production_plan_items SET cost_share_pct = $3 WHERE id = $1 AND plan_id = $2`, [x.planItemId, planId, x.pct]);
      }
      // G0-23 : un plan déjà chiffré garde une répartition enregistrée à jour des parts.
      await this.saveRepartition(planId);
      return { saved: shares.length };
    });
  },

  /**
   * Niveaux de coût d'un plan (mig 655) : coût d'achat, coût de production direct et
   * complet, coût de revient complet, unitaire, prix de vente HT, marge, taux de marge et
   * de marque — au total et par article (répartition du plan).
   */
  async costLevels(planId: string, c: {
    matieres: number; emballages: number; mo: number; energie: number; machine: number; sousTraitance: number;
    analytic: PlanImputation; total: number; allocation: { items: { plan_item_id: string; product_name: string; quantity: number; cost: number }[] };
    itemCosts?: ItemCost[] | null;
  }) {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const a = c.analytic;
    const achat = r2(c.matieres + c.emballages + a.appro);
    const productionDirect = r2(c.matieres + c.emballages + c.mo + c.energie + c.machine + c.sousTraitance + a.directes);
    const productionComplet = r2(productionDirect + a.appro + a.production);
    const revient = r2(productionComplet + a.structure);
    const prices = (await db.query(
      `SELECT ppi.id, COALESCE(ppi.actual_quantity, ppi.planned_quantity)::float8 AS qty,
              (COALESCE(p.price, 0) / CASE WHEN p.price_includes_tax THEN 1 + COALESCE(tc.rate, 0) / 100 ELSE 1 END)::float8 AS price_ht
         FROM production_plan_items ppi
         JOIN products p ON p.id = ppi.product_id
         LEFT JOIN LATERAL (SELECT t.rate FROM tax_codes t WHERE t.code = p.tax_code AND t.valid_from <= CURRENT_DATE
                             ORDER BY t.valid_from DESC LIMIT 1) tc ON true
        WHERE ppi.plan_id = $1 AND ppi.status <> 'cancelled'`, [planId])).rows as { id: string; qty: number; price_ht: number }[];
    const units = prices.reduce((s, p) => s + p.qty, 0);
    const ventes = r2(prices.reduce((s, p) => s + p.qty * p.price_ht, 0));
    const marge = r2(ventes - revient);
    const pct = (n: number, d: number) => (d > 0 ? Math.round(n / d * 10000) / 100 : null);
    const prodShare = revient > 0 ? productionComplet / revient : 0;
    const items = c.itemCosts ? c.itemCosts : c.allocation.items.map(it => {
      const p = prices.find(x => x.id === it.plan_item_id);
      const pv = r2((p?.price_ht ?? 0) * it.quantity);
      const cost = it.cost;
      return {
        plan_item_id: it.plan_item_id, product_name: it.product_name, quantity: it.quantity,
        prix_vente_ht_u: p ? Math.round(p.price_ht * 10000) / 10000 : null,
        cout_production_u: it.quantity > 0 ? Math.round(cost * prodShare / it.quantity * 10000) / 10000 : null,
        cout_revient_u: it.quantity > 0 ? Math.round(cost / it.quantity * 10000) / 10000 : null,
        cout_revient: cost, ventes_ht: pv, marge: r2(pv - cost),
        taux_marge: pct(pv - cost, cost), taux_marque: pct(pv - cost, pv),
      };
    });
    return {
      cout_achat: achat,
      cout_production_direct: productionDirect,
      cout_production_complet: productionComplet,
      cout_revient_complet: revient,
      charges: { approvisionnement: a.appro, production: a.production, structure: a.structure, directes: a.directes },
      unites: units,
      cout_revient_unitaire: units > 0 ? Math.round(revient / units * 10000) / 10000 : null,
      cout_production_unitaire: units > 0 ? Math.round(productionComplet / units * 10000) / 10000 : null,
      ventes_ht: ventes,
      prix_vente_ht_unitaire: units > 0 ? Math.round(ventes / units * 10000) / 10000 : null,
      marge, marge_unitaire: units > 0 ? Math.round(marge / units * 10000) / 10000 : null,
      taux_marge: pct(marge, revient), taux_marque: pct(marge, ventes),
      ecart_total: Math.abs(revient - c.total) < 0.02 ? 0 : r2(revient - c.total),
      items,
    };
  },

  /**
   * Lot E : écart entre le coût réel d'un plan et son coût standard au mix réellement produit
   * (fiches × quantités, charges des centres du mois) : prix des matières, quantités consommées,
   * main-d'œuvre, charges, autres composantes.
   */
  async standardVariance(planId: string, c: {
    items: ItemCost[]; needs: Map<string, number>;
    detailMatieres: { ingredient_id: string; qty: number; unit_cost: number; total: number }[];
    reel: { matieres: number; emballages: number; main_oeuvre: number; charges: number; autres: number; total: number };
  }) {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const plan = (await db.query(`SELECT store_id, to_char(plan_date, 'YYYY-MM') AS month FROM production_plans WHERE id = $1`, [planId])).rows[0];
    const std = { matieres: 0, emballages: 0, main_oeuvre: 0, charges: 0 };
    let missing = 0, stdPrevu = 0;
    const planned = new Map((await db.query(
      `SELECT id, planned_quantity::float8 AS q FROM production_plan_items WHERE plan_id = $1`, [planId])).rows.map(x => [x.id as string, Number(x.q) || 0]));
    for (const it of c.items) {
      if (!it.recipe_id) { missing++; continue; }
      const s = await standardCost(it.recipe_id, { formatId: it.format_id, storeId: plan?.store_id ?? null, month: plan?.month });
      if (!s) { missing++; continue; }
      stdPrevu += (s.matiere + s.emballage + s.mainOeuvre + s.appro + s.production + s.structure) * (planned.get(it.plan_item_id) ?? it.quantity);
      std.matieres += s.matiere * it.quantity;
      std.emballages += s.emballage * it.quantity;
      std.main_oeuvre += s.mainOeuvre * it.quantity;
      std.charges += (s.appro + s.production + s.structure) * it.quantity;
    }
    const stdTotal = std.matieres + std.emballages + std.main_oeuvre + std.charges;
    // Prix : quantités réellement consommées × (prix du lot − prix de la fiche).
    // Matières achetées seulement : un semi-fini (« semi:<fiche> ») n'a pas de prix de fiche matière ;
    // son écart reste dans « quantités consommées ».
    const purchased = c.detailMatieres.filter(d => !d.ingredient_id.startsWith('semi:'));
    const ids = purchased.map(d => d.ingredient_id);
    const fiche = ids.length ? (await db.query(`SELECT id, COALESCE(unit_cost, 0)::float8 AS u FROM ingredients WHERE id = ANY($1::uuid[])`, [ids])).rows : [];
    const prix = purchased.reduce((t, d) => t + d.qty * (d.unit_cost - (fiche.find(f => f.id === d.ingredient_id)?.u ?? d.unit_cost)), 0);
    const ecartMat = c.reel.matieres - std.matieres;
    const lignes = [
      { key: 'prix_matieres', label: 'Prix des matières', detail: 'Quantités consommées × (prix du lot utilisé − prix de la fiche)', montant: r2(prix) },
      { key: 'quantites', label: 'Quantités consommées et rendement', detail: 'Matières sorties au-delà (ou en deçà) de la nomenclature × quantité produite', montant: r2(ecartMat - prix) },
      { key: 'main_oeuvre', label: 'Main-d\'œuvre', detail: 'Temps pointé ou standard comparé au temps de la gamme', montant: r2(c.reel.main_oeuvre - std.main_oeuvre) },
      { key: 'charges', label: 'Charges des centres', detail: 'Unités d\'œuvre réelles comparées à celles des fiches', montant: r2(c.reel.charges - std.charges) },
      { key: 'autres', label: 'Emballages, énergie, machine, façon', detail: 'Mesurés sur le plan, comparés aux emballages des fiches', montant: r2(c.reel.emballages + c.reel.autres - std.emballages) },
    ];
    return {
      standard: { matieres: r2(std.matieres), emballages: r2(std.emballages), main_oeuvre: r2(std.main_oeuvre), charges: r2(std.charges), total: r2(stdTotal) },
      standard_prevu: r2(stdPrevu),
      reel_total: r2(c.reel.total), ecart_total: r2(c.reel.total - stdTotal),
      ecart_pct: stdTotal > 0 ? Math.round((c.reel.total - stdTotal) / stdTotal * 10000) / 100 : null,
      lignes, articles_sans_fiche: missing,
      theoriques: c.needs.size,
    };
  },

  /** Réglage des charges indirectes : taux sur les matières, ou charges mensuelles saisies. */
  async chargesSettings(planId?: string): Promise<{ method: 'rate' | 'monthly' | 'analytic'; rate: number; monthly: number }> {
    const r = (await db.query(
      `SELECT production_charges_method,
              COALESCE(production_charge_loyer, 0) + COALESCE(production_charge_energie, 0) + COALESCE(production_charge_autres, 0) AS monthly
         FROM company_settings WHERE id = 1`)).rows[0];
    // M1-03 : le taux est une politique. Société = réglage « Charges fixes » (colonne lue
    // fraîche) ; un établissement, un atelier ou un type d'ordre peut porter le sien.
    const plan = planId
      ? (await db.query(
          `SELECT p.store_id, p.target_role, (SELECT t.code FROM production_order_types t WHERE t.id = p.order_type_id) AS order_type
             FROM production_plans p WHERE p.id = $1`, [planId])).rows[0]
      : undefined;
    // Niveau « type d'ordre » = code du type d'ordre (M2-01).
    const rate = await policyNumber('production.fixed_charges_rate', 'rate',
      plan ? { storeId: plan.store_id, workshop: plan.target_role, orderType: plan.order_type } : {});
    return {
      method: r?.production_charges_method === 'analytic' ? 'analytic' : r?.production_charges_method === 'monthly' ? 'monthly' : 'rate',
      rate,
      monthly: Number(r?.monthly ?? 0),
    };
  },

  /** Matières des AUTRES plans déjà chiffrés du même mois et du même établissement. */
  async monthMaterials(planId: string): Promise<{ others: number }> {
    const r = await db.query(
      `SELECT COALESCE(SUM(pcr.cout_matieres), 0) AS others
         FROM production_plans me
         JOIN production_plans pp ON pp.store_id IS NOT DISTINCT FROM me.store_id
                                 AND date_trunc('month', pp.plan_date) = date_trunc('month', me.plan_date) AND pp.id <> me.id
         JOIN production_cout_reel pcr ON pcr.plan_id = pp.id
        WHERE me.id = $1`, [planId]);
    return { others: parseFloat(r.rows[0]?.others) || 0 };
  },

  /** Calcule le coût du plan (computePlanCost) et l'enregistre. */
  async calculateAndSave(planId: string, userId: string) {
    const c = await this.computePlanCost(planId);
    const { coutMatieres, coutEmballages, coutMO, coutEnergie, coutPertes, coutCharges, coutPrevu, coutPrevuMixReel, ecartMix, ecartPct,
      detailMatieres, detailEmballages, detailMO, detailEnergie, detailPertes, detailCharges, coutSousTraitance, detailSousTraitance,
      coutMachine, detailMachine, coutChargesAppro, coutChargesProduction, coutChargesStructure, coutChargesDirectes, niveaux, analytic } = c;

    // Upsert (mig 268 : + cout_prevu_mix_reel, ecart_mix ; mig 339 : energie/pertes reels ; mig 527 : emballages)
    const result = await db.query(
      `INSERT INTO production_cout_reel
       (plan_id, cout_matieres, cout_main_oeuvre, cout_energie, cout_pertes,
        cout_charges_fixes, detail_charges_fixes,
        cout_prevu, ecart_pct, cout_prevu_mix_reel, ecart_mix,
        detail_matieres, detail_main_oeuvre, detail_energie, detail_pertes,
        calculated_by, calculated_at, cout_emballages, detail_emballages, cout_sous_traitance, detail_sous_traitance,
        cout_machine, detail_machine, cout_charges_appro, cout_charges_production, cout_charges_structure,
        cout_charges_directes, detail_analytique, niveaux, methodes)
       VALUES ($1, $2, $3, $13, $14, $4, $5, $6, $7, $11, $12, $8, $9, $15, $16, $10, NOW(), $17, $18, $19, $20, $21, $22,
               $23, $24, $25, $26, $27, $28, $29)
       ON CONFLICT (plan_id)
       DO UPDATE SET
         cout_charges_appro = EXCLUDED.cout_charges_appro,
         cout_charges_production = EXCLUDED.cout_charges_production,
         cout_charges_structure = EXCLUDED.cout_charges_structure,
         cout_charges_directes = EXCLUDED.cout_charges_directes,
         detail_analytique = EXCLUDED.detail_analytique,
         niveaux = EXCLUDED.niveaux,
         methodes = EXCLUDED.methodes,
         cout_machine = EXCLUDED.cout_machine,
         detail_machine = EXCLUDED.detail_machine,
         cout_emballages = EXCLUDED.cout_emballages,
         cout_sous_traitance = EXCLUDED.cout_sous_traitance,
         detail_sous_traitance = EXCLUDED.detail_sous_traitance,
         detail_emballages = EXCLUDED.detail_emballages,
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
       JSON.stringify(detailEnergie), JSON.stringify(detailPertes),
       coutEmballages, JSON.stringify(detailEmballages), coutSousTraitance, detailSousTraitance ? JSON.stringify(detailSousTraitance) : null,
       coutMachine, JSON.stringify(detailMachine),
       coutChargesAppro, coutChargesProduction, coutChargesStructure, coutChargesDirectes,
       analytic ? JSON.stringify({ month: analytic.month, drivers: analytic.drivers, lines: analytic.lines, direct: analytic.directLines,
                                    byNature: analytic.byNature, warnings: analytic.warnings }) : null,
       niveaux ? JSON.stringify(niveaux) : null,
       analytic ? JSON.stringify(analytic.methods) : null]
    );
    // Charges mensuelles : ce plan change la base de repartition du mois. Les autres plans
    // du mois sont re-repartis, pour que la somme des parts egale les charges saisies.
    if (c.chargesMethod === 'monthly') await this.respreadMonthlyCharges(planId);
    // G0-23 (mig 598) : la repartition entre articles est enregistree avec le cout ; les
    // rapports de marge et le cout des lots la lisent (v_plan_item_cost_share).
    await this.saveRepartition(planId, c.allocation);
    return (await db.query(`SELECT * FROM production_cout_reel WHERE id = $1`, [result.rows[0].id])).rows[0];
  },

  /**
   * Enregistre la répartition du coût du plan entre ses articles (G0-23, mig 598). Les
   * parts (share) ne dépendent pas du total : une re-répartition des charges mensuelles
   * ne les rend pas fausses. Sans allocation fournie, elle est recalculée (parts manuelles).
   */
  async saveRepartition(planId: string, allocation?: object) {
    const row = (await db.query(`SELECT cout_total FROM production_cout_reel WHERE plan_id = $1`, [planId])).rows[0];
    if (!row) return;
    const alloc = allocation ?? await this.allocate(planId, parseFloat(row.cout_total) || 0);
    await db.query(`UPDATE production_cout_reel SET detail_repartition = $2 WHERE plan_id = $1`, [planId, JSON.stringify(alloc)]);
  },

  /** Re-répartit les charges mensuelles sur tous les plans chiffrés du mois du plan donné. */
  async respreadMonthlyCharges(planId: string) {
    const { monthly } = await this.chargesSettings();
    await db.query(
      `WITH me AS (SELECT store_id, date_trunc('month', plan_date) AS m FROM production_plans WHERE id = $1),
            scope AS (
              SELECT pcr.id, pcr.cout_matieres, SUM(pcr.cout_matieres) OVER () AS tot
                FROM production_cout_reel pcr JOIN production_plans pp ON pp.id = pcr.plan_id, me
               WHERE pp.store_id IS NOT DISTINCT FROM me.store_id AND date_trunc('month', pp.plan_date) = me.m)
       UPDATE production_cout_reel pcr
          SET cout_charges_fixes = CASE WHEN s.tot > 0 THEN ROUND($2::numeric * s.cout_matieres / s.tot, 2) ELSE 0 END,
              detail_charges_fixes = CASE WHEN s.tot > 0 AND s.cout_matieres > 0 THEN jsonb_build_array(jsonb_build_object(
                'label', 'Charges mensuelles réparties (prorata des matières du mois)',
                'taux', ROUND(s.cout_matieres / s.tot, 4), 'base', $2::numeric,
                'part', ROUND($2::numeric * s.cout_matieres / s.tot, 2))) ELSE '[]'::jsonb END,
              updated_at = NOW()
         FROM scope s WHERE s.id = pcr.id`, [planId, monthly]);
    // L'ecart au prevu suit le nouveau total (cout_total est une colonne calculee).
    await db.query(
      `UPDATE production_cout_reel pcr
          SET ecart_pct = CASE WHEN pcr.cout_prevu > 0 THEN ROUND((pcr.cout_total - pcr.cout_prevu) / pcr.cout_prevu * 100, 2) END
         FROM production_plans pp, (SELECT store_id, date_trunc('month', plan_date) AS m FROM production_plans WHERE id = $1) me
        WHERE pp.id = pcr.plan_id AND pp.store_id IS NOT DISTINCT FROM me.store_id AND date_trunc('month', pp.plan_date) = me.m`, [planId]);
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
        logger.error({ err: err }, `Batch calculate failed for plan ${row.id}:`);
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
         COALESCE(pcr.cout_energie, 0) as plan_cout_energie,
         COALESCE(pcr.cout_emballages, 0) as plan_cout_emballages,
         -- G0-23 : le revient est celui de la fiche du plan (colonne calculee cout_total),
         -- energie et emballages compris ; le tableau de bord ne refait plus l'addition.
         COALESCE(pcr.cout_total, 0) as plan_cout_revient,
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
               COALESCE(item_mo.cout_mo_item, 0) as cout_mo_item,
               -- G0-23 : part de l'article dans le coût unifié du plan (mig 598).
               ROUND(pcr.cout_total * item_share.share, 2) as cout_revient_item
             FROM production_plan_items ppi
             JOIN products p ON p.id = ppi.product_id
             LEFT JOIN v_plan_item_cost_share item_share ON item_share.plan_item_id = ppi.id
             LEFT JOIN LATERAL (
               SELECT SUM(plu.quantity_used * COALESCE(plu.unit_cost_at_use, il.unit_cost, 0)) as cout_matieres_item
               FROM production_lot_usage plu
               JOIN ingredient_lots il ON il.id = plu.ingredient_lot_id
               WHERE plu.production_plan_id = pp.id
                 AND plu.ingredient_id IN (
                   -- 2b-1 : matières de la nomenclature (miroir du format par défaut).
                   SELECT rc.source_ingredient_id FROM recipe_components rc
                   WHERE rc.source_ingredient_id IS NOT NULL
                     AND rc.recipe_id = COALESCE(ppi.alt_recipe_id, (SELECT r2.id FROM recipes r2 WHERE r2.product_id = ppi.product_id LIMIT 1))
                 )
             ) item_mat ON true
             LEFT JOIN LATERAL (
               SELECT ROUND(SUM(pie.duree_reelle_min * COALESCE(e.hourly_rate, ROUND(e.monthly_salary / ${MONTHLY_HOURS_SQL}, 2)) / 60.0), 2) as cout_mo_item
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
         SUM(COALESCE(pcr.cout_energie, 0)) as total_energie,
         SUM(COALESCE(pcr.cout_emballages, 0)) as total_emballages,
         SUM(COALESCE(pcr.cout_pertes, 0)) as total_pertes,
         SUM(pcr.cout_total) as total_cout,
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
              SUM(COALESCE(pcr.cout_energie, 0)) as energie,
              SUM(COALESCE(pcr.cout_emballages, 0)) as emballages,
              SUM(pcr.cout_total) as total
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
      // G0-23 : part de chaque article dans le coût unifié du plan (v_plan_item_cost_share,
      // mig 598 : répartition enregistrée par computePlanCost, sinon prorata des quantités).
      // Avant, les matières étaient ré-estimées ici par les ingrédients de la fiche (un
      // ingrédient commun à deux articles du plan comptait deux fois, emballages ignorés).
      `SELECT
         s.product_id,
         p.name as product_name,
         COUNT(DISTINCT pp.id) as nb_plans,
         SUM(s.quantity) as total_quantity,
         ROUND(SUM(pcr.cout_matieres * s.share), 2) as total_matieres,
         ROUND(SUM(pcr.cout_total * s.share), 2) as total_revient,
         ROUND(SUM(pcr.cout_total * s.share) / NULLIF(SUM(s.quantity), 0), 4) as cout_unitaire
       FROM v_plan_item_cost_share s
       JOIN production_plan_items ppi ON ppi.id = s.plan_item_id
       JOIN production_plans pp ON pp.id = s.plan_id
       JOIN products p ON p.id = s.product_id
       JOIN production_cout_reel pcr ON pcr.plan_id = pp.id
       WHERE pp.store_id = $1 AND pp.status = 'completed' AND ppi.status != 'cancelled'${dateFilter}
       GROUP BY s.product_id, p.name
       ORDER BY total_revient DESC`,
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
              oc.unit_cost, oc.cost_share, oc.output_type,
              p.name  AS output_product_name,
              ip.name AS item_product_name
       FROM v_production_output_cost_v2 oc
       JOIN production_plan_items ppi ON ppi.id = oc.plan_item_id
       LEFT JOIN products p  ON p.id  = oc.product_id
       LEFT JOIN products ip ON ip.id = ppi.product_id
       WHERE oc.plan_id = $1
       ORDER BY ip.name, oc.label`,
      [planId]
    );
    type OutputLine = {
      output_id: string; label: string; product_name: string | null;
      quantity: number; equiv_pieces: number; output_type: string;
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
        output_type: row.output_type,
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

  // ═══════════════════════════════════════════════════════════════════════════
  // Charge par poste vs capacite (mig 398) — roadmap lot 3
  // ═══════════════════════════════════════════════════════════════════════════

  // Minutes requises par poste pour un plan + % d'utilisation si capacite connue.
  async getChargeByPlan(planId: string) {
    const result = await db.query(
      `SELECT l.work_center_id, l.work_center_name,
              -- M5-04 : capacité du jour du plan (calendrier du poste, sinon capacité journalière).
              fn_work_center_capacity(l.work_center_id, pp.plan_date) AS capacity_minutes_per_day,
              l.minutes_required
       FROM v_production_work_center_load l
       JOIN production_plans pp ON pp.id = l.plan_id
       WHERE l.plan_id = $1
       ORDER BY l.minutes_required DESC`,
      [planId]
    );
    return result.rows.map(r => {
      const minutes = Math.round(parseFloat(r.minutes_required));
      const capacity = r.capacity_minutes_per_day != null ? parseFloat(r.capacity_minutes_per_day) : null;
      const utilisationPct = capacity && capacity > 0 ? Math.round((minutes / capacity) * 1000) / 10 : null;
      return {
        work_center_id: r.work_center_id,
        work_center_name: r.work_center_name,
        minutes_required: minutes,
        capacity_minutes_per_day: capacity,
        utilisation_pct: utilisationPct,
        overloaded: utilisationPct != null && utilisationPct > 100,
      };
    });
  },
};
