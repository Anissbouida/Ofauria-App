/**
 * M6-03 — référentiel unique des motifs de rebut (mig 571).
 *  - une perte produit accepte un motif du référentiel absent de l'ancienne liste figée
 *    (« contamination »), un ancien code (« unsold ») ; refuse un code inconnu ;
 *  - le contrôle de domaine : « brule » est un motif de production, pas d'invendu ;
 *  - libellé du registre des pertes, ancien code compris ;
 *  - un lot de matière envoyé aux pertes avec un code canonique garde ce code.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, createLot, createProductWithRecipe, cleanupFixtures, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Motifs de rebut (M6-03)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let losses: typeof import('../../repositories/product-loss.repository.js')['productLossRepository'];
  let refs: typeof import('../../services/process-referentials.js');
  let lots: typeof import('../../repositories/ingredient-lot.repository.js')['ingredientLotRepository'];
  let fx: Fixtures; let productId: string; let ing: string; let lotId: string;
  const p = () => testPool();
  const loss = (reason: string) => losses.create({ productId, quantity: 1, lossType: 'vitrine', reason, unitCost: 1, totalCost: 1, ingredientsConsumed: false, declaredBy: fx.userId, storeId: fx.storeId });

  beforeAll(async () => {
    repos = await importRepositories();
    losses = (await import('../../repositories/product-loss.repository.js')).productLossRepository;
    refs = await import('../../services/process-referentials.js');
    lots = (await import('../../repositories/ingredient-lot.repository.js')).ingredientLotRepository;
    fx = await createBaseFixtures();
    productId = (await createProductWithRecipe(fx, { name: 'Tarte M603', price: 20, ingredients: [] })).productId;
    ing = await createIngredient(fx, { name: 'Crème M603', unit: 'kg', unitCost: 30 });
    lotId = await createLot(fx, { ingredientId: ing, lotNumber: 'M603', pesage: 1, expiresInDays: 5, unitCost: 30 });
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM product_losses WHERE product_id = $1`, [productId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('perte produit : motif du référentiel, ancien code acceptés ; code inconnu refusé', async () => {
    expect((await loss('contamination')).reason).toBe('contamination');
    expect((await loss('unsold')).reason).toBe('unsold');
    await expect(loss('xyz_inconnu')).rejects.toThrow(/Motif de rebut inconnu/);
  });

  it('domaine d\'usage et libellés', async () => {
    refs.invalidateProcessRefs();
    expect(await refs.scrapReasonAllowed('brule', 'production')).toBe(true);
    expect(await refs.scrapReasonAllowed('brule', 'invendu')).toBe(false);
    expect(await refs.scrapReasonAllowed('damaged', 'matiere')).toBe(true);
    const lab = (await p().query(`SELECT fn_scrap_reason_label('unsold') AS a, fn_scrap_reason_label('casse') AS b`)).rows[0];
    expect(lab).toEqual({ a: 'Invendu fin de journée', b: 'Cassé / écrasé / renversé' });
  });

  it('lot de matière aux pertes : code canonique conservé', async () => {
    await lots.sendToLosses(lotId, 'contamination', fx.userId, 'Test M603');
    const tx = (await p().query(`SELECT reason_code FROM inventory_transactions WHERE ingredient_lot_id = $1 AND type = 'waste'`, [lotId])).rows;
    expect(tx.map(r => r.reason_code)).toEqual(['contamination']);
  });
});
