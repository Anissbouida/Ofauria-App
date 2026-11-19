/**
 * G6-08 — événements de webhook FACTURES et STOCK, émis dans la transaction de l'action.
 *  - facture client émise (invoice.issued), avoir client émis (credit_note.issued) et facture
 *    soldée par l'imputation de l'avoir (invoice.paid) ;
 *  - facture fournisseur validée (invoice.validated) puis réglée (invoice.paid) ;
 *  - réception de bon de commande (stock.received) et inventaire validé (stock.count_validated) ;
 *  - transaction annulée : aucune livraison en file ; catalogue et description OpenAPI à jour.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

const EVENTS = ['invoice.issued', 'invoice.validated', 'invoice.paid', 'credit_note.issued', 'stock.received', 'stock.count_validated'];

describe.skipIf(!hasTestDb)('Webhooks factures et stock (G6-08)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let invoices: typeof import('../../repositories/accounting.repository.js').invoiceRepository;
  let payments: typeof import('../../repositories/accounting.repository.js').paymentRepository;
  let credits: typeof import('../../repositories/credit-note.repository.js').creditNoteRepository;
  let poRepo: typeof import('../../repositories/purchase-order.repository.js').purchaseOrderRepository;
  let counts: typeof import('../../repositories/stock-count.repository.js').stockCountRepository;
  let wh: typeof import('../../repositories/webhook.repository.js')['webhookRepository'];
  let withTransaction: typeof import('../../config/database.js').withTransaction;
  let fx: Fixtures;
  let epId = ''; let customerId = ''; let supplierId = ''; let categoryId = '';
  const invoiceIds: string[] = []; const paymentIds: string[] = []; const poIds: string[] = []; const countIds: string[] = [];
  const p = () => testPool();
  const today = new Date().toLocaleDateString('en-CA');

  /** Livraisons en file pour mon point, filtrées sur une clé de la charge utile. */
  const deliveries = async (key: string, value: string) => (await p().query(
    `SELECT event, signature, payload FROM webhook_deliveries
      WHERE endpoint_id = $1 AND payload->'data'->>$2 = $3 ORDER BY created_at, event`, [epId, key, value])).rows;

  beforeAll(async () => {
    repos = await importRepositories();
    const acc = await import('../../repositories/accounting.repository.js');
    invoices = acc.invoiceRepository; payments = acc.paymentRepository;
    credits = (await import('../../repositories/credit-note.repository.js')).creditNoteRepository;
    poRepo = (await import('../../repositories/purchase-order.repository.js')).purchaseOrderRepository;
    counts = (await import('../../repositories/stock-count.repository.js')).stockCountRepository;
    wh = (await import('../../repositories/webhook.repository.js')).webhookRepository;
    withTransaction = (await import('../../config/database.js')).withTransaction;
    fx = await createBaseFixtures();
    epId = (await wh.createEndpoint({ label: `Factures stock G608 ${RUN}`, url: 'https://exemple.test/hook', events: EVENTS })).id;
    customerId = (await p().query(
      `INSERT INTO customers (first_name, last_name, customer_type) VALUES ('Client', $1, 'particulier') RETURNING id`, [`G608 ${RUN}`])).rows[0].id;
    supplierId = (await p().query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`Fournisseur G608 ${RUN}`])).rows[0].id;
    categoryId = (await p().query(
      `SELECT ec.id FROM expense_categories ec JOIN accounts a ON a.id = ec.account_id WHERE a.code LIKE '61%' ORDER BY a.code LIMIT 1`)).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    const run = async (sql: string, params: unknown[]) => { try { await p().query(sql, params); } catch { /* best effort */ } };
    if (epId) {
      await run(`DELETE FROM webhook_deliveries WHERE endpoint_id = $1`, [epId]);
      await run(`DELETE FROM webhook_endpoints WHERE id = $1`, [epId]);
    }
    await run(`DELETE FROM stock_count_lines WHERE count_id = ANY($1::uuid[])`, [countIds]);
    await run(`DELETE FROM stock_counts WHERE id = ANY($1::uuid[])`, [countIds]);
    await run(`DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE purchase_order_id = ANY($1))`, [poIds]);
    await run(`DELETE FROM invoices WHERE purchase_order_id = ANY($1)`, [poIds]);
    await run(`DELETE FROM inventory_transactions WHERE reception_voucher_id IN (SELECT id FROM reception_vouchers WHERE purchase_order_id = ANY($1))`, [poIds]);
    await run(`DELETE FROM ingredient_lots WHERE reception_voucher_item_id IN (SELECT rvi.id FROM reception_voucher_items rvi JOIN reception_vouchers rv ON rv.id = rvi.reception_voucher_id WHERE rv.purchase_order_id = ANY($1))`, [poIds]);
    await run(`DELETE FROM reception_voucher_items WHERE reception_voucher_id IN (SELECT id FROM reception_vouchers WHERE purchase_order_id = ANY($1))`, [poIds]);
    await run(`DELETE FROM reception_vouchers WHERE purchase_order_id = ANY($1)`, [poIds]);
    await run(`DELETE FROM po_line_events WHERE po_line_id IN (SELECT id FROM purchase_order_items WHERE purchase_order_id = ANY($1))`, [poIds]);
    await run(`DELETE FROM purchase_order_versions WHERE purchase_order_id = ANY($1)`, [poIds]);
    await run(`DELETE FROM purchase_order_items WHERE purchase_order_id = ANY($1)`, [poIds]);
    await run(`DELETE FROM purchase_orders WHERE id = ANY($1)`, [poIds]);
    {
      const c = await p().connect();
      try {
        await c.query('BEGIN');
        await c.query(`SELECT set_config('app.payment_purge', 'on', true)`);
        await c.query(`DELETE FROM payments WHERE id = ANY($1::uuid[])`, [paymentIds]);
        await c.query('COMMIT');
      } catch { await c.query('ROLLBACK').catch(() => undefined); } finally { c.release(); }
    }
    await run(`DELETE FROM invoice_holds WHERE invoice_id = ANY($1::uuid[])`, [invoiceIds]);
    await run(`DELETE FROM suppliers WHERE id = $1`, [supplierId]);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  }, 60_000);

  it('catalogue partagé et description OpenAPI listent les nouveaux événements', async () => {
    const { WEBHOOK_EVENTS_LIST } = await import('@ofauria/shared');
    for (const e of EVENTS) expect(WEBHOOK_EVENTS_LIST).toContain(e);
    const oa = await import('../../services/openapi.js');
    const spec = oa.buildOpenApi() as Record<string, any>;
    for (const e of EVENTS) expect(Object.keys(spec.webhooks)).toContain(e);
    expect(oa.renderDocsHtml(spec)).toContain('stock.count_validated');
  });

  it('facture client émise, avoir émis, facture soldée par l\'avoir', async () => {
    const inv = await invoices.create({
      invoiceType: 'emitted', customerId, invoiceDate: '2027-05-05', amount: 50, createdBy: fx.userId, storeId: fx.storeId,
      items: [{ description: `Prestation G608 ${RUN}`, quantity: 2, unitPrice: 25, subtotal: 50 }],
    });
    invoiceIds.push(inv.id);
    const issued = await deliveries('invoice_id', inv.id);
    expect(issued.map(d => d.event)).toEqual(['invoice.issued']);
    expect(issued[0].payload.data).toMatchObject({ invoice_number: inv.invoice_number, invoice_type: 'emitted', kind: 'invoice', customer_id: customerId, total_amount: 50, invoice_date: '2027-05-05' });
    expect(issued[0].signature).toMatch(/^[0-9a-f]{64}$/);

    const r = await credits.create({ invoiceId: inv.id, reason: 'cancellation', userId: fx.userId, date: '2027-05-07' });
    invoiceIds.push(r.creditNote.id);
    const cn = await deliveries('invoice_id', r.creditNote.id);
    expect(cn.map(d => d.event)).toEqual(['credit_note.issued']);
    expect(cn[0].payload.data).toMatchObject({ kind: 'credit_note', credited_invoice_id: inv.id, credit_reason: 'cancellation' });
    // Imputation de l'avoir : la facture d'origine passe soldée → « facture réglée ».
    const after = (await deliveries('invoice_id', inv.id)).map(d => d.event);
    expect(after).toEqual(['invoice.issued', 'invoice.paid']);
  });

  it('transaction annulée : facture absente, aucune livraison en file', async () => {
    let createdId = '';
    await expect(withTransaction(async () => {
      const inv = await invoices.create({
        invoiceType: 'emitted', customerId, invoiceDate: '2027-05-08', amount: 10, createdBy: fx.userId, storeId: fx.storeId,
        items: [{ description: `Annulée G608 ${RUN}`, quantity: 1, unitPrice: 10, subtotal: 10 }],
      });
      createdId = inv.id;
      throw new Error('annulation volontaire');
    })).rejects.toThrow('annulation volontaire');
    expect(createdId).not.toBe('');
    expect((await p().query(`SELECT count(*)::int AS n FROM invoices WHERE id = $1`, [createdId])).rows[0].n).toBe(0);
    expect(await deliveries('invoice_id', createdId)).toEqual([]);
  });

  it('facture fournisseur validée puis réglée', async () => {
    const inv = await invoices.create({
      invoiceType: 'received', supplierId, categoryId, invoiceDate: today, amount: 100, taxAmount: 20, totalAmount: 120,
      createdBy: fx.userId, storeId: fx.storeId, notes: `G608 ${RUN}`,
    });
    invoiceIds.push(inv.id);
    expect(await deliveries('invoice_id', inv.id)).toEqual([]);   // brouillon : rien
    await invoices.validate(inv.id, { supplierInvoiceNumber: `FS-G608-${RUN}`, declaredHt: 100, declaredVat: 20, declaredTtc: 120 }, fx.userId);
    const v = await deliveries('invoice_id', inv.id);
    expect(v.map(d => d.event)).toEqual(['invoice.validated']);
    expect(v[0].payload.data).toMatchObject({ invoice_type: 'received', supplier_id: supplierId, supplier_invoice_number: `FS-G608-${RUN}`, total_amount: 120 });

    const pay = await payments.create({
      type: 'invoice', invoiceId: inv.id, supplierId, amount: 120, paymentMethod: 'transfer', reference: `VIR-G608-${RUN}`,
      paymentDate: today, description: 'Règlement G608', createdBy: fx.userId, storeId: fx.storeId,
    });
    paymentIds.push(pay.id);
    const paid = await deliveries('invoice_id', inv.id);
    expect(paid.map(d => d.event)).toEqual(['invoice.validated', 'invoice.paid']);
    expect(paid[1].payload.data).toMatchObject({ status: 'paid', paid_amount: 120 });
  });

  it('réception de bon de commande puis inventaire validé', async () => {
    const farineId = await createIngredient(fx, { name: 'Farine G608', unit: 'kg', unitCost: 8 });
    const po = await poRepo.create({ supplierId, createdBy: fx.userId, storeId: fx.storeId, items: [{ ingredientId: farineId, quantityOrdered: 20, unitPrice: 8 }] });
    poIds.push(po.id);
    await poRepo.updateStatus(po.id, 'envoye');
    const itemId = (await poRepo.findById(po.id))!.items[0].id as string;
    await poRepo.confirmDelivery(po.id, [{ itemId, quantityDelivered: 20 }], fx.userId, fx.storeId);
    const rec = await deliveries('purchase_order_id', po.id);
    expect(rec.map(d => d.event)).toEqual(['stock.received']);
    expect(rec[0].payload.data).toMatchObject({ supplier_id: supplierId, store_id: fx.storeId, purchase_order_status: 'livre_complet' });
    expect(rec[0].payload.data.lines).toEqual([expect.objectContaining({ ingredient_id: farineId, quantity: 20, unit_price: 8 })]);
    expect(rec[0].payload.data.lot_numbers).toHaveLength(1);

    const c = await counts.create({ title: `Inventaire G608 ${RUN}`, itemKinds: 'ingredient', ingredientIds: [farineId], blind: false }, { userId: fx.userId, storeId: fx.storeId });
    const countId = ((c as any).data?.id ?? (c as any).id) as string;
    countIds.push(countId);
    const line = (await p().query(`SELECT id FROM stock_count_lines WHERE count_id = $1`, [countId])).rows[0];
    await counts.count(countId, line.id, { countedQty: 18.5, userId: fx.userId });
    await counts.setStatus(countId, 'submit', fx.userId);
    expect(await deliveries('stock_count_id', countId)).toEqual([]);   // pas encore validé
    await counts.validate(countId, { zeroUncounted: false, userId: fx.userId });
    const sc = await deliveries('stock_count_id', countId);
    expect(sc.map(d => d.event)).toEqual(['stock.count_validated']);
    expect(sc[0].payload.data.adjustments).toEqual([expect.objectContaining({ ingredient_id: farineId, quantity_delta: -1.5 })]);
    expect(sc[0].payload.data.loss_value).toBeLessThan(0);
  }, 60_000);
});
