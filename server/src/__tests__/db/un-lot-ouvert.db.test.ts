/**
 * Mig 654 : un seul lot ouvert à la fois par matière et par établissement. Ouvrir (mettre au
 * poste de pesée) un autre lot est refusé tant que le lot entamé n'est pas fini ou périmé ;
 * ouvrir un autre contenant du même lot reste permis.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, createBaseFixtures, cleanupFixtures, createIngredient, createLot, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Un seul lot ouvert à la fois', () => {
  let fx: Fixtures;
  const p = () => testPool();
  const open = (lotId: string, qty: number) =>
    p().query(`UPDATE ingredient_lots SET pesage_quantity = pesage_quantity + $2, economat_quantity = economat_quantity - $2 WHERE id = $1`, [lotId, qty]);

  beforeAll(async () => { fx = await createBaseFixtures(); }, 60_000);
  afterAll(async () => { if (fx) await cleanupFixtures(fx); await closeTestPool(); });

  it('refuse un second lot tant que le premier est entamé ; même lot permis ; fini → permis', async () => {
    const ing = await createIngredient(fx, { name: 'ULO Farine', unit: 'kg', unitCost: 5 });
    const a = await createLot(fx, { ingredientId: ing, lotNumber: 'ULO-A', unitCost: 5, expiresInDays: 30, pesage: 0, economat: 50 });
    const b = await createLot(fx, { ingredientId: ing, lotNumber: 'ULO-B', unitCost: 6, expiresInDays: 60, pesage: 0, economat: 50 });

    await open(a, 25);                                   // premier lot ouvert
    await expect(open(b, 25)).rejects.toMatchObject({ code: 'OF409', message: expect.stringMatching(/ULO-A.*déjà entamé/) });
    await expect(open(a, 25)).resolves.toBeDefined();    // autre contenant du même lot : permis

    // Tout le reste de A est au pesage (plus de contenant fermé) : B peut s'ouvrir pour compléter.
    await expect(open(b, 25)).resolves.toBeDefined();
  });

  it('dans une même opération, vider A puis ouvrir B est jugé sur l\'état final', async () => {
    const ing = await createIngredient(fx, { name: 'ULO Sucre', unit: 'kg', unitCost: 5 });
    const a = await createLot(fx, { ingredientId: ing, lotNumber: 'ULO-SA', unitCost: 5, expiresInDays: 30, pesage: 0, economat: 10 });
    const b = await createLot(fx, { ingredientId: ing, lotNumber: 'ULO-SB', unitCost: 5, expiresInDays: 60, pesage: 0, economat: 10 });
    await open(a, 4);
    const c = await p().connect();
    try {
      await c.query('BEGIN');
      // B ouvert AVANT que le reste de A passe au pesage : refusé au moment de l'ordre, accepté à la validation.
      await c.query(`UPDATE ingredient_lots SET pesage_quantity = 3, economat_quantity = 7 WHERE id = $1`, [b]);
      await c.query(`UPDATE ingredient_lots SET pesage_quantity = 10, economat_quantity = 0 WHERE id = $1`, [a]);
      await expect(c.query('COMMIT')).resolves.toBeDefined();
    } finally { c.release(); }
  });

  it('un lot ouvert mais périmé ne bloque plus', async () => {
    const ing = await createIngredient(fx, { name: 'ULO Crème', unit: 'kg', unitCost: 5 });
    const vieux = await createLot(fx, { ingredientId: ing, lotNumber: 'ULO-V', unitCost: 5, expiresInDays: 10, pesage: 0, economat: 10 });
    const neuf = await createLot(fx, { ingredientId: ing, lotNumber: 'ULO-N', unitCost: 5, expiresInDays: 40, pesage: 0, economat: 10 });
    await open(vieux, 5);
    await p().query(`UPDATE ingredient_lots SET expiration_date = CURRENT_DATE - 1 WHERE id = $1`, [vieux]);
    await expect(open(neuf, 5)).resolves.toBeDefined();
  });
});
