/**
 * Coûts standard des articles (mig 661, 2026-11-24).
 *
 * Le coût ne fait plus partie de la fiche technique : la fiche (nomenclature + gamme) dit quoi et
 * comment, ce module dit combien — comme le calcul du coût standard des ERP du marché (calcul à
 * partir de la nomenclature, des prix et des taux des centres, validé puis reporté sur l'article).
 *
 * - Calcul du jour : `standardCost` (moteur analytique, mêmes charges que le coût réel des plans).
 * - Coût de référence : le dernier calcul validé (standard_costs.status = 'validated').
 * - « À recalculer » : la fiche a changé de version depuis la validation, ou le calcul du jour
 *   s'écarte du coût validé de plus de 0,5 %.
 */
import { db, withTransaction } from '../config/database.js';
import { standardCost, suggestedPrice, type StandardCost } from '../services/cost-engine.js';
import { AnalyticError } from './analytic-cost.repository.js';

/** Écart relatif au-delà duquel le coût validé est signalé « à recalculer ». */
const STALE_THRESHOLD = 0.005;
const CONCURRENCY = 6;
const CACHE_TTL_MS = 120_000;

type Situation = 'calculated' | 'validated' | 'stale';

interface ValidatedRow {
  id: string; recipe_id: string; format_id: string | null; month: string; pieces: number | null;
  matiere: string; emballage: string; main_oeuvre: string; appro: string; production: string; structure: string;
  cout_production: string; cout_revient: string; price_ht: string | null; taux_marque: string | null;
  recipe_version: number | null; validated_at: string; validated_by_name: string | null; note: string | null;
  status: 'validated' | 'replaced'; replaced_at: string | null;
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

function validatedDto(v: ValidatedRow) {
  return {
    id: v.id, formatId: v.format_id, month: v.month.trim(), pieces: v.pieces,
    matiere: Number(v.matiere), emballage: Number(v.emballage), mainOeuvre: Number(v.main_oeuvre),
    appro: Number(v.appro), production: Number(v.production), structure: Number(v.structure),
    coutProduction: Number(v.cout_production), coutRevient: Number(v.cout_revient),
    priceHt: num(v.price_ht), tauxMarque: num(v.taux_marque), recipeVersion: v.recipe_version,
    validatedAt: v.validated_at, validatedBy: v.validated_by_name, note: v.note,
    status: v.status, replacedAt: v.replaced_at,
  };
}
export type ValidatedCost = ReturnType<typeof validatedDto>;

/** Situation d'un article : pas de coût validé, coût validé à jour, ou à recalculer. */
function situationOf(s: StandardCost, v: ValidatedCost | null, version: number | null): { situation: Situation; ecartPct: number | null; reason: string | null } {
  if (!v) return { situation: 'calculated', ecartPct: null, reason: null };
  const ecart = v.coutProduction > 0 ? (s.coutProduction - v.coutProduction) / v.coutProduction : null;
  const ecartPct = ecart != null ? round(ecart * 100, 2) : null;
  if (version != null && v.recipeVersion != null && version !== v.recipeVersion) {
    return { situation: 'stale', ecartPct, reason: 'La fiche technique a été modifiée depuis la validation.' };
  }
  if (ecart != null && Math.abs(ecart) > STALE_THRESHOLD) {
    return { situation: 'stale', ecartPct, reason: 'Les prix des matières ou les charges des centres ont changé depuis la validation.' };
  }
  return { situation: 'validated', ecartPct, reason: null };
}

const VALIDATED_SELECT = `
  SELECT sc.id, sc.recipe_id, sc.format_id, sc.month, sc.pieces, sc.matiere, sc.emballage, sc.main_oeuvre, sc.appro,
         sc.production, sc.structure, sc.cout_production, sc.cout_revient, sc.price_ht, sc.taux_marque,
         sc.recipe_version, sc.validated_at, sc.note, sc.status, sc.replaced_at,
         NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS validated_by_name
    FROM standard_costs sc LEFT JOIN users u ON u.id = sc.validated_by`;

/** Dernière version de chaque fiche (recipe_versions, mig 346). */
async function versions(recipeIds: string[]): Promise<Map<string, number>> {
  if (!recipeIds.length) return new Map();
  const r = await db.query(
    `SELECT recipe_id, MAX(version_number)::int AS v FROM recipe_versions WHERE recipe_id = ANY($1::uuid[]) GROUP BY recipe_id`, [recipeIds]);
  return new Map(r.rows.map((x: { recipe_id: string; v: number }) => [x.recipe_id, x.v]));
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  });
  await Promise.all(workers);
  return out;
}

async function computeList(storeId: string | null) {
  const recipes = (await db.query(
    `SELECT r.id, r.name, c.label AS category
       FROM recipes r LEFT JOIN recipe_categories c ON c.id = r.category_id
      WHERE r.archived_at IS NULL AND NOT COALESCE(r.is_base, false)
        AND (r.product_id IS NOT NULL OR EXISTS (SELECT 1 FROM recipe_formats f WHERE f.recipe_id = r.id AND f.is_active AND f.product_id IS NOT NULL))
      ORDER BY r.name`)).rows as { id: string; name: string; category: string | null }[];
  const ids = recipes.map(r => r.id);
  const vers = await versions(ids);
  const validated = ids.length ? (await db.query(
    `${VALIDATED_SELECT} WHERE sc.status = 'validated' AND sc.recipe_id = ANY($1::uuid[]) AND sc.store_id IS NOT DISTINCT FROM $2::uuid`,
    [ids, storeId])).rows as ValidatedRow[] : [];
  const costs = await mapLimit(recipes, CONCURRENCY, r => standardCost(r.id, { storeId }).catch(() => null));
  return recipes.map((r, i) => {
    const s = costs[i];
    if (!s) return null;
    const vRow = validated.find(v => v.recipe_id === r.id && (v.format_id ?? null) === (s.formatId ?? null));
    const v = vRow ? validatedDto(vRow) : null;
    const st = situationOf(s, v, vers.get(r.id) ?? null);
    return {
      recipeId: r.id, name: r.name, category: r.category, productName: s.productName,
      formatId: s.formatId, formatLabel: s.formats.find(f => f.id === s.formatId)?.label ?? null, pieces: s.pieces,
      month: s.month, matiere: round(s.matiere + s.emballage), coutProduction: round(s.coutProduction), coutRevient: round(s.coutRevient),
      priceHt: s.priceHt, tauxMarque: s.tauxMarque, labourMissing: s.labourMinutes == null,
      warnings: s.warnings, validated: v, ...st,
    };
  }).filter((x): x is NonNullable<typeof x> => x != null);
}

// Calcul de la liste : un passage du moteur par article ; gardé 2 minutes par établissement
// (la page se rouvre souvent), vidé à chaque validation et par « Recalculer ».
const listCache = new Map<string, { at: number; rows: Awaited<ReturnType<typeof computeList>> }>();

export const standardCostRepository = {
  async list(storeId: string | null, opts: { refresh?: boolean } = {}) {
    const key = storeId ?? '-';
    const hit = listCache.get(key);
    if (!opts.refresh && hit && Date.now() - hit.at < CACHE_TTL_MS) return { rows: hit.rows, computedAt: new Date(hit.at).toISOString() };
    const rows = await computeList(storeId);
    const at = Date.now();
    listCache.set(key, { at, rows });
    return { rows, computedAt: new Date(at).toISOString() };
  },

  /** Calcul du jour d'un article, son coût de référence, l'historique et le détail des matières. */
  async detail(recipeId: string, formatId: string | null, storeId: string | null, marque: number) {
    const s = await standardCost(recipeId, { formatId, storeId });
    if (!s) throw new AnalyticError('Fiche introuvable');
    const recipe = (await db.query(
      `SELECT r.id, r.name,
              (SELECT COALESCE(json_agg(json_build_object('composant', g.composant, 'motif', g.motif, 'via', g.via)
                                        ORDER BY g.via NULLS FIRST, g.composant), '[]'::json)
                 FROM v_recipe_cost_gaps g WHERE g.recipe_id = r.id) AS cost_gaps,
              (SELECT f.id FROM recipe_formats f WHERE f.recipe_id = r.id AND f.is_active ORDER BY f.is_default DESC, f.ordre LIMIT 1) AS default_format_id
         FROM recipes r WHERE r.id = $1`, [recipeId])).rows[0];
    const version = (await versions([recipeId])).get(recipeId) ?? null;
    const history = ((await db.query(
      `${VALIDATED_SELECT} WHERE sc.recipe_id = $1 AND sc.format_id IS NOT DISTINCT FROM $2::uuid AND sc.store_id IS NOT DISTINCT FROM $3::uuid
        ORDER BY sc.validated_at DESC LIMIT 12`, [recipeId, s.formatId, storeId])).rows as ValidatedRow[]).map(validatedDto);
    const current = history.find(h => h.status === 'validated') ?? null;

    // Détail des matières : ingrédients élémentaires de la nomenclature dépliée (v_recipe_explosion_v2,
    // format par défaut), ramenés au total matières du moteur — mêmes proportions, même total.
    let materials: { ingredientId: string; name: string; unit: string; qty: number; unitPrice: number | null; amount: number }[] = [];
    let materialsNote: string | null = null;
    if (s.formatId && s.formatId !== recipe?.default_format_id) {
      materialsNote = 'Le détail par ingrédient n\'est disponible que pour le format par défaut de la fiche.';
    } else {
      const ex = (await db.query(
        `SELECT ingredient_id, ingredient_name, unit, total_qty::float8 AS q, rolled_cost::float8 AS c
           FROM v_recipe_explosion_v2 WHERE recipe_id = $1 ORDER BY rolled_cost DESC NULLS LAST, ingredient_name`, [recipeId])).rows as
        { ingredient_id: string; ingredient_name: string; unit: string; q: number | null; c: number | null }[];
      const total = ex.reduce((t, x) => t + (Number(x.c) || 0), 0);
      const k = total > 0 && s.matiere > 0 ? s.matiere / total : 1;
      materials = ex.map(x => {
        const qty = (Number(x.q) || 0) * k;
        const amount = (Number(x.c) || 0) * k;
        return { ingredientId: x.ingredient_id, name: x.ingredient_name, unit: x.unit, qty: round(qty, 6), unitPrice: qty > 0 ? round(amount / qty, 4) : null, amount: round(amount) };
      });
    }
    const cible = Number.isFinite(marque) && marque > 0 && marque < 95 ? marque : 30;
    return {
      ...s, recipeName: (recipe?.name as string | undefined) ?? null, recipeVersion: version,
      costGaps: (recipe?.cost_gaps ?? []) as { composant: string; motif: string; via: string | null }[],
      materials, materialsNote, cibleMarque: cible, prixConseille: suggestedPrice(s, cible),
      validated: current, history, ...situationOf(s, current, version),
    };
  },

  /** Valide le calcul du jour : il devient le coût de référence, l'ancien passe « remplacé ». */
  async validate(recipeId: string, formatId: string | null, storeId: string | null, userId: string, note: string | null) {
    const s = await standardCost(recipeId, { formatId, storeId });
    if (!s) throw new AnalyticError('Fiche introuvable');
    if (!(s.coutProduction > 0)) throw new AnalyticError('Coût nul : complétez la composition et les prix des matières avant de valider.');
    const version = (await versions([recipeId])).get(recipeId) ?? null;
    const id = await withTransaction(async () => {
      await db.query(
        `UPDATE standard_costs SET status = 'replaced', replaced_at = now(), replaced_by = $4
          WHERE status = 'validated' AND recipe_id = $1 AND format_id IS NOT DISTINCT FROM $2::uuid AND store_id IS NOT DISTINCT FROM $3::uuid`,
        [recipeId, s.formatId, storeId, userId]);
      const r = await db.query(
        `INSERT INTO standard_costs (store_id, recipe_id, format_id, product_id, month, pieces, matiere, emballage, main_oeuvre,
                                     appro, production, structure, cout_production, cout_revient, price_ht, taux_marque,
                                     recipe_version, snapshot, note, validated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) RETURNING id`,
        [storeId, recipeId, s.formatId, s.productId, s.month, s.pieces, round(s.matiere), round(s.emballage), round(s.mainOeuvre),
         round(s.appro), round(s.production), round(s.structure), round(s.coutProduction), round(s.coutRevient),
         s.priceHt, s.tauxMarque, version, JSON.stringify(s), note, userId]);
      return r.rows[0].id as string;
    });
    listCache.clear();
    return { id };
  },
};
