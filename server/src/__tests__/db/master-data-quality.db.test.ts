/**
 * G2-02 — qualité des données maîtres.
 *  - les sept compteurs existent, chacun avec « à corriger » ≤ « total » ;
 *  - la liste d'un compteur a autant de lignes que le compteur (jusqu'à 200) ;
 *  - créer deux ingrédients homonymes sans prix ni allergènes fait monter les compteurs
 *    concernés du bon nombre, et les deux fiches apparaissent dans les listes ;
 *  - un allergène renseigné sort la fiche de la liste ;
 *  - un compteur inconnu rend null.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Qualité des données maîtres (G2-02)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let quality: typeof import('../../repositories/master-data-quality.repository.js')['masterDataQualityRepository'];
  const ids: string[] = [];
  const p = () => testPool();
  const counters = async () => Object.fromEntries((await quality.summary()).map(i => [i.key, i.toFix])) as Record<string, number>;

  beforeAll(async () => {
    repos = await importRepositories();
    ({ masterDataQualityRepository: quality } = await import('../../repositories/master-data-quality.repository.js'));
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM ingredients WHERE id = ANY($1)`, [ids]).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('sept compteurs, cohérents avec leurs listes', async () => {
    const summary = await quality.summary();
    expect(summary.map(i => i.key)).toEqual([
      'formats_sans_poids_cuit', 'ingredients_sans_allergenes', 'fiches_sans_etapes', 'ingredients_homonymes',
      'ingredients_sans_prix', 'prix_aberrants', 'fiches_jamais_produites',
    ]);
    for (const i of summary) {
      expect(i.toFix).toBeGreaterThanOrEqual(0);
      expect(i.toFix).toBeLessThanOrEqual(i.total);
      // Homonymes : le compteur compte les fiches EN TROP, la liste montre toutes les fiches du groupe.
      if (i.key === 'ingredients_homonymes') continue;
      const items = await quality.items(i.key);
      expect(items).not.toBeNull();
      expect(items!.length).toBe(Math.min(i.toFix, 200));
    }
  }, 120_000);

  it('deux ingrédients homonymes sans prix ni allergènes : les compteurs montent, les fiches sont listées', async () => {
    const before = await counters();
    const name = `Farine G202 ${RUN}`;
    for (const n of [name, `  ${name.toUpperCase()} `]) {
      ids.push((await p().query(`INSERT INTO ingredients (name, unit, unit_cost) VALUES ($1, 'kg', 0) RETURNING id`, [n])).rows[0].id);
    }
    const after = await counters();
    expect(after.ingredients_homonymes - before.ingredients_homonymes).toBe(1);   // une fiche en trop
    expect(after.ingredients_sans_prix - before.ingredients_sans_prix).toBe(2);
    expect(after.ingredients_sans_allergenes - before.ingredients_sans_allergenes).toBe(2);

    const homonyms = (await quality.items('ingredients_homonymes'))!.filter(x => ids.includes(x.id));
    // La liste est bornée à 200 lignes : les deux fiches y sont si le groupe est dans la fenêtre.
    expect(homonyms.length === 2 || after.ingredients_homonymes > 100).toBe(true);
    for (const x of homonyms) expect(x.kind).toBe('ingredient');
  }, 120_000);

  it('un allergène renseigné sort la fiche du compteur', async () => {
    const before = await counters();
    await p().query(`UPDATE ingredients SET allergens = ARRAY['gluten'] WHERE id = $1`, [ids[0]]);
    expect(before.ingredients_sans_allergenes - (await counters()).ingredients_sans_allergenes).toBe(1);
  });

  it('compteur inconnu : null', async () => {
    expect(await quality.items('inconnu' as never)).toBeNull();
  });
});
