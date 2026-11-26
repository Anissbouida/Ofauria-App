/**
 * Grilles tarifaires du transport (mig 714), sur une vraie base : tranches, minimum de
 * facturation, grille propre au client prioritaire sur la grille générale, contrôles.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Grilles tarifaires du transport', () => {
  let fx: Fixtures;
  let customerId = '';
  const ids: string[] = [];
  let repo: typeof import('../../repositories/freight-rate.repository.js').freightRateRepository;

  beforeAll(async () => {
    fx = await createBaseFixtures();
    repo = (await import('../../repositories/freight-rate.repository.js')).freightRateRepository;
    customerId = (await testPool().query(`INSERT INTO customers (first_name, last_name) VALUES ('Chargeur', $1) RETURNING id`, [RUN])).rows[0].id;
    ids.push(await repo.create({ name: `Général ${RUN}`, basis: 'weight', originZone: `Casa-${RUN}`, minimumCharge: 150, tvaRate: 14,
      brackets: [{ upTo: 100, unitPrice: 2 }, { upTo: 1000, unitPrice: 1.5 }, { upTo: null, unitPrice: 1, flatPrice: 200 }] }, fx.userId));
    ids.push(await repo.create({ name: `Client ${RUN}`, basis: 'weight', customerId, originZone: `Casa-${RUN}`,
      brackets: [{ upTo: null, unitPrice: 1.2 }] }, fx.userId));
  });

  afterAll(async () => {
    const p = testPool();
    await p.query(`DELETE FROM freight_rate_grids WHERE id = ANY($1::uuid[])`, [ids]);
    await p.query(`DELETE FROM customers WHERE id = $1`, [customerId]);
    await cleanupFixtures(fx);
    await closeTestPool();
  });

  it('la tranche qui contient la quantité donne le prix ; le minimum s’applique en dernier', async () => {
    const small = await repo.price({ basis: 'weight', quantity: 50, originZone: `Casa-${RUN}` });
    expect(small.amount).toBe(150);          // 50 × 2 = 100 < minimum 150
    expect(small.minimumApplied).toBe(true);
    const mid = await repo.price({ basis: 'weight', quantity: 400, originZone: `Casa-${RUN}` });
    expect(mid.amount).toBe(600);            // 400 × 1,5
    expect(mid.taxAmount).toBe(84);          // TVA 14 %
    const big = await repo.price({ basis: 'weight', quantity: 2000, originZone: `casa-${RUN}` });
    expect(big.amount).toBe(2200);           // 2000 × 1 + 200, zone sans casse
  });

  it('la grille propre au client l’emporte sur la grille générale', async () => {
    const r = await repo.price({ basis: 'weight', quantity: 400, customerId, originZone: `Casa-${RUN}` });
    expect(r.gridName).toBe(`Client ${RUN}`);
    expect(r.amount).toBe(480);
  });

  it('refuse une grille incohérente et une prestation sans grille', async () => {
    await expect(repo.create({ name: 'x', basis: 'weight', brackets: [{ upTo: null, unitPrice: 1 }, { upTo: null, unitPrice: 2 }] }, fx.userId)).rejects.toThrow(/au-delà/);
    await expect(repo.create({ name: 'x', basis: 'volume', brackets: [{ upTo: null, unitPrice: 1 }] }, fx.userId)).rejects.toThrow(/Base/);
    await expect(repo.price({ basis: 'pallet', quantity: 3, originZone: `Casa-${RUN}` })).rejects.toThrow(/Aucune grille/);
  });
});
