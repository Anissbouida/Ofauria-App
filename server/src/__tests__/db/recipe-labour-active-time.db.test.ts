/**
 * Scénario 1, constat 110 — main-d'œuvre par défaut = temps ACTIF des étapes (mig 622).
 *  - pointage, apprêt, cuisson, refroidissement sont des temps d'attente (types d'étape) ;
 *  - sans « Temps / fournée », fn_recipe_cost et v_recipe_format_cost comptent le temps actif ;
 *  - un temps saisi l'emporte, y compris dans la vue (qui l'ignorait).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

const ETAPES = [
  { nom: 'Pétrissage', type: 'petrissage', duree_estimee_min: 15 },
  { nom: 'Pointage', type: 'pointage', duree_estimee_min: 45 },
  { nom: 'Façonnage', type: 'faconnage', duree_estimee_min: 20 },
  { nom: 'Apprêt', type: 'appret', duree_estimee_min: 60 },
  { nom: 'Cuisson', type: 'cuisson', duree_estimee_min: 22 },
];

describe.skipIf(!hasTestDb)('Main-d\'œuvre : temps actif des étapes (constat 110)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let recipeId = '', formatId = '';
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    recipeId = (await p().query(
      `INSERT INTO recipes (name, etapes, taux_main_oeuvre_dh_h, margin_multiplier) VALUES ($1, $2, 60, 3) RETURNING id`,
      [`Baguette C110 ${RUN}`, JSON.stringify(ETAPES)])).rows[0].id;
    formatId = (await p().query(
      `INSERT INTO recipe_formats (recipe_id, quantite_par_format, nb_par_defaut, is_default) VALUES ($1, 1000, 10, true) RETURNING id`,
      [recipeId])).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM recipe_formats WHERE id = $1`, [formatId]).catch(() => undefined);
    await p().query(`DELETE FROM recipes WHERE id = $1`, [recipeId]).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('temps actif = pétrissage + façonnage (35 min sur 162)', async () => {
    const r = (await p().query(`SELECT fn_etapes_duree_active($1::jsonb) AS d`, [JSON.stringify(ETAPES)])).rows[0];
    expect(Number(r.d)).toBe(35);
  });

  it('sans temps saisi : MO = 35 min à 60 DH/h sur 10 pièces = 3,50 DH par pièce', async () => {
    const fn = (await p().query(`SELECT mo_u FROM fn_recipe_cost($1, $2)`, [recipeId, formatId])).rows[0];
    expect(Number(fn.mo_u)).toBeCloseTo(3.5, 4);
    const v = (await p().query(`SELECT cout_mo_format FROM v_recipe_format_cost WHERE id = $1`, [formatId])).rows[0];
    expect(Number(v.cout_mo_format)).toBeCloseTo(35, 2);
  });

  it('un temps saisi l\'emporte, dans la fonction comme dans la vue', async () => {
    await p().query(`UPDATE recipes SET main_oeuvre_min = 45 WHERE id = $1`, [recipeId]);
    const fn = (await p().query(`SELECT mo_u FROM fn_recipe_cost($1, $2)`, [recipeId, formatId])).rows[0];
    expect(Number(fn.mo_u)).toBeCloseTo(4.5, 4);
    const v = (await p().query(`SELECT cout_mo_format FROM v_recipe_format_cost WHERE id = $1`, [formatId])).rows[0];
    expect(Number(v.cout_mo_format)).toBeCloseTo(45, 2);
  });
});
