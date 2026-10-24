/**
 * Correctifs des 3 bugs bloquants (P0) trouves pendant les tests « vraie vie »,
 * sur base migree (TEST_DATABASE_URL) :
 *
 *   F-025  Creer une fiche technique liee a un produit ne doit PAS ecraser le
 *          prix de vente du catalogue quand la fiche n'a pas (encore) de composant
 *          (cout nul -> prix calcule 0). Le prix n'est (re)calcule que lorsqu'un
 *          cout reel existe, ou via un prix de vente explicite.
 *   F-009  Le CMUP (cout moyen pondere) a la reception doit se calculer sur le
 *          stock PHYSIQUE REEL (lots actifs), pas sur inventory.current_quantity
 *          qui peut avoir derive (inventaire fantome) -> cout fausse.
 *   F-037  Une vente refusee pour DLV/DDE depassee doit renvoyer une erreur 409
 *          exploitable (la route l'enveloppe desormais dans asyncHandler), et non
 *          laisser la requete pendante.
 *
 * Les repositories ouvrent leurs propres connexions : les fixtures sont COMMITEES
 * puis nettoyees en afterAll (base jetable).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, cleanupFixtures, num, RUN, type Fixtures,
} from './helpers.js';

const FUTURE = new Date(Date.now() + 180 * 86_400_000).toISOString().slice(0, 10);

/* eslint-disable @typescript-eslint/no-explicit-any */
describe.skipIf(!hasTestDb)('Correctifs P0 — fiche technique, CMUP, DLV', () => {
  let recipeRepository: any;
  let receptionVoucherRepository: any;
  let productLotRepository: any;
  let fx: Fixtures;
  const supplierIds: string[] = [];
  const poIds: string[] = [];

  beforeAll(async () => {
    await importRepositories(); // positionne env.DATABASE_URL sur la base de test
    recipeRepository = (await import('../../repositories/recipe.repository.js')).recipeRepository;
    receptionVoucherRepository = (await import('../../repositories/reception-voucher.repository.js')).receptionVoucherRepository;
    productLotRepository = (await import('../../repositories/product-lot.repository.js')).productLotRepository;
    fx = await createBaseFixtures();
  }, 60_000);

  afterAll(async () => {
    const p = testPool();
    const run = async (sql: string, params: unknown[]) => { try { await p.query(sql, params); } catch { /* best effort */ } };
    for (const poId of poIds) {
      await run(`DELETE FROM reception_voucher_items WHERE reception_voucher_id IN (SELECT id FROM reception_vouchers WHERE purchase_order_id=$1)`, [poId]);
      await run(`DELETE FROM reception_vouchers WHERE purchase_order_id=$1`, [poId]);
      await run(`DELETE FROM invoices WHERE purchase_order_id=$1`, [poId]);
      await run(`DELETE FROM purchase_order_items WHERE purchase_order_id=$1`, [poId]);
      await run(`DELETE FROM purchase_orders WHERE id=$1`, [poId]);
    }
    for (const sid of supplierIds) await run(`DELETE FROM suppliers WHERE id=$1`, [sid]);
    await cleanupFixtures(fx);
    await closeTestPool();
  }, 60_000);

  /** Fournisseur + BC « envoye » + une ligne ingredient, prets a etre receptionnes. */
  async function createSentPo(ingredientId: string, qtyOrdered: number, unitPrice: number) {
    const p = testPool();
    const sup = await p.query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`Fourn ${RUN}-${supplierIds.length}`]);
    supplierIds.push(sup.rows[0].id);
    // Le BC nait « en_attente » (modifiable) : c'est le seul etat ou l'on peut
    // ajouter une ligne (trigger poi_guard_locked). On le passe « envoye » ensuite.
    const po = await p.query(
      `INSERT INTO purchase_orders (order_number, supplier_id, store_id, status, expected_delivery_date)
       VALUES ($1, $2, $3, 'en_attente', CURRENT_DATE) RETURNING id`,
      [`BC-${RUN}-${poIds.length}`, sup.rows[0].id, fx.storeId]
    );
    const poId = po.rows[0].id as string;
    poIds.push(poId);
    const poi = await p.query(
      `INSERT INTO purchase_order_items (purchase_order_id, ingredient_id, quantity_ordered, unit_price)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [poId, ingredientId, qtyOrdered, unitPrice]
    );
    await p.query(`UPDATE purchase_orders SET status='envoye', locked_at=NOW() WHERE id=$1`, [poId]);
    return { poId, poItemId: poi.rows[0].id as string };
  }

  // ─────────────────────────────── F-025 ───────────────────────────────
  it('F-025 — une fiche sans composant n ecrase PAS le prix catalogue', async () => {
    const p = testPool();
    const prod = await p.query(
      `INSERT INTO products (name, slug, price) VALUES ($1, $2, 5) RETURNING id`,
      [`Baguette F025 ${RUN}`, `baguette-f025-${RUN}`]
    );
    const productId = prod.rows[0].id as string;
    fx.ids.products.push(productId);

    const rec = await recipeRepository.create({ name: `Fiche vide ${RUN}`, productId, ingredients: [] });
    fx.ids.recipes.push(rec.id);

    const after = await p.query(`SELECT price FROM products WHERE id = $1`, [productId]);
    // Avant le correctif : le prix passait a 0 (cout 0 x marge). Desormais : inchange.
    expect(num(after.rows[0].price)).toBe(5);
  });

  it('F-025 — avec des composants, le prix EST recalcule (cout x marge)', async () => {
    const p = testPool();
    const farine = await createIngredient(fx, { name: 'Farine F025', unit: 'kg', unitCost: 10 });
    const prod = await p.query(
      `INSERT INTO products (name, slug, price) VALUES ($1, $2, 9) RETURNING id`,
      [`Pain F025 ${RUN}`, `pain-f025-${RUN}`]
    );
    const productId = prod.rows[0].id as string;
    fx.ids.products.push(productId);

    const rec = await recipeRepository.create({
      name: `Fiche pleine ${RUN}`, productId, marginMultiplier: 3,
      yieldQuantity: 1, yieldUnit: 'unit',
      ingredients: [{ ingredientId: farine, quantity: 0.5, unit: 'kg' }],
    });
    fx.ids.recipes.push(rec.id);

    const after = await p.query(`SELECT price, cost_price FROM products WHERE id = $1`, [productId]);
    expect(num(after.rows[0].cost_price)).toBeCloseTo(5, 2);   // 0,5 kg x 10 DH
    expect(num(after.rows[0].price)).toBeCloseTo(15, 2);       // 5 x marge 3
  });

  // ─────────────────────────────── F-009 ───────────────────────────────
  it('F-009 — le CMUP ignore un inventaire fantome et retient le prix recu', async () => {
    const p = testPool();
    const ing = await createIngredient(fx, { name: 'Choco F009', unit: 'kg', unitCost: 12 }); // cout obsolete
    // Inventaire FANTOME : 200 affiches alors qu AUCUN lot actif n'existe.
    await p.query(
      `INSERT INTO inventory (ingredient_id, store_id, current_quantity, minimum_threshold) VALUES ($1, $2, 200, 0)`,
      [ing, fx.storeId]
    );
    const { poId, poItemId } = await createSentPo(ing, 1000, 1.20);

    await receptionVoucherRepository.create({
      purchaseOrderId: poId, receivedBy: fx.userId, storeId: fx.storeId,
      items: [{ poItemId, ingredientId: ing, quantityReceived: 200, unitPrice: 1.20, supplierLotNumber: `A-${RUN}`, expirationDate: FUTURE }],
    });

    const after = await p.query(`SELECT unit_cost FROM ingredients WHERE id = $1`, [ing]);
    // Avant le correctif : (200 fantome x 12 + 200 recu x 1,20) / 400 = 6,60.
    // Desormais : stock reel anterieur = 0 -> on retient le prix recu, 1,20.
    expect(num(after.rows[0].unit_cost)).toBeCloseTo(1.20, 2);
  });

  it('F-009 — le CMUP moyenne correctement avec un stock reel anterieur', async () => {
    const ing = await createIngredient(fx, { name: 'Sucre F009', unit: 'kg', unitCost: 2 });
    await createLot(fx, { ingredientId: ing, lotNumber: 'PRIOR', pesage: 0, economat: 100, expiresInDays: 60, unitCost: 2 });
    const { poId, poItemId } = await createSentPo(ing, 1000, 4.0);

    await receptionVoucherRepository.create({
      purchaseOrderId: poId, receivedBy: fx.userId, storeId: fx.storeId,
      items: [{ poItemId, ingredientId: ing, quantityReceived: 100, unitPrice: 4.0, supplierLotNumber: `B-${RUN}`, expirationDate: FUTURE }],
    });

    const after = await testPool().query(`SELECT unit_cost FROM ingredients WHERE id = $1`, [ing]);
    // (100 reel x 2 + 100 recu x 4) / 200 = 3,00
    expect(num(after.rows[0].unit_cost)).toBeCloseTo(3.0, 2);
  });

  // ─────────────────────────────── F-037 ───────────────────────────────
  // Le verrou qui fait lever une erreur 409 (code DLV_EXPIREE) au checkout est
  // checkSaleability : il detecte qu'un produit n'a plus aucun lot vitrine
  // vendable. saleRepository.create lève alors une Error { statusCode: 409,
  // code: 'DLV_EXPIREE' } ; le correctif enveloppe la route dans asyncHandler pour
  // que cette erreur atteigne le middleware (prouve par async-handler.test.ts) au
  // lieu de laisser la requete pendante. On couvre ici la detection elle-meme.
  // (On ne passe pas par saleRepository.create ici : la table `sales` de la base
  // de test jetable n'a pas toutes les colonnes de prod — derive connue du setup.)
  it('F-037 — un produit dont tous les lots vitrine sont DLV depassee est detecte DLV_EXPIREE', async () => {
    const p = testPool();
    const prod = await p.query(
      `INSERT INTO products (name, slug, price) VALUES ($1, $2, 5) RETURNING id`,
      [`Pain DLV ${RUN}`, `pain-dlv-${RUN}`]
    );
    const productId = prod.rows[0].id as string;
    fx.ids.products.push(productId);
    // Seul lot vitrine : actif, en stock, mais DLC depassee (hier) -> invendable.
    await p.query(
      `INSERT INTO product_lots (product_id, store_id, lot_number, quantity_total, backroom_qty, vitrine_qty, expires_at, status)
       VALUES ($1, $2, $3, 10, 0, 10, CURRENT_DATE - 1, 'active')`,
      [productId, fx.storeId, `LOT-DLV-${RUN}`]
    );

    const issue = await productLotRepository.checkSaleability(productId, fx.storeId);
    expect(issue).not.toBeNull();
    expect(issue.reason).toBe('DLV_EXPIREE');
  });

  it('F-037 — un produit avec au moins un lot vitrine valide reste vendable', async () => {
    const p = testPool();
    const prod = await p.query(
      `INSERT INTO products (name, slug, price) VALUES ($1, $2, 5) RETURNING id`,
      [`Pain OK ${RUN}`, `pain-ok-${RUN}`]
    );
    const productId = prod.rows[0].id as string;
    fx.ids.products.push(productId);
    // Un lot perime ET un lot encore valide : la vente doit rester autorisee.
    await p.query(
      `INSERT INTO product_lots (product_id, store_id, lot_number, quantity_total, backroom_qty, vitrine_qty, expires_at, status)
       VALUES ($1, $2, $3, 5, 0, 5, CURRENT_DATE - 1, 'active'),
              ($1, $2, $4, 5, 0, 5, CURRENT_DATE + 3, 'active')`,
      [productId, fx.storeId, `LOT-OLD-${RUN}`, `LOT-NEW-${RUN}`]
    );

    const issue = await productLotRepository.checkSaleability(productId, fx.storeId);
    expect(issue).toBeNull();
  });
});
