import { describe, it, expect } from 'vitest';
import {
  getCompositionForNeeds,
  collectIngredientNeedsForUnits,
} from '../repositories/recipe-composition.helper.js';

// Client stub : route chaque requete SQL vers des lignes en dur, par table.
// Les conversions fn_unit_conv sont simulees dans les colonnes qty_* (le SQL
// reel les calcule) — le test valide la MECANIQUE : diviseurs de fournee,
// recursion, perte standard, cycles, fallback legacy.

interface StubData {
  recipes: Record<string, any>;
  components: Record<string, any[]>;        // recipe_components par recipe_id
  formatComponents: Record<string, any[]>;  // recipe_format_components par format_id
  formats: Record<string, { recipe_id: string; nb_par_defaut: number }>;
  legacyIngredients: Record<string, any[]>; // recipe_ingredients par recipe_id
  legacySubs: Record<string, any[]>;        // recipe_sub_recipes par recipe_id
}

function makeClient(data: StubData) {
  return {
    query: async (text: string, params: unknown[] = []) => {
      const id = params[0] as string;
      if (text.includes('FROM recipes r WHERE r.id = $1')) {
        const r = data.recipes[id];
        return { rows: r ? [r] : [] };
      }
      if (text.includes('FROM recipe_formats WHERE id = $1 AND recipe_id = $2')) {
        const f = data.formats[id];
        return { rows: f && f.recipe_id === params[1] ? [{ nb_par_defaut: f.nb_par_defaut }] : [] };
      }
      if (text.includes('FROM recipe_format_components')) {
        return { rows: data.formatComponents[id] || [] };
      }
      if (text.includes('FROM recipe_components')) {
        return { rows: data.components[id] || [] };
      }
      if (text.includes('FROM recipe_ingredients')) {
        return { rows: data.legacyIngredients[id] || [] };
      }
      if (text.includes('FROM recipe_sub_recipes')) {
        return { rows: data.legacySubs[id] || [] };
      }
      throw new Error(`Requete non stubbee: ${text.slice(0, 80)}`);
    },
  };
}

const legacyRecipe = (id: string, name: string, yieldQty: number, extra: Record<string, unknown> = {}) => ({
  id, name, yield_quantity: String(yieldQty), yield_unit: 'unit',
  mode_cout: 'ratio_poids', compo_par_piece: false, pieces_par_fournee: null,
  default_format_nb: null, ...extra,
});

const composeRecipe = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, yield_quantity: '1', yield_unit: 'unit',
  mode_cout: 'compose', compo_par_piece: false, pieces_par_fournee: null,
  default_format_nb: null, ...extra,
});

const ingComponent = (ingredientId: string, qtyBase: number, entered?: { qty: number; unit: string }, convIncertaine = false) => ({
  source_recipe_id: null, source_ingredient_id: ingredientId,
  ingredient_name: ingredientId, ingredient_unit: 'kg',
  qty_entered: String(entered?.qty ?? qtyBase), unit_entered: entered?.unit ?? 'kg',
  qty_ing_base: String(qtyBase), conv_incertaine: convIncertaine,
  sub_name: null, sub_is_base: null,
  sub_yield_unit: null, sub_yield_quantity: null, qty_sub_net: null, qty_sub_gross: null,
});

const subComponent = (subId: string, net: number, gross: number, yieldQty: number, isBase = true) => ({
  source_recipe_id: subId, source_ingredient_id: null,
  ingredient_name: null, ingredient_unit: null, qty_ing_base: null,
  sub_name: subId, sub_is_base: isBase, sub_yield_unit: 'kg',
  sub_yield_quantity: String(yieldQty), qty_sub_net: String(net), qty_sub_gross: String(gross),
});

async function needsFor(client: any, recipeId: string, units: number, opts: any = {}) {
  const acc = new Map<string, number>();
  const warnings: string[] = [];
  await collectIngredientNeedsForUnits(
    client, recipeId, units,
    (ingId, qty) => acc.set(ingId, (acc.get(ingId) || 0) + qty),
    { warnings, ...opts }
  );
  return { acc, warnings };
}

describe('getCompositionForNeeds — mode legacy', () => {
  it('reproduit la formule historique (qty / yield, unite de base)', async () => {
    const client = makeClient({
      recipes: { r1: legacyRecipe('r1', 'Baguette', 10) },
      components: {}, formatComponents: {}, formats: {},
      legacyIngredients: {
        r1: [{ ingredient_id: 'farine', quantity: '5', ingredient_name: 'farine', recipe_unit: 'kg', base_unit: 'kg' }],
      },
      legacySubs: { r1: [] },
    });
    const comp = await getCompositionForNeeds(client, 'r1');
    expect(comp?.mode).toBe('legacy');
    expect(comp?.batchDivisor).toBe(10);

    // 20 baguettes -> 5 kg / 10 x 20 = 10 kg de farine (formule historique)
    const { acc } = await needsFor(client, 'r1', 20);
    expect(acc.get('farine')).toBeCloseTo(10);
  });

  it('convertit g -> kg comme avant (toBaseUnit)', async () => {
    const client = makeClient({
      recipes: { r1: legacyRecipe('r1', 'Brioche', 1) },
      components: {}, formatComponents: {}, formats: {},
      legacyIngredients: {
        r1: [{ ingredient_id: 'sel', quantity: '420', ingredient_name: 'sel', recipe_unit: 'g', base_unit: 'kg' }],
      },
      legacySubs: { r1: [] },
    });
    const { acc } = await needsFor(client, 'r1', 1);
    expect(acc.get('sel')).toBeCloseTo(0.42);

    // L'affichage garde la saisie d'origine : 420 g, pas 0.42 kg.
    const comp = await getCompositionForNeeds(client, 'r1');
    expect(comp?.ingredients[0].qtyEntered).toBeCloseTo(420);
    expect(comp?.ingredients[0].unitEntered).toBe('g');
  });
});

describe('getCompositionForNeeds — mode compose', () => {
  it('divise par le rendement fournee (pieces_par_fournee)', async () => {
    const client = makeClient({
      recipes: { r1: composeRecipe('r1', 'Tarte', { pieces_par_fournee: '12' }) },
      components: { r1: [ingComponent('beurre', 2.4)] }, // 2.4 kg par fournee de 12
      formatComponents: {}, formats: {},
      legacyIngredients: {}, legacySubs: {},
    });
    const comp = await getCompositionForNeeds(client, 'r1');
    expect(comp?.mode).toBe('compose');
    expect(comp?.batchDivisor).toBe(12);
    // L'unite saisie est conservee pour l'affichage, la base pour les calculs.
    expect(comp?.ingredients[0].qtyEntered).toBeCloseTo(2.4);
    expect(comp?.ingredients[0].unitEntered).toBe('kg');

    // 6 tartes -> 2.4 / 12 x 6 = 1.2 kg
    const { acc } = await needsFor(client, 'r1', 6);
    expect(acc.get('beurre')).toBeCloseTo(1.2);
  });

  it('compo_par_piece = true -> diviseur 1', async () => {
    const client = makeClient({
      recipes: { r1: composeRecipe('r1', 'Eclair', { compo_par_piece: true, pieces_par_fournee: '20' }) },
      components: { r1: [ingComponent('choux', 0.05)] },
      formatComponents: {}, formats: {},
      legacyIngredients: {}, legacySubs: {},
    });
    const { acc } = await needsFor(client, 'r1', 10);
    expect(acc.get('choux')).toBeCloseTo(0.5);
  });

  it('descend dans les sous-recettes avec la quantite BRUTE (perte standard)', async () => {
    // Parent : 1 fournee de 10 pieces consomme 0.9 kg NET de creme ;
    // la creme a 10% de perte -> 1.0 kg BRUT ; sa compo (yield 2 kg) prend 1 kg de lait / lot.
    const client = makeClient({
      recipes: {
        parent: composeRecipe('parent', 'Millefeuille', { pieces_par_fournee: '10' }),
        creme: composeRecipe('creme', 'Creme patissiere', { yield_quantity: '2', yield_unit: 'kg' }),
      },
      components: {
        parent: [subComponent('creme', 0.9, 1.0, 2)],
        creme: [ingComponent('lait', 1)],
      },
      formatComponents: {}, formats: {},
      legacyIngredients: {}, legacySubs: {},
    });
    // 10 pieces = 1 fournee -> 1.0 kg brut de creme -> 0.5 lot de creme -> 0.5 kg lait
    const { acc } = await needsFor(client, 'parent', 10);
    expect(acc.get('lait')).toBeCloseTo(0.5);
  });

  it('utilise la compo du format si fournie, avec son nb_par_defaut', async () => {
    const client = makeClient({
      recipes: { r1: composeRecipe('r1', 'Entremets', { pieces_par_fournee: '4' }) },
      components: { r1: [ingComponent('base-recette', 1)] },
      formatComponents: { f2: [ingComponent('chocolat', 3)] }, // compo du grand format
      formats: { f2: { recipe_id: 'r1', nb_par_defaut: 6 } },
      legacyIngredients: {}, legacySubs: {},
    });
    const { acc } = await needsFor(client, 'r1', 6, { formatId: 'f2' });
    expect(acc.get('chocolat')).toBeCloseTo(3); // 3 / 6 x 6
    expect(acc.has('base-recette')).toBe(false);
  });

  it("ignore la compo d'un format qui n'appartient pas a la recette", async () => {
    const client = makeClient({
      recipes: { r1: composeRecipe('r1', 'Tarte', { pieces_par_fournee: '2' }) },
      components: { r1: [ingComponent('pommes', 1)] },
      formatComponents: { fx: [ingComponent('intrus', 99)] },
      formats: { fx: { recipe_id: 'AUTRE', nb_par_defaut: 1 } },
      legacyIngredients: {}, legacySubs: {},
    });
    const { acc } = await needsFor(client, 'r1', 2, { formatId: 'fx' });
    expect(acc.get('pommes')).toBeCloseTo(1);
    expect(acc.has('intrus')).toBe(false);
  });

  it('compose sans composants -> fallback legacy, warning si tout est vide', async () => {
    const client = makeClient({
      recipes: { r1: composeRecipe('r1', 'Bascule', { yield_quantity: '5' }) },
      components: { r1: [] },
      formatComponents: {}, formats: {},
      legacyIngredients: {
        r1: [{ ingredient_id: 'oeufs', quantity: '10', ingredient_name: 'oeufs', recipe_unit: 'unit', base_unit: 'unit' }],
      },
      legacySubs: { r1: [] },
    });
    const { acc, warnings } = await needsFor(client, 'r1', 5);
    expect(acc.get('oeufs')).toBeCloseTo(10);
    expect(warnings).toHaveLength(0);

    const emptyClient = makeClient({
      recipes: { r2: composeRecipe('r2', 'Vide') },
      components: { r2: [] }, formatComponents: {}, formats: {},
      legacyIngredients: { r2: [] }, legacySubs: { r2: [] },
    });
    const res = await needsFor(emptyClient, 'r2', 1);
    expect(res.acc.size).toBe(0);
    expect(res.warnings.some(w => w.includes('aucune composition'))).toBe(true);
  });
});

describe('conversion poids <-> volume (densité)', () => {
  it('legacy : lait saisi en kg, stocké en l, converti via la densité', async () => {
    const client = makeClient({
      recipes: { r1: legacyRecipe('r1', 'Flan', 1) },
      components: {}, formatComponents: {}, formats: {},
      legacyIngredients: {
        // Le chef pèse : 1.03 kg de lait ; le stock est en litres (densité 1.03 kg/L).
        r1: [{ ingredient_id: 'lait', quantity: '1.03', ingredient_name: 'lait', recipe_unit: 'kg', base_unit: 'l', densite_kg_l: '1.03' }],
      },
      legacySubs: { r1: [] },
    });
    const { acc, warnings } = await needsFor(client, 'r1', 1);
    expect(acc.get('lait')).toBeCloseTo(1); // 1.03 kg / 1.03 = 1 litre
    expect(warnings).toHaveLength(0);
  });

  it('legacy : sans densité, quantité prise telle quelle + warning explicite', async () => {
    const client = makeClient({
      recipes: { r1: legacyRecipe('r1', 'Flan', 1) },
      components: {}, formatComponents: {}, formats: {},
      legacyIngredients: {
        r1: [{ ingredient_id: 'lait', quantity: '1.2', ingredient_name: 'lait', recipe_unit: 'kg', base_unit: 'l', densite_kg_l: null }],
      },
      legacySubs: { r1: [] },
    });
    const { acc, warnings } = await needsFor(client, 'r1', 1);
    expect(acc.get('lait')).toBeCloseTo(1.2); // valeur brute, comme avant
    expect(warnings.some(w => w.includes('masse volumique'))).toBe(true);
  });

  it('compose : le flag conv_incertaine du SQL remonte un warning (une fois)', async () => {
    const client = makeClient({
      recipes: { r1: composeRecipe('r1', 'Creme brulee', { pieces_par_fournee: '8' }) },
      components: { r1: [ingComponent('creme-liquide', 0.5, { qty: 500, unit: 'g' }, true)] },
      formatComponents: {}, formats: {},
      legacyIngredients: {}, legacySubs: {},
    });
    const { warnings } = await needsFor(client, 'r1', 16);
    expect(warnings.filter(w => w.includes('masse volumique'))).toHaveLength(1);
  });
});

describe('collectIngredientNeedsForUnits — garde-fous', () => {
  it('detecte un cycle et ne boucle pas', async () => {
    const client = makeClient({
      recipes: {
        a: composeRecipe('a', 'A', { yield_quantity: '1' }),
        b: composeRecipe('b', 'B', { yield_quantity: '1' }),
      },
      components: {
        a: [subComponent('b', 1, 1, 1)],
        b: [subComponent('a', 1, 1, 1), ingComponent('sucre', 0.2)],
      },
      formatComponents: {}, formats: {},
      legacyIngredients: {}, legacySubs: {},
    });
    const { acc, warnings } = await needsFor(client, 'a', 1);
    expect(acc.get('sucre')).toBeCloseTo(0.2); // B developpe une fois
    expect(warnings.some(w => w.includes('Cycle'))).toBe(true);
  });

  it('saute les sous-recettes couvertes par le stock semi-finis (skipSubRecipe)', async () => {
    const client = makeClient({
      recipes: {
        parent: legacyRecipe('parent', 'Parent', 1),
        creme: legacyRecipe('creme', 'Creme', 1),
      },
      components: {}, formatComponents: {}, formats: {},
      legacyIngredients: {
        parent: [],
        creme: [{ ingredient_id: 'lait', quantity: '1', ingredient_name: 'lait', recipe_unit: 'l', base_unit: 'l' }],
      },
      legacySubs: {
        parent: [{ sub_recipe_id: 'creme', quantity: '2', name: 'Creme', is_base: true, yield_quantity: '1', yield_unit: 'kg' }],
        creme: [],
      },
    });
    const withSkip = await needsFor(client, 'parent', 1, { skipSubRecipe: (id: string) => id === 'creme' });
    expect(withSkip.acc.size).toBe(0);

    const withoutSkip = await needsFor(client, 'parent', 1);
    expect(withoutSkip.acc.get('lait')).toBeCloseTo(2);
  });
});
