/**
 * Scénario 1, constat 102 — un produit de revente s'achète sur un bon de commande (mig 619).
 *  - ligne de BC « product » : désignation du produit et catégorie « Achats de marchandises » figées ;
 *  - un produit fabriqué est refusé (400) ;
 *  - la réception crée un lot produit en réserve, augmente le stock réserve du magasin et
 *    fixe le coût du produit ;
 *  - la facture issue de la réception porte le produit et s'impute en 6111.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

const CAT_MARCHANDISES = '10000000-0000-0000-0000-000000000011';

describe.skipIf(!hasTestDb)('Achat d\'un produit de revente (mig 619)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let pos: typeof import('../../repositories/purchase-order.repository.js').purchaseOrderRepository;
  let receptions: typeof import('../../repositories/reception-voucher.repository.js').receptionVoucherRepository;
  let fx: Fixtures;
  let supplierId = '', resaleId = '', madeId = '', poId = '';
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    pos = (await import('../../repositories/purchase-order.repository.js')).purchaseOrderRepository;
    receptions = (await import('../../repositories/reception-voucher.repository.js')).receptionVoucherRepository;
    fx = await createBaseFixtures();
    supplierId = (await p().query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`Boissons ${RUN}`])).rows[0].id;
    resaleId = (await p().query(
      `INSERT INTO products (name, slug, price, item_kind) VALUES ($1, $2, 6, 'resale') RETURNING id`,
      [`Eau achat ${RUN}`, `eau-achat-${RUN}`])).rows[0].id;
    madeId = (await p().query(
      `INSERT INTO products (name, slug, price) VALUES ($1, $2, 5) RETURNING id`,
      [`Fabrique ${RUN}`, `fabrique-${RUN}`])).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    const run = async (sql: string, params: unknown[]) => { try { await p().query(sql, params); } catch { /* best effort */ } };
    const cc = await p().connect();
    try {
      await cc.query(`SET session_replication_role = 'replica'`);
      const q = async (sql: string, params: unknown[]) => { try { await cc.query(sql, params); } catch { /* best effort */ } };
      await q(`DELETE FROM journal_entry_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE source_id IN (SELECT id FROM invoices WHERE purchase_order_id = $1))`, [poId]);
      await q(`DELETE FROM journal_entries WHERE source_id IN (SELECT id FROM invoices WHERE purchase_order_id = $1)`, [poId]);
      await q(`DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE purchase_order_id = $1)`, [poId]);
      await q(`DELETE FROM invoices WHERE purchase_order_id = $1`, [poId]);
      await q(`DELETE FROM product_lots WHERE product_id = $1`, [resaleId]);
      await q(`DELETE FROM product_store_stock WHERE product_id = $1`, [resaleId]);
      await q(`DELETE FROM po_line_events WHERE po_line_id IN (SELECT id FROM purchase_order_items WHERE purchase_order_id = $1)`, [poId]);
      await q(`DELETE FROM reception_voucher_items WHERE reception_voucher_id IN (SELECT id FROM reception_vouchers WHERE purchase_order_id = $1)`, [poId]);
      await q(`DELETE FROM reception_vouchers WHERE purchase_order_id = $1`, [poId]);
      await q(`DELETE FROM purchase_order_items WHERE purchase_order_id = $1`, [poId]);
      await q(`DELETE FROM purchase_orders WHERE id = $1`, [poId]);
    } finally {
      await cc.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      cc.release();
    }
    await run(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [[resaleId, madeId]]);
    await run(`DELETE FROM suppliers WHERE id = $1`, [supplierId]);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('un produit fabriqué ne s\'achète pas sur un BC', async () => {
    await expect(pos.create({
      supplierId, createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId: madeId, quantityOrdered: 10, unitPrice: 2 }],
    } as never)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('ligne produit : désignation et catégorie « Achats de marchandises » figées', async () => {
    const po = await pos.create({
      supplierId, createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId: resaleId, quantityOrdered: 24, unitPrice: 3 }],
    } as never) as { id: string };
    poId = po.id;
    const line = (await p().query(
      `SELECT line_type, product_id, description, category_id, base_unit FROM purchase_order_items WHERE purchase_order_id = $1`, [poId])).rows[0];
    expect(line.line_type).toBe('product');
    expect(line.product_id).toBe(resaleId);
    expect(line.description).toBe(`Eau achat ${RUN}`);
    expect(line.category_id).toBe(CAT_MARCHANDISES);
  });

  it('réception : lot produit en réserve, stock réserve, coût ; facture en 6111', async () => {
    await p().query(`UPDATE purchase_orders SET status = 'envoye', locked_at = NOW() WHERE id = $1`, [poId]);
    const poItemId = (await p().query(`SELECT id FROM purchase_order_items WHERE purchase_order_id = $1`, [poId])).rows[0].id;
    await receptions.create({
      purchaseOrderId: poId, receivedBy: fx.userId, storeId: fx.storeId, supplierInvoiceNumber: `RB-${RUN}`,
      items: [{ poItemId, quantityReceived: 24, unitPrice: 3, expirationDate: new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10) }],
    });

    const rvi = (await p().query(`SELECT id, product_id FROM reception_voucher_items WHERE purchase_order_item_id = $1`, [poItemId])).rows[0];
    expect(rvi.product_id).toBe(resaleId);
    const lot = (await p().query(
      `SELECT store_id, quantity_total, backroom_qty, vitrine_qty, unit_cost, status, reception_voucher_item_id, lot_number
         FROM product_lots WHERE product_id = $1`, [resaleId])).rows;
    expect(lot).toHaveLength(1);
    expect(Number(lot[0].backroom_qty)).toBe(24);
    expect(Number(lot[0].vitrine_qty)).toBe(0);
    expect(Number(lot[0].unit_cost)).toBeCloseTo(3, 4);
    expect(lot[0].reception_voucher_item_id).toBe(rvi.id);
    expect(lot[0].lot_number).toMatch(/^PA-\d{6}-\d{4}$/);
    const pss = (await p().query(`SELECT stock_quantity, vitrine_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2`, [resaleId, fx.storeId])).rows[0];
    expect(Number(pss.stock_quantity)).toBe(24);
    const cost = (await p().query(`SELECT cost_price FROM products WHERE id = $1`, [resaleId])).rows[0].cost_price;
    expect(Number(cost)).toBeCloseTo(3, 2);

    const inv = (await p().query(
      `SELECT i.id, i.category_id, ii.product_id, ii.category_id AS line_cat, ii.quantity, ii.unit_price
         FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id WHERE i.purchase_order_id = $1`, [poId])).rows;
    expect(inv).toHaveLength(1);
    expect(inv[0].product_id).toBe(resaleId);
    expect(inv[0].line_cat).toBe(CAT_MARCHANDISES);
    expect(Number(inv[0].quantity)).toBe(24);
    // GR/IR : la réception débite l'achat (6111) contre 4417, la facture solde 4417.
    const accounts = (await p().query(
      `SELECT a.code FROM journal_entries je JOIN journal_entry_lines l ON l.journal_entry_id = je.id JOIN accounts a ON a.id = l.account_id
        WHERE je.source_id = $1 AND l.debit > 0`, [rvi.id])).rows.map(r => r.code);
    expect(accounts).toContain('6111');
  });
});
