import { db } from '../config/database.js';
import { ALLERGEN_CODES, normalizeAllergens, type AllergenCode } from '../validators/allergens.js';

/**
 * Données de l'étiquette réglementaire d'un produit (G2-09, mig 542).
 *
 * `labelData()` compose ce qu'une étiquette doit porter :
 *   - la liste des ingrédients, tirée de la nomenclature ÉCLATÉE (les semi-finis sont
 *     remplacés par leurs propres ingrédients, sur tous les niveaux — v_recipe_explosion_v2),
 *     triée par poids décroissant ;
 *   - les allergènes : « contient » mis en évidence dans la liste (en majuscules), et
 *     « peut contenir des traces de » pour ceux qui ne sont présents qu'à l'état de traces ;
 *   - dénomination, poids net, durée de conservation, conditions, mentions.
 * Elle n'imprime rien : elle rend aussi `blockers` (l'impression doit être refusée) et
 * `warnings` (mentions manquantes), que l'écran affiche.
 *
 * Règle de sécurité : si UN ingrédient de la nomenclature n'a pas ses allergènes
 * renseignés, l'étiquette n'est pas imprimable — une liste d'allergènes incomplète est
 * pire que pas d'étiquette.
 */
const ALLERGEN_SHORT: Record<AllergenCode, string> = {
  gluten: 'gluten', crustaces: 'crustacés', oeufs: 'œufs', poissons: 'poissons', arachides: 'arachides', soja: 'soja', lait: 'lait',
  fruits_a_coque: 'fruits à coque', celeri: 'céleri', moutarde: 'moutarde', sesame: 'sésame', sulfites: 'sulfites', lupin: 'lupin', mollusques: 'mollusques',
};

export type LabelIngredient = {
  ingredientId: string; name: string;
  /** Poids dans une unité de fiche, en kg ; null si l'unité ne se convertit pas en poids. */
  weightKg: number | null;
  /** Part du poids total des ingrédients, en % ; null sans poids. */
  sharePct: number | null;
  contains: AllergenCode[]; traces: AllergenCode[]; reviewed: boolean;
};

export type LabelData = {
  product: {
    id: string; name: string; legalName: string; storageConditions: string | null; mentions: string | null;
    shelfLifeDays: number | null; netWeightG: number | null;
  };
  ingredients: LabelIngredient[];
  allergens: { contains: AllergenCode[]; traces: AllergenCode[] };
  /** « Ingrédients : FARINE DE BLÉ, eau, BEURRE, sel. » — allergènes en majuscules. */
  ingredientsText: string;
  /** « Peut contenir des traces de : soja, lait. » ou chaîne vide. */
  tracesText: string;
  blockers: string[];
  warnings: string[];
  printable: boolean;
};

const codes = (v: unknown) => normalizeAllergens(Array.isArray(v) ? v : []).codes;
const list = (names: string[]) => (names.length > 3 ? `${names.slice(0, 3).join(', ')} et ${names.length - 3} autre${names.length - 3 > 1 ? 's' : ''}` : names.join(', '));

export const productLabelRepository = {
  async labelData(productId: string): Promise<LabelData | null> {
    const product = (await db.query(
      `SELECT id, name, legal_name, storage_conditions, label_mentions, shelf_life_days FROM products WHERE id = $1`, [productId])).rows[0];
    if (!product) return null;

    const blockers: string[] = [];
    const warnings: string[] = [];
    const recipe = (await db.query(
      `SELECT id FROM recipes WHERE product_id = $1 AND archived_at IS NULL ORDER BY created_at LIMIT 1`, [productId])).rows[0];

    let ingredients: LabelIngredient[] = [];
    let netWeightG: number | null = null;
    if (!recipe) {
      blockers.push('Ce produit n\'a pas de fiche technique : la liste des ingrédients ne peut pas être établie');
    } else {
      const rows = (await db.query(
        `SELECT e.ingredient_id, i.name, e.total_qty::float8 AS total_qty,
                fn_ingredient_weight_kg_v2(e.ingredient_id, e.total_qty)::float8 AS weight_kg,
                i.allergens, i.allergen_traces, i.allergens_reviewed_at
           FROM v_recipe_explosion_v2 e
           JOIN ingredients i ON i.id = e.ingredient_id
          WHERE e.recipe_id = $1 AND e.total_qty > 0`, [recipe.id])).rows;
      const total = rows.reduce((t, r) => t + (r.weight_kg ?? 0), 0);
      ingredients = rows.map(r => {
        const contains = codes(r.allergens);
        return {
          ingredientId: r.ingredient_id, name: r.name, weightKg: r.weight_kg,
          sharePct: r.weight_kg !== null && total > 0 ? Math.round((r.weight_kg / total) * 1000) / 10 : null,
          contains, traces: codes(r.allergen_traces), reviewed: r.allergens_reviewed_at !== null || contains.length > 0,
        };
      // Poids décroissant ; les ingrédients sans poids calculable à la fin, par nom.
      }).sort((a, b) => (b.weightKg ?? -1) - (a.weightKg ?? -1) || a.name.localeCompare(b.name, 'fr'));

      if (!ingredients.length) blockers.push('La fiche technique de ce produit n\'a aucun ingrédient');
      const unreviewed = ingredients.filter(i => !i.reviewed).map(i => i.name);
      if (unreviewed.length) blockers.push(`Allergènes non renseignés pour ${unreviewed.length} ingrédient${unreviewed.length > 1 ? 's' : ''} : ${list(unreviewed)}`);
      const unweighed = ingredients.filter(i => i.weightKg === null).map(i => i.name);
      if (unweighed.length) warnings.push(`Poids non calculable (densité ou poids par pièce manquant) : ${list(unweighed)} — placé${unweighed.length > 1 ? 's' : ''} en fin de liste`);

      netWeightG = (await db.query(
        `SELECT rf.poids_cuit_g::float8 AS g FROM recipe_formats rf
          WHERE rf.is_active AND rf.poids_cuit_g IS NOT NULL AND (rf.product_id = $1 OR rf.recipe_id = $2)
          ORDER BY (rf.product_id = $1) DESC NULLS LAST, rf.is_default DESC, rf.ordre LIMIT 1`, [productId, recipe.id])).rows[0]?.g ?? null;
    }
    if (netWeightG === null) warnings.push('Poids net inconnu : le poids cuit du format n\'est pas renseigné');
    if (!product.legal_name) warnings.push('Dénomination légale non renseignée : le nom du produit est utilisé');
    if (!product.storage_conditions) warnings.push('Conditions de conservation non renseignées');
    if (product.shelf_life_days === null) warnings.push('Durée de conservation non renseignée : la date limite ne peut pas être calculée');

    const contains = ALLERGEN_CODES.filter(c => ingredients.some(i => i.contains.includes(c)));
    const traces = ALLERGEN_CODES.filter(c => !contains.includes(c) && ingredients.some(i => i.traces.includes(c)));
    const ingredientsText = ingredients.length
      ? `Ingrédients : ${ingredients.map(i => (i.contains.length ? i.name.toLocaleUpperCase('fr') : i.name.toLocaleLowerCase('fr'))).join(', ')}.`
      : '';
    const tracesText = traces.length ? `Peut contenir des traces de : ${traces.map(c => ALLERGEN_SHORT[c]).join(', ')}.` : '';

    return {
      product: {
        id: product.id, name: product.name, legalName: product.legal_name || product.name,
        storageConditions: product.storage_conditions, mentions: product.label_mentions,
        shelfLifeDays: product.shelf_life_days, netWeightG,
      },
      ingredients, allergens: { contains, traces }, ingredientsText, tracesText,
      blockers, warnings, printable: blockers.length === 0,
    };
  },

  /** Enregistre les trois mentions d'étiquette du produit (chaîne vide = effacer). */
  async saveFields(productId: string, data: { legalName?: string | null; storageConditions?: string | null; labelMentions?: string | null }): Promise<boolean> {
    const clean = (v: string | null | undefined) => (v === undefined ? undefined : (v ?? '').trim() || null);
    const fields: [string, string | null | undefined][] = [
      ['legal_name', clean(data.legalName)], ['storage_conditions', clean(data.storageConditions)], ['label_mentions', clean(data.labelMentions)],
    ];
    const sets = fields.filter(([, v]) => v !== undefined);
    if (!sets.length) return (await db.query(`SELECT 1 FROM products WHERE id = $1`, [productId])).rows.length > 0;
    const r = await db.query(
      `UPDATE products SET ${sets.map(([col], i) => `${col} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING id`,
      [productId, ...sets.map(([, v]) => v)]);
    return r.rows.length > 0;
  },
};
