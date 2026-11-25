import { describe, it, expect } from 'vitest';
import {
  getCompositionForNeeds,
  collectIngredientNeedsForUnits,
} from '../repositories/recipe-composition.helper.js';

// Client stub : route chaque requete SQL vers des lignes en dur, par table.
// Les conversions fn_unit_conv sont simulees dans les colonnes qty_* (le SQL
// reel les calcule) — le test valide la MECANIQUE : diviseurs de fournee,
// recursion, perte standard, cycles ; l'ancien modele n'est plus lu (pas 2b-1).

interface StubData {
  recipes: Record<string, any>;
  components: Record<string, any[]>;        // recipe_components par recipe_id
  formatComponents: Record<string, any[]>;  // recipe_format_components par format_id
  formats: Record<string, { recipe_id: string; nb_par_defaut: number; rendement_kg?: number | null }>;
  legacyIngredients: Record<string, any[]>; // recipe_ingredients par recipe_id
  legacySubs: Record<string, any[]>;        // recipe_sub_recipes par recipe_id
}

function makeClient(data: StubData) {
  return {
    query: async (text: string, params: unknown[] = []) => {
      const id = params[0] as string;
      // La requête de fiche joint le format par défaut (rendement au kilo, mig 613).
      if (text.includes('FROM recipes r') && text.includes('WHERE r.id = $1')) {
        const r = data.recipes[id];
        return { rows: r ? [r] : [] };
      }
      if (text.includes('FROM recipe_formats WHERE id = $1 AND recipe_id = $2')) {
        const f = data.formats[id];
        return { rows: f && f.recipe_id === params[1] ? [{ nb_par_defaut: f.nb_par_defaut, rendement_kg: f.rendement_kg ?? null }] : [] };
      }
      if (text.includes('FROM recipe_format_components')) {
        return { rows: data.formatComponents[id] || [] };
      }
      if (text.includes('FROM recipe_components')) {
        return { rows: data.components[id] || [] };
      }
      // Pas 2b-1 (mig 649) : l'ancien modele ne doit plus etre lu.
      if (text.includes('FROM recipe_ingredients') || text.includes('FROM recipe_sub_recipes')) {
        throw new Error('Ancien modele lu (recipe_ingredients / recipe_sub_recipes)');
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

describe('getCompositionForNeeds — ancien modele (pas 2b-1)', () => {
  it("n'est plus lu : fiche hors mode compose = composition vide + avertissement", async () => {
    const client = makeClient({
      recipes: { r1: legacyRecipe('r1', 'Baguette', 10) },
      components: {}, formatComponents: {}, formats: {},
      // Lignes presentes dans l'ancien modele : le stub leve si elles sont lues.
      legacyIngredients: {
        r1: [{ ingredient_id: 'farine', quantity: '5', ingredient_name: 'farine', recipe_unit: 'kg', base_unit: 'kg' }],
      },
      legacySubs: { r1: [] },
    });
    const comp = await getCompositionForNeeds(client, 'r1');
    expect(comp?.isEmpty).toBe(true);
    expect(comp?.ingredients).toHaveLength(0);
    const { acc, warnings } = await needsFor(client, 'r1', 20);
    expect(acc.size).toBe(0);
    expect(warnings.some(w => w.includes('aucune composition'))).toBe(true);
  });

  it('garde la saisie d\'origine pour l\'affichage (420 g), la base pour les calculs', async () => {
    const client = makeClient({
      recipes: { r1: composeRecipe('r1', 'Brioche', { compo_par_piece: true }) },
      components: { r1: [ingComponent('sel', 0.42, { qty: 420, unit: 'g' })] },
      formatComponents: {}, formats: {},
      legacyIngredients: {}, legacySubs: {},
    });
    const { acc } = await needsFor(client, 'r1', 1);
    expect(acc.get('sel')).toBeCloseTo(0.42);
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

  it('compose sans composants -> plus de repli sur l\'ancien modele, warning', async () => {
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
    expect(acc.size).toBe(0);
    expect(warnings.some(w => w.includes('aucune composition'))).toBe(true);

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
  it('compose : lait saisi en kg, stocké en l, converti (densité) par le SQL', async () => {
    const client = makeClient({
      recipes: { r1: composeRecipe('r1', 'Flan', { compo_par_piece: true }) },
      // Le chef pèse : 1.03 kg de lait ; le stock est en litres (densité 1.03 kg/L) -> 1 l.
      components: { r1: [ingComponent('lait', 1, { qty: 1.03, unit: 'kg' })] },
      formatComponents: {}, formats: {},
      legacyIngredients: {}, legacySubs: {},
    });
    const { acc, warnings } = await needsFor(client, 'r1', 1);
    expect(acc.get('lait')).toBeCloseTo(1); // 1.03 kg / 1.03 = 1 litre
    expect(warnings).toHaveLength(0);
  });

  it('compose : sans densité, quantité prise telle quelle + warning explicite', async () => {
    const client = makeClient({
      recipes: { r1: composeRecipe('r1', 'Flan', { compo_par_piece: true }) },
      components: { r1: [ingComponent('lait', 1.2, { qty: 1.2, unit: 'kg' }, true)] },
      formatComponents: {}, formats: {},
      legacyIngredients: {}, legacySubs: {},
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
        parent: composeRecipe('parent', 'Parent', { compo_par_piece: true }),
        creme: composeRecipe('creme', 'Creme', { yield_quantity: '1', yield_unit: 'kg' }),
      },
      components: {
        parent: [subComponent('creme', 2, 2, 1)],
        creme: [ingComponent('lait', 1)],
      },
      formatComponents: {}, formats: {},
      legacyIngredients: {}, legacySubs: {},
    });
    const withSkip = await needsFor(client, 'parent', 1, { skipSubRecipe: (id: string) => id === 'creme' });
    expect(withSkip.acc.size).toBe(0);

    const withoutSkip = await needsFor(client, 'parent', 1);
    expect(withoutSkip.acc.get('lait')).toBeCloseTo(2);
  });
});

// Audit 2026-11 C-09 : fn_convert_factor renvoie NULL quand aucune conversion n'existe.
describe('collectIngredientNeedsForUnits — conversion absente', () => {
  const noConv = (ingredientId: string, qty: number, from: string, to: string, incertaine: boolean) => ({
    source_recipe_id: null, source_ingredient_id: ingredientId,
    ingredient_name: ingredientId, ingredient_unit: to,
    qty_entered: String(qty), unit_entered: from, perte_pct: null,
    qty_ing_base: null, conv_incertaine: incertaine,
    sub_name: null, sub_is_base: null, sub_yield_unit: null, sub_yield_quantity: null, qty_sub_net: null, qty_sub_gross: null,
  });

  it('pièces → kilo sans conversion : besoin non chiffré, avertissement nommé, jamais NaN', async () => {
    const client = makeClient({
      recipes: { r1: composeRecipe('r1', 'Tarte', { compo_par_piece: true }) },
      components: { r1: [noConv('oeufs', 3, 'unit', 'kg', false), ingComponent('sucre', 0.2)] },
      formatComponents: {}, formats: {}, legacyIngredients: {}, legacySubs: {},
    });
    const { acc, warnings } = await needsFor(client, 'r1', 10);
    expect(acc.has('oeufs')).toBe(false);
    expect(acc.get('sucre')).toBeCloseTo(2);
    expect([...acc.values()].every(Number.isFinite)).toBe(true);
    expect(warnings.some(w => w.includes('Besoin non calculé') && w.includes('oeufs'))).toBe(true);
  });

  it('poids → volume sans densité : 1 kg = 1 l, comme l\'éditeur de fiche', async () => {
    const client = makeClient({
      recipes: { r1: composeRecipe('r1', 'Flan', { compo_par_piece: true }) },
      components: { r1: [noConv('lait', 500, 'g', 'l', true)] },
      formatComponents: {}, formats: {}, legacyIngredients: {}, legacySubs: {},
    });
    const { acc, warnings } = await needsFor(client, 'r1', 4);
    expect(acc.get('lait')).toBeCloseTo(2); // 4 × 0,5 l
    expect(warnings.some(w => w.includes('densité'))).toBe(true);
  });

  it('préparation saisie dans une unité non convertible : branche ignorée avec avertissement', async () => {
    const client = makeClient({
      recipes: {
        r1: composeRecipe('r1', 'Éclair', { compo_par_piece: true }),
        b1: composeRecipe('b1', 'Crème', { yield_quantity: '2', yield_unit: 'kg' }),
      },
      components: {
        r1: [{ ...subComponent('b1', 0, 0, 2), qty_sub_net: null, qty_sub_gross: null }],
        b1: [ingComponent('lait', 1)],
      },
      formatComponents: {}, formats: {}, legacyIngredients: {}, legacySubs: {},
    });
    const { acc, warnings } = await needsFor(client, 'r1', 10);
    expect(acc.size).toBe(0);
    expect(warnings.some(w => w.includes('Besoin non calculé pour la préparation'))).toBe(true);
  });
});

// Mig 678 : composant fixe par fournée commencée.
describe('collectIngredientNeedsForUnits — composant fixe', () => {
  it('vanille fixe par fournée : 2,5 fournées → 3 gousses ; le lait suit la fraction', async () => {
    const client = makeClient({
      recipes: { r1: composeRecipe('r1', 'Crème', { pieces_par_fournee: 10 }) },
      components: { r1: [ingComponent('lait', 2), { ...ingComponent('vanille', 1), quantite_fixe: true }] },
      formatComponents: {}, formats: {}, legacyIngredients: {}, legacySubs: {},
    });
    const { acc } = await needsFor(client, 'r1', 25);   // 25 pièces / 10 par fournée = 2,5 fournées
    expect(acc.get('lait')).toBeCloseTo(5);
    expect(acc.get('vanille')).toBe(3);
  });
});
