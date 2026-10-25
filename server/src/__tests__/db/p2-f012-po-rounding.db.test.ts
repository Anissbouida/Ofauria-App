/**
 * F-012 — L'arrondi au contenant est signale a la creation du BC.
 *
 * Commander 210 kg d'un ingredient defini en sacs de 25 kg donne un BC de 225 kg
 * (9 sacs). Avant, l'arrondi etait silencieux et la reception de 210 laissait un
 * reliquat « fantome » de 15 kg. create() renvoie desormais les arrondis
 * (_roundings) pour que l'appelant les signale. La regle contenant reste
 * appliquee (on commande des sacs entiers) ; on ne masque aucune sous-livraison.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, cleanupFixtures, RUN, type Fixtures,
} from './helpers.js';

const SAC = 'dfb5eb29-8fec-4ad9-a788-74c989bd8ef7';   // ref_entries container_types 'sac'

describe.skipIf(!hasTestDb)('BC — arrondi au contenant signale (F-012)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let purchaseOrderRepository: typeof import('../../repositories/purchase-order.repository.js').purchaseOrderRepository;
  let fx: Fixtures;
  let ingId: string; let supplierId: string; let poId: string;

  beforeAll(async () => {
    repos = await importRepositories();
    purchaseOrderRepository = (await import('../../repositories/purchase-order.repository.js')).purchaseOrderRepository;
    fx = await createBaseFixtures();
    ingId = await createIngredient(fx, { name: 'Farine f012', unit: 'kg', unitCost: 12 });
    // Ingredient defini par contenant : sacs de 25 kg.
    await testPool().query(
      `UPDATE ingredients SET container_size = 25, container_type_id = $2 WHERE id = $1`,
      [ingId, SAC]
    );
    const sup = await testPool().query(
      `INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`Fournisseur f012 ${RUN}`]
    );
    supplierId = sup.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    const p = testPool();
    if (poId) await p.query(`DELETE FROM purchase_orders WHERE id = $1`, [poId]).catch(() => undefined);
    await p.query(`DELETE FROM suppliers WHERE id = $1`, [supplierId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('commander 210 kg (sacs de 25) -> BC 225 kg + arrondi signale', async () => {
    const po = await purchaseOrderRepository.create({
      supplierId,
      createdBy: fx.userId,
      storeId: fx.storeId,
      items: [{ ingredientId: ingId, quantityOrdered: 210, unitPrice: 12 }],
    } as Parameters<typeof purchaseOrderRepository.create>[0]);
    poId = po.id;

    // Arrondi signale par create().
    expect(Array.isArray(po._roundings)).toBe(true);
    expect(po._roundings).toHaveLength(1);
    expect(po._roundings[0].requested).toBeCloseTo(210, 3);
    expect(po._roundings[0].ordered).toBeCloseTo(225, 3);
    expect(po._roundings[0].containers).toBe(9);

    // La ligne est bien stockee a 225 (regle contenant appliquee).
    const line = await testPool().query(
      `SELECT quantity_ordered FROM purchase_order_items WHERE purchase_order_id = $1 AND ingredient_id = $2`,
      [poId, ingId]
    );
    expect(parseFloat(line.rows[0].quantity_ordered)).toBeCloseTo(225, 3);
  });
});
