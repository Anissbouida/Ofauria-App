/**
 * Coût d'une matière en stock = coût moyen pondéré de ses lots (CMUP, réception) : une saisie
 * sur la fiche matière ne le remplace pas tant qu'il reste un lot. Sans stock, la saisie reste
 * un prix prévisionnel.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, createBaseFixtures, cleanupFixtures, createIngredient, createLot, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Coût matière tenu par les lots', () => {
  let fx: Fixtures; let repo: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const cost = async (id: string) => Number((await testPool().query(`SELECT unit_cost FROM ingredients WHERE id = $1`, [id])).rows[0].unit_cost);

  beforeAll(async () => {
    fx = await createBaseFixtures();
    repo = (await import('../../repositories/inventory.repository.js')).ingredientRepository;
  }, 60_000);
  afterAll(async () => { if (fx) await cleanupFixtures(fx); await closeTestPool(); });

  it('avec un lot en stock, le coût saisi est ignoré ; les autres champs sont enregistrés', async () => {
    const id = await createIngredient(fx, { name: 'CML Farine', unit: 'kg', unitCost: 5.46 });
    await createLot(fx, { ingredientId: id, lotNumber: 'CML1', unitCost: 5.46, expiresInDays: 90, pesage: 0, economat: 100 });
    await repo.update(id, { unitCost: 3.5, supplier: 'Minoterie test' });
    expect(await cost(id)).toBeCloseTo(5.46, 4);
    expect((await testPool().query(`SELECT supplier FROM ingredients WHERE id = $1`, [id])).rows[0].supplier).toBe('Minoterie test');
  });

  it('mig 653 : coût = prix du lot en cours (ouvert d\'abord, puis DLC) ; le suivant prend le relais', async () => {
    const id = await createIngredient(fx, { name: 'CML Beurre', unit: 'kg', unitCost: 1 });
    const tard = await createLot(fx, { ingredientId: id, lotNumber: 'CMLB-TARD', unitCost: 9, expiresInDays: 60, pesage: 0, economat: 10 });
    const tot = await createLot(fx, { ingredientId: id, lotNumber: 'CMLB-TOT', unitCost: 7, expiresInDays: 20, pesage: 0, economat: 10 });
    expect(await cost(id)).toBeCloseTo(7, 4);                      // DLC la plus proche
    await testPool().query(`UPDATE ingredient_lots SET pesage_quantity = 2, economat_quantity = 8 WHERE id = $1`, [tard]);
    expect(await cost(id)).toBeCloseTo(9, 4);                      // contenant ouvert au pesage d'abord
    await testPool().query(`UPDATE ingredient_lots SET pesage_quantity = 0, economat_quantity = 0, quantity_remaining = 0, status = 'depleted' WHERE id = $1`, [tard]);
    expect(await cost(id)).toBeCloseTo(7, 4);                      // lot épuisé : le suivant
    await testPool().query(`UPDATE ingredient_lots SET quantity_remaining = 0, economat_quantity = 0, status = 'depleted' WHERE id = $1`, [tot]);
    expect(await cost(id)).toBeCloseTo(7, 4);                      // plus de stock : dernier prix gardé
  });

  it('sans stock, la saisie est un prix prévisionnel enregistré', async () => {
    const id = await createIngredient(fx, { name: 'CML Sucre', unit: 'kg', unitCost: 0 });
    await repo.update(id, { unitCost: 9.2 });
    expect(await cost(id)).toBeCloseTo(9.2, 4);
  });
});
