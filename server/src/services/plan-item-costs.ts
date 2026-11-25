/**
 * Lot A (mig 657) — coût propre de chaque article d'un plan.
 *
 * Matières : la consommation réelle de chaque matière est partagée entre les articles
 * au prorata de leur besoin théorique (nomenclature de leur fiche × quantité produite) ;
 * une matière qu'aucune fiche ne prévoit suit la valeur théorique des matières de
 * l'article. Charges des centres : chaque ligne du plan reçoit coût de l'unité d'œuvre ×
 * ses propres unités d'œuvre (quantité, poids, heures, valeur des matières, valeur de
 * vente). Main-d'œuvre et machine : temps de la ligne (pointé, sinon standard).
 * Emballages, énergie et façon, connus au niveau du plan : au prorata des quantités.
 * La somme des articles égale toujours le coût du plan.
 */
import { db } from '../config/database.js';
import { collectIngredientNeedsForUnits, getCompositionForNeeds } from '../repositories/recipe-composition.helper.js';
import type { PlanImputation, Driver } from './cost-engine.js';

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface ItemCost {
  plan_item_id: string; product_id: string; product_name: string; quantity: number;
  prix_vente_ht_u: number | null;
  matieres: number; emballages: number; main_oeuvre: number; energie: number; machine: number; sous_traitance: number;
  charges_appro: number; charges_production: number; charges_structure: number; charges_directes: number;
  /** Détail des charges de structure (somme = charges_structure). */
  charges_administration: number; charges_distribution: number;
  /** Part de chaque centre dans l'article : quantité d'inducteur de l'article × taux du centre. */
  charges_centres: { code: string; name: string; level: string; driverLabel: string; quantity: number; rate: number; total: number }[];
  cout_production: number; cout_revient: number;
  cout_production_u: number | null; cout_revient_u: number | null;
  ventes_ht: number; marge: number; taux_marge: number | null; taux_marque: number | null;
  labour_hours: number; labour_source: 'pointe' | 'standard' | 'aucun';
  recipe_id: string | null; format_id: string | null;
}

export interface PlanItemCostsInput {
  /** by_item : part mesurée sur les sorties rattachées à chaque article (mig 663). */
  detailMatieres: { ingredient_id: string; total: number; by_item?: Record<string, number> }[];
  emballages: number; energie: number; sousTraitance: number;
  mo: { timedByItem: Map<string, number>; stdByItem: Map<string, number> };
  machineByItem: Map<string, number>;
  analytic: PlanImputation;
}

/** Répartit `total` selon `weights` (repli : parts égales), arrondi au centime, somme exacte. */
export function spread(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (!n) return [];
  const sum = weights.reduce((s, w) => s + Math.max(0, w), 0);
  const raw = weights.map(w => (sum > 0 ? total * Math.max(0, w) / sum : total / n));
  const out = raw.map(r2);
  const diff = r2(total - out.reduce((s, v) => s + v, 0));
  if (diff !== 0) { let big = 0; for (let i = 1; i < n; i++) if (Math.abs(raw[i]) > Math.abs(raw[big])) big = i; out[big] = r2(out[big] + diff); }
  return out;
}

export async function planItemCosts(planId: string, input: PlanItemCostsInput): Promise<{ items: ItemCost[]; needs: Map<string, number> }> {
  const items = (await db.query(
    `SELECT ppi.id, ppi.product_id, p.name AS product_name,
            COALESCE(ppi.actual_quantity, ppi.planned_quantity)::float8 AS qty,
            (COALESCE(p.price, 0) / CASE WHEN p.price_includes_tax THEN 1 + COALESCE(tc.rate, 0) / 100 ELSE 1 END)::float8 AS price_ht,
            COALESCE(rf.poids_cuit_g / 1000.0, r.piece_weight_kg, 0)::float8 AS unit_kg,
            r.id AS recipe_id,
            COALESCE(
              (SELECT f.id FROM recipe_formats f WHERE f.id = ppi.format_id AND f.recipe_id = r.id),
              (SELECT f.id FROM recipe_formats f WHERE f.recipe_id = r.id AND f.product_id = ppi.product_id AND f.is_active LIMIT 1),
              (SELECT f.id FROM recipe_formats f WHERE f.recipe_id = r.id AND f.is_active ORDER BY f.is_default DESC, f.ordre LIMIT 1)
            ) AS format_id,
            t.matiere_u::float8 AS theo_mat_u
       FROM production_plan_items ppi
       JOIN products p ON p.id = ppi.product_id
       LEFT JOIN recipe_formats rf ON rf.id = ppi.format_id
       LEFT JOIN recipes r ON r.id = COALESCE(ppi.alt_recipe_id,
              (SELECT r2.id FROM recipes r2 WHERE r2.product_id = ppi.product_id ORDER BY r2.archived_at NULLS FIRST LIMIT 1),
              (SELECT f2.recipe_id FROM recipe_formats f2 WHERE f2.product_id = ppi.product_id AND f2.is_active LIMIT 1))
       LEFT JOIN LATERAL (SELECT tx.rate FROM tax_codes tx WHERE tx.code = p.tax_code AND tx.valid_from <= CURRENT_DATE
                           ORDER BY tx.valid_from DESC LIMIT 1) tc ON true
       LEFT JOIN LATERAL fn_plan_item_theo(ppi.id) t ON true
      WHERE ppi.plan_id = $1 AND ppi.status <> 'cancelled'
      ORDER BY p.name`, [planId])).rows as {
        id: string; product_id: string; product_name: string; qty: number; price_ht: number; unit_kg: number;
        recipe_id: string | null; format_id: string | null; theo_mat_u: number | null }[];
  if (!items.length) return { items: [], needs: new Map() };

  // ── Matières : besoins théoriques par article et par matière ──
  const needs = items.map(() => new Map<string, number>());
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.recipe_id || !(it.qty > 0)) continue;
    await collectIngredientNeedsForUnits(db, it.recipe_id, it.qty,
      (ing, q) => needs[i].set(ing, (needs[i].get(ing) ?? 0) + q), { formatId: it.format_id });
    // Bases (semi-finis) de la fiche : besoin exprimé en unités de rendement de la base.
    const comp = await getCompositionForNeeds(db, it.recipe_id, it.format_id);
    for (const sub of comp?.subRecipes ?? []) {
      const key = `semi:${sub.subRecipeId}`;
      needs[i].set(key, (needs[i].get(key) ?? 0) + sub.grossQtyPerBatch * it.qty / (comp!.batchDivisor || 1));
    }
  }
  const theoValue = items.map(it => (it.theo_mat_u ?? 0) * it.qty);
  const units = items.map(it => it.qty);
  const mat = items.map(() => 0);
  for (const m of input.detailMatieres) {
    // Mig 663 : d'abord ce que chaque article a réellement sorti (lots, sorties, manques
    // rattachés à sa ligne) ; seul le reste non rattaché se répartit par les besoins.
    let measured = 0;
    if (m.by_item) {
      items.forEach((it, i) => {
        const v = r2(m.by_item![it.id] ?? 0);
        if (v > 0) { mat[i] += v; measured += v; }
      });
    }
    const rest = r2(m.total - measured);
    if (Math.abs(rest) < 0.005) continue;
    // Un manque valorisé (« manque:<matière> ») se répartit comme la matière elle-même.
    const w = needs.map(n => n.get(m.ingredient_id.replace(/^manque:/, '')) ?? 0);
    const parts = spread(rest, w.some(x => x > 0) ? w : (theoValue.some(x => x > 0) ? theoValue : units));
    parts.forEach((v, i) => { mat[i] += v; });
  }

  // ── Composantes connues au niveau du plan : au prorata des quantités ──
  const emb = spread(input.emballages, units);
  const ene = spread(input.energie, units);
  const fac = spread(input.sousTraitance, units);
  const mo = items.map(it => r2((input.mo.timedByItem.get(it.id) ?? 0) + (input.mo.stdByItem.get(it.id) ?? 0)));
  const mach = items.map(it => r2(input.machineByItem.get(it.id) ?? 0));

  // ── Charges : chaque centre selon ses unités d'œuvre, ligne par ligne ──
  const lineHours = await itemHours(planId);
  const driverOf = (d: Driver, i: number): number => {
    const it = items[i];
    switch (d) {
      case 'units': return it.qty;
      case 'weight_kg': return it.qty * it.unit_kg;
      case 'batches': return 1;
      case 'material_cost': return mat[i];
      case 'sales_value': return it.qty * it.price_ht;
      case 'labour_hours': return lineHours.get(it.id)?.labour ?? 0;
      case 'machine_hours': return lineHours.get(it.id)?.machine ?? 0;
      default: return it.qty;
    }
  };
  const appro = items.map(() => 0), prod = items.map(() => 0), struct = items.map(() => 0), direct = items.map(() => 0);
  const adm = items.map(() => 0);
  const centres: ItemCost['charges_centres'][] = items.map(() => []);
  for (const l of input.analytic.lines) {
    let w = items.map((_, i) => driverOf(l.driver, i));
    if (!w.some(x => x > 0)) w = units;
    const parts = spread(l.total, w);
    const bucket = l.level === 'approvisionnement' ? appro : l.level === 'production' ? prod : struct;
    parts.forEach((v, i) => {
      bucket[i] += v;
      if (l.level === 'administration') adm[i] += v;
      centres[i].push({ code: l.code, name: l.name, level: l.level, driverLabel: l.driverLabel,
        quantity: Math.round(w[i] * 10000) / 10000, rate: Math.round((l.rateFixed + l.rateVariable) * 10000) / 10000, total: v });
    });
  }
  for (const d of input.analytic.directLines) {
    const idx = items.map((it, i) => (it.product_id === d.productId ? i : -1)).filter(i => i >= 0);
    const parts = spread(d.total, idx.map(i => items[i].qty));
    idx.forEach((i, k) => { direct[i] += parts[k]; });
  }

  const allNeeds = new Map<string, number>();
  for (const n of needs) for (const [k, v] of n) allNeeds.set(k, (allNeeds.get(k) ?? 0) + v);
  const out = items.map((it, i) => {
    const production = r2(mat[i] + emb[i] + mo[i] + ene[i] + mach[i] + fac[i] + appro[i] + prod[i] + direct[i]);
    const revient = r2(production + struct[i]);
    const ventes = r2(it.qty * it.price_ht);
    const marge = r2(ventes - revient);
    const lh = lineHours.get(it.id);
    return {
      plan_item_id: it.id, product_id: it.product_id, product_name: it.product_name, quantity: it.qty,
      prix_vente_ht_u: it.price_ht > 0 ? Math.round(it.price_ht * 10000) / 10000 : null,
      matieres: r2(mat[i]), emballages: emb[i], main_oeuvre: mo[i], energie: ene[i], machine: mach[i], sous_traitance: fac[i],
      charges_appro: r2(appro[i]), charges_production: r2(prod[i]), charges_structure: r2(struct[i]), charges_directes: r2(direct[i]),
      charges_administration: r2(adm[i]), charges_distribution: r2(struct[i] - adm[i]), charges_centres: centres[i],
      cout_production: production, cout_revient: revient,
      cout_production_u: it.qty > 0 ? Math.round(production / it.qty * 10000) / 10000 : null,
      cout_revient_u: it.qty > 0 ? Math.round(revient / it.qty * 10000) / 10000 : null,
      ventes_ht: ventes, marge,
      taux_marge: revient > 0 ? Math.round(marge / revient * 10000) / 100 : null,
      taux_marque: ventes > 0 ? Math.round(marge / ventes * 10000) / 100 : null,
      labour_hours: Math.round((lh?.labour ?? 0) * 100) / 100,
      labour_source: lh?.source ?? 'aucun',
      recipe_id: it.recipe_id, format_id: it.format_id,
    };
  });
  return { items: out, needs: allNeeds };
}

/** Heures de chaque ligne : temps pointé s'il existe, sinon temps standard de la gamme (lot B). */
export async function itemHours(planId: string): Promise<Map<string, { labour: number; machine: number; source: 'pointe' | 'standard' | 'aucun'; stdLabour: number }>> {
  const r = await db.query(
    `SELECT ppi.id,
            (SELECT SUM(pie.duree_reelle_min) FROM production_item_etapes pie
              WHERE pie.plan_item_id = ppi.id AND pie.status = 'completed' AND pie.duree_reelle_min > 0)::float8 / 60 AS timed_l,
            (SELECT SUM(pie.duree_reelle_min) FROM production_item_etapes pie
              WHERE pie.plan_item_id = ppi.id AND pie.status = 'completed' AND pie.duree_reelle_min > 0
                AND pie.work_center_id IS NOT NULL)::float8 / 60 AS timed_m,
            s.labor_min::float8 / 60 AS std_l, s.machine_min::float8 / 60 AS std_m
       FROM production_plan_items ppi
       LEFT JOIN LATERAL fn_plan_item_std_minutes(ppi.id) s ON true
      WHERE ppi.plan_id = $1 AND ppi.status <> 'cancelled'`, [planId]);
  const out = new Map<string, { labour: number; machine: number; source: 'pointe' | 'standard' | 'aucun'; stdLabour: number }>();
  for (const x of r.rows) {
    const timed = Number(x.timed_l) || 0;
    const std = Number(x.std_l) || 0;
    out.set(x.id, {
      labour: timed > 0 ? timed : std,
      machine: (Number(x.timed_m) || 0) > 0 ? Number(x.timed_m) : (Number(x.std_m) || 0),
      source: timed > 0 ? 'pointe' : std > 0 ? 'standard' : 'aucun',
      stdLabour: timed > 0 ? 0 : std,
    });
  }
  return out;
}
