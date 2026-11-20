/**
 * Scénario 1, constat 82 — validation d'une facture fournisseur et réévaluation du coût.
 *  - l'écart se mesure entre le prix facturé et le prix de RÉCEPTION, pas le coût du lot
 *    (qui contient les frais d'approche) : une facture au prix reçu ne touche pas le lot ;
 *  - un vrai écart de prix s'ajoute au coût du lot, frais conservés, et met le CMUP à jour
 *    (avant : « column updated_at of relation ingredients does not exist ») ;
 *  - un lot déjà réévalué pour cette facture n'est plus proposé.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Réévaluation au prix facturé (frais d\'approche conservés)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let invoices: typeof import('../../repositories/accounting.repository.js').invoiceRepository;
  let fx: Fixtures;
  let supplierId = '', categoryId = '';
  const poIds: string[] = [], invoiceIds: string[] = [];
  const p = () => testPool();
  const today = new Date().toISOString().slice(0, 10);

  /** BC + réception de 10 kg à 100 DH, lot à 140 DH (40 DH de frais d'approche par kg). */
  const receive = async (ingredientId: string, tag: string) => {
    const po = (await p().query(
      `INSERT INTO purchase_orders (order_number, supplier_id, store_id, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id`, [`BC-REV-${tag}-${RUN}`, supplierId, fx.storeId, fx.userId])).rows[0].id;
    poIds.push(po);
    // Lignes avant le passage au statut reçu : un BC engagé est verrouillé.
    const poi = (await p().query(
      `INSERT INTO purchase_order_items (purchase_order_id, ingredient_id, quantity_ordered, unit_price)
       VALUES ($1, $2, 10, 100) RETURNING id`, [po, ingredientId])).rows[0].id;
    await p().query(`UPDATE purchase_orders SET status = 'livre_complet' WHERE id = $1`, [po]);
    const rv = (await p().query(
      `INSERT INTO reception_vouchers (voucher_number, purchase_order_id, store_id, received_by)
       VALUES ($1, $2, $3, $4) RETURNING id`, [`BR-REV-${tag}-${RUN}`, po, fx.storeId, fx.userId])).rows[0].id;
    const rvi = (await p().query(
      `INSERT INTO reception_voucher_items (reception_voucher_id, purchase_order_item_id, ingredient_id, quantity_received, unit_price)
       VALUES ($1, $2, $3, 10, 100) RETURNING id`, [rv, poi, ingredientId])).rows[0].id;
    const lot = (await p().query(
      `INSERT INTO ingredient_lots (ingredient_id, reception_voucher_item_id, supplier_id, lot_number, quantity_received,
                                    quantity_remaining, unit_cost, store_id, status, economat_quantity, pesage_quantity)
       VALUES ($1, $2, $3, $4, 10, 10, 140, $5, 'active', 10, 0) RETURNING id`,
      [ingredientId, rvi, supplierId, `LOT-REV-${tag}-${RUN}`, fx.storeId])).rows[0].id;
    return { po, poi, rvi, lot };
  };

  /** Facture brouillon d'une ligne rattachée à la réception, au prix donné. */
  const invoice = async (r: { po: string; poi: string; rvi: string }, ingredientId: string, unitPrice: number, tag: string) => {
    const total = 10 * unitPrice;
    const inv = await invoices.create({
      invoiceType: 'received', supplierId, categoryId, invoiceDate: today, amount: total, taxAmount: 0, totalAmount: total,
      createdBy: fx.userId, storeId: fx.storeId, notes: `REV ${tag} ${RUN}`,
    } as never);
    invoiceIds.push(inv.id);
    await p().query(`UPDATE invoices SET purchase_order_id = $2 WHERE id = $1`, [inv.id, r.po]);
    await p().query(
      `INSERT INTO invoice_items (invoice_id, ingredient_id, description, quantity, unit_price, subtotal,
                                  purchase_order_item_id, reception_voucher_item_id)
       VALUES ($1, $2, 'Chocolat', 10, $3, $4, $5, $6)`, [inv.id, ingredientId, unitPrice, total, r.poi, r.rvi]);
    return { id: inv.id as string, total, number: `FS-REV-${tag}-${RUN}` };
  };

  const lotCost = async (lot: string) => Number((await p().query(`SELECT unit_cost FROM ingredient_lots WHERE id = $1`, [lot])).rows[0].unit_cost);
  const preview = async (id: string) => (await p().query(`SELECT * FROM fn_stock_revaluation_preview($1)`, [id])).rows;

  beforeAll(async () => {
    repos = await importRepositories();
    invoices = (await import('../../repositories/accounting.repository.js')).invoiceRepository;
    fx = await createBaseFixtures();
    supplierId = (await p().query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`Fournisseur REV ${RUN}`])).rows[0].id;
    categoryId = (await p().query(
      `SELECT ec.id FROM expense_categories ec JOIN accounts a ON a.id = ec.account_id WHERE a.code LIKE '61%' ORDER BY a.code LIMIT 1`)).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    const run = async (sql: string, params: unknown[]) => { try { await p().query(sql, params); } catch { /* best effort */ } };
    await run(`DELETE FROM stock_valuation_adjustments WHERE source_id = ANY($1::uuid[])`, [invoiceIds]);
    await run(`DELETE FROM po_line_events WHERE po_line_id IN (SELECT id FROM purchase_order_items WHERE purchase_order_id = ANY($1::uuid[]))`, [poIds]);
    await run(`DELETE FROM invoice_items WHERE invoice_id = ANY($1::uuid[])`, [invoiceIds]);
    await run(`DELETE FROM invoices WHERE id = ANY($1::uuid[])`, [invoiceIds]);
    await run(`DELETE FROM ingredient_lots WHERE store_id = $1`, [fx?.storeId]);
    await run(`DELETE FROM reception_voucher_items WHERE reception_voucher_id IN (SELECT id FROM reception_vouchers WHERE purchase_order_id = ANY($1::uuid[]))`, [poIds]);
    await run(`DELETE FROM reception_vouchers WHERE purchase_order_id = ANY($1::uuid[])`, [poIds]);
    await run(`DELETE FROM purchase_order_items WHERE purchase_order_id = ANY($1::uuid[])`, [poIds]);
    await run(`DELETE FROM purchase_orders WHERE id = ANY($1::uuid[])`, [poIds]);
    await run(`DELETE FROM suppliers WHERE id = $1`, [supplierId]);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('facture au prix de réception : aucun écart, les frais d\'approche restent dans le lot', async () => {
    const ing = await createIngredient(fx, { name: 'Chocolat sans écart', unit: 'kg', unitCost: 140 });
    const r = await receive(ing, 'A');
    const inv = await invoice(r, ing, 100, 'A');
    expect(await preview(inv.id)).toHaveLength(0);
    await invoices.validate(inv.id, { supplierInvoiceNumber: inv.number, declaredHt: inv.total, declaredVat: 0, declaredTtc: inv.total }, fx.userId);
    expect(await lotCost(r.lot)).toBeCloseTo(140, 4);
  });

  it('facture plus chère que la réception : l\'écart s\'ajoute au lot, frais conservés, CMUP à jour, une seule fois', async () => {
    const ing = await createIngredient(fx, { name: 'Chocolat avec écart', unit: 'kg', unitCost: 140 });
    const r = await receive(ing, 'B');
    const inv = await invoice(r, ing, 110, 'B');
    const rows = await preview(inv.id);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].unit_delta)).toBeCloseTo(10, 4);
    expect(Number(rows[0].lot_unit_cost)).toBeCloseTo(140, 4);

    await invoices.validate(inv.id, { supplierInvoiceNumber: inv.number, declaredHt: inv.total, declaredVat: 0, declaredTtc: inv.total }, fx.userId);
    expect(await lotCost(r.lot)).toBeCloseTo(150, 4);
    const cmup = Number((await p().query(`SELECT unit_cost FROM ingredients WHERE id = $1`, [ing])).rows[0].unit_cost);
    expect(cmup).toBeCloseTo(150, 4);
    // Lot réévalué pour cette facture : plus proposé, pas de seconde application.
    expect(await preview(inv.id)).toHaveLength(0);
  });
});
