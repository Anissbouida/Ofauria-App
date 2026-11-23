/**
 * Mig 650 : doublons de nomenclature laissés par la mig 411.
 *
 * La 411 ajoutait les sous-recettes de l'ancien modèle (ordre 100) à une nomenclature qui
 * existait déjà : la base était comptée deux fois. La 650 retire la copie — ligne créée par
 * la 411, ordre 100, jumelle d'ordre inférieur sur la même source — et garde :
 *   - la ligne d'origine (quantité et unité d'origine) ;
 *   - une ligne de la 411 sans jumelle (vraie sous-recette migrée) ;
 *   - une ligne d'ordre 100 écrite plus tard par un utilisateur.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasTestDb, testPool, closeTestPool, createBaseFixtures, cleanupFixtures, createIngredient, createProductWithRecipe, setComposition, RUN, type Fixtures } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = fs.readFileSync(path.join(here, '../../../migrations/650_doublons_mig411.sql'), 'utf8');

describe.skipIf(!hasTestDb)('Mig 650 — doublons de la mig 411', () => {
  let fx: Fixtures;
  let parentId: string; let formatId: string; let baseB: string; let baseC: string;
  const p = () => testPool();
  const cost = async (id: string) => Number((await p().query(`SELECT total_cost FROM v_recipe_total_cost_v2 WHERE id = $1`, [id])).rows[0].total_cost);
  const lines = async () => (await p().query(
    `SELECT source_recipe_id, source_ingredient_id, quantite::float8 AS q, unite, ordre FROM recipe_format_components WHERE format_id = $1 ORDER BY ordre, quantite`, [formatId])).rows;

  beforeAll(async () => {
    fx = await createBaseFixtures();
    const farine = await createIngredient(fx, { name: 'M650 Farine', unit: 'kg', unitCost: 10 });
    const sucre = await createIngredient(fx, { name: 'M650 Sucre', unit: 'kg', unitCost: 2 });
    const mkBase = async (name: string) => {
      const id = (await p().query(
        `INSERT INTO recipes (name, is_base, yield_quantity, yield_unit, mode_cout) VALUES ($1, true, 1000, 'g', 'compose') RETURNING id`,
        [`${name} ${RUN}`])).rows[0].id as string;
      fx.ids.recipes.push(id);
      await setComposition(id, { ingredients: [{ ingredientId: farine, quantity: 1, unit: 'kg' }] });
      return id;
    };
    baseB = await mkBase('M650 Base B');
    baseC = await mkBase('M650 Base C');
    const pr = await createProductWithRecipe(fx, { name: 'M650 Entremets', price: 100, ingredients: [{ ingredientId: sucre, quantity: 0.5, unit: 'kg' }] });
    parentId = pr.recipeId;
    formatId = (await p().query(`SELECT id FROM recipe_formats WHERE recipe_id = $1 AND is_default`, [parentId])).rows[0].id;

    // Instant de la 411 lu en SQL : un Date JavaScript perdrait les microsecondes.
    const add = (src: string, q: number, unite: string, ordre: number, by411: boolean) => p().query(
      `INSERT INTO recipe_format_components (format_id, source_recipe_id, quantite, unite, ordre, perte_pct, created_at)
       VALUES ($1, $2, $3, $4, $5, 0,
               CASE WHEN $6::boolean THEN (SELECT executed_at FROM _migrations WHERE name = '411_unifie_modele_composition.sql') ELSE now() END)`,
      [formatId, src, q, unite, ordre, by411]);
    await add(baseB, 0.5, 'kg', 1, false);       // ligne d'origine : 500 g de base B
    await add(baseB, 0.5, 'g', 100, true);       // copie de la 411 (unité fausse en plus)
    await add(baseC, 200, 'g', 100, true);       // ligne de la 411 sans jumelle : gardée
    await add(baseB, 100, 'g', 100, false);      // ligne d'ordre 100 écrite plus tard : gardée
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx);
    await closeTestPool();
  });

  it('retire la seule copie de la 411 et garde l\'origine, la vraie migrée et la ligne utilisateur', async () => {
    expect((await lines()).length).toBe(5);
    const before = await cost(parentId);
    await p().query(MIG);
    const after = await lines();
    expect(after.length).toBe(4);
    expect(after.filter(l => l.source_recipe_id === baseB && l.ordre === 1)).toEqual([expect.objectContaining({ q: 0.5, unite: 'kg' })]);
    expect(after.some(l => l.source_recipe_id === baseB && l.unite === 'g' && l.q === 0.5)).toBe(false);
    expect(after.some(l => l.source_recipe_id === baseC && l.ordre === 100)).toBe(true);
    expect(after.some(l => l.source_recipe_id === baseB && l.ordre === 100 && l.q === 100)).toBe(true);
    // 0,5 g de base B à 10 DH/kg de farine pour 1 000 g : 0,005 DH de moins.
    expect(before - (await cost(parentId))).toBeCloseTo(0.005, 4);
  });

  it('le miroir suit la nomenclature du format par défaut', async () => {
    const mirror = Number((await p().query(
      `SELECT count(*) FROM recipe_components WHERE recipe_id = $1 AND source_recipe_id = $2 AND unite = 'g' AND quantite = 0.5`, [parentId, baseB])).rows[0].count);
    expect(mirror).toBe(0);
  });

  it('rejouée, la migration ne supprime plus rien', async () => {
    const n = (await lines()).length;
    await p().query(MIG);
    expect((await lines()).length).toBe(n);
  });
});
