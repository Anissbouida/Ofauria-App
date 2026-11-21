/**
 * Scénario 1, constat 116 — une facture fournisseur née d'une réception n'entre aux
 * fournisseurs (4411) qu'à sa validation ; en brouillon, la dette reste en reçu non
 * facturé (4417, écriture de réception).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Facture née d\'une réception : écrite à la validation (constat 116)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let pos: typeof import('../../repositories/purchase-order.repository.js').purchaseOrderRepository;
  let receptions: typeof import('../../repositories/reception-voucher.repository.js').receptionVoucherRepository;
  let invoices: typeof import('../../repositories/accounting.repository.js').invoiceRepository;
  let fx: Fixtures;
  let supplierId = '', poId = '', invoiceId = '';
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    pos = (await import('../../repositories/purchase-order.repository.js')).purchaseOrderRepository;
    receptions = (await import('../../repositories/reception-voucher.repository.js')).receptionVoucherRepository;
    invoices = (await import('../../repositories/accounting.repository.js')).invoiceRepository;
    fx = await createBaseFixtures();
    supplierId = (await p().query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`Minoterie ${RUN}`])).rows[0].id;
    const farine = await createIngredient(fx, { name: 'Farine C116', unit: 'kg', unitCost: 5.5 });
    const po = await pos.create({ supplierId, createdBy: fx.userId, storeId: fx.storeId,
      items: [{ ingredientId: farine, quantityOrdered: 100, unitPrice: 5.5 }] } as never) as { id: string };
    poId = po.id;
    await p().query(`UPDATE purchase_orders SET status = 'envoye', locked_at = NOW() WHERE id = $1`, [poId]);
    const poItemId = (await p().query(`SELECT id FROM purchase_order_items WHERE purchase_order_id = $1`, [poId])).rows[0].id;
    await receptions.create({ purchaseOrderId: poId, receivedBy: fx.userId, storeId: fx.storeId,
      items: [{ poItemId, quantityReceived: 100, unitPrice: 5.5, expirationDate: new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10) }] } as never);
    invoiceId = (await p().query(`SELECT id FROM invoices WHERE purchase_order_id = $1`, [poId])).rows[0]?.id;
  }, 60_000);

  afterAll(async () => {
    const cc = await p().connect();
    try {
      await cc.query(`SET session_replication_role = 'replica'`);
      const q = async (sql: string, params: unknown[]) => { try { await cc.query(sql, params); } catch { /* best effort */ } };
      const rvis = `SELECT rvi.id FROM reception_voucher_items rvi JOIN reception_vouchers rv ON rv.id = rvi.reception_voucher_id WHERE rv.purchase_order_id = $2`;
      await q(`DELETE FROM journal_entry_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE source_id = $1 OR source_id IN (${rvis}))`, [invoiceId, poId]);
      await q(`DELETE FROM journal_entries WHERE source_id = $1 OR source_id IN (${rvis})`, [invoiceId, poId]);
      await q(`DELETE FROM po_line_events WHERE po_line_id IN (SELECT id FROM purchase_order_items WHERE purchase_order_id = $1)`, [poId]);
      await q(`DELETE FROM invoice_items WHERE invoice_id = $1`, [invoiceId]);
      await q(`DELETE FROM invoices WHERE id = $1`, [invoiceId]);
      await q(`DELETE FROM ingredient_lots WHERE reception_voucher_item_id IN (${rvis.replace('$2', '$1')})`, [poId]);
      await q(`DELETE FROM reception_voucher_items WHERE reception_voucher_id IN (SELECT id FROM reception_vouchers WHERE purchase_order_id = $1)`, [poId]);
      await q(`DELETE FROM reception_vouchers WHERE purchase_order_id = $1`, [poId]);
      await q(`DELETE FROM purchase_order_items WHERE purchase_order_id = $1`, [poId]);
      await q(`DELETE FROM purchase_orders WHERE id = $1`, [poId]);
    } finally {
      await cc.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      cc.release();
    }
    await p().query(`DELETE FROM suppliers WHERE id = $1`, [supplierId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  const invoiceAccounts = async () => (await p().query(
    `SELECT a.code, round(sum(l.credit - l.debit), 2)::float AS solde
       FROM journal_entries je JOIN journal_entry_lines l ON l.journal_entry_id = je.id JOIN accounts a ON a.id = l.account_id
      WHERE je.source_id = $1 GROUP BY a.code ORDER BY a.code`, [invoiceId])).rows;

  it('en brouillon : aucune écriture de facture', async () => {
    expect(invoiceId).toBeTruthy();
    const inv = (await p().query(`SELECT validation_status FROM invoices WHERE id = $1`, [invoiceId])).rows[0];
    expect(inv.validation_status).toBe('draft');
    expect(await invoiceAccounts()).toEqual([]);
  });

  it('à la validation : 4417 soldé contre 4411 (550 DH)', async () => {
    await invoices.validate(invoiceId, { supplierInvoiceNumber: `MA-${RUN}`, declaredTtc: 550 } as never, fx.userId);
    const acc = await invoiceAccounts();
    expect(acc.find(a => a.code === '4411')?.solde).toBeCloseTo(550, 2);
    expect(acc.find(a => a.code === '4417')?.solde).toBeCloseTo(-550, 2);
  });
});
