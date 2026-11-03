/**
 * Cycle de vente (O2C), lot L5 (mig 451) — intégration base migrée.
 * Règlement réparti sur plusieurs factures, reste en avance 4421, affectation
 * ultérieure (4421 → 3421), lettrage par facture, annulation d'un règlement
 * réparti, mode « avoir » refusé, encours net des avances, ticket à crédit
 * (3421 à la vente, soldé et lettré à l'encaissement).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('O2C L5 — encaissement', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let notes: typeof import('../../repositories/delivery-note.repository.js').deliveryNoteRepository;
  let payments: typeof import('../../repositories/accounting.repository.js').paymentRepository;
  let receipts: typeof import('../../repositories/customer-receipt.repository.js').customerReceiptRepository;
  let sales: typeof import('../../repositories/sale.repository.js').saleRepository;
  let receivables: typeof import('../../repositories/receivables.repository.js').receivablesRepository;
  let fx: Fixtures;
  const ids: Record<string, string> = {};
  const p = () => testPool();

  /** Facture d'un BL de 10 × 3 DH HT, TVA 20 % (36 DH TTC). */
  const invoice = async (date: string) => notes.invoice({
    deliveryNoteIds: [((await notes.create({ customerId: ids.customer, deliveryDate: date, createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId: ids.pa, quantity: 10, unitPrice: 3, tvaRate: 20 }] })) as { id: string }).id],
    invoiceDate: date, createdBy: fx.userId });
  const inv = async (id: string) => (await p().query(`SELECT status, paid_amount::float8 AS paid FROM invoices WHERE id = $1`, [id])).rows[0];
  const ledger = async (sourceId: string) => (await p().query(
    `SELECT a.code, jel.debit::float8 AS d, jel.credit::float8 AS c, jel.invoice_id, jel.lettrage_id, je.source_detail
       FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id JOIN accounts a ON a.id = jel.account_id
      WHERE je.source_id = $1 AND je.status = 'posted' ORDER BY je.created_at, jel.line_order`, [sourceId])).rows;
  const lettered3421 = async (invoiceId: string) => (await p().query(
    `SELECT jel.lettrage_id FROM journal_entry_lines jel JOIN accounts a ON a.id = jel.account_id JOIN journal_entries je ON je.id = jel.journal_entry_id
      WHERE a.code = '3421' AND je.status = 'posted' AND (jel.invoice_id = $1 OR je.source_id = $1)`, [invoiceId])).rows.map(r => r.lettrage_id);

  beforeAll(async () => {
    repos = await importRepositories();
    notes = (await import('../../repositories/delivery-note.repository.js')).deliveryNoteRepository;
    payments = (await import('../../repositories/accounting.repository.js')).paymentRepository;
    receipts = (await import('../../repositories/customer-receipt.repository.js')).customerReceiptRepository;
    sales = (await import('../../repositories/sale.repository.js')).saleRepository;
    receivables = (await import('../../repositories/receivables.repository.js')).receivablesRepository;
    fx = await createBaseFixtures();
    ids.customer = (await p().query(
      `INSERT INTO customers (company_name, first_name, last_name, customer_type, billing_frequency) VALUES ($1, 'Hôtel', 'L5', 'professionnel', 'monthly') RETURNING id`,
      [`Hôtel L5 ${RUN}`])).rows[0].id;
    ids.pa = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1, $2, 3) RETURNING id`, [`Pain L5 ${RUN}`, `pain-l5-${RUN}`])).rows[0].id;
    fx.ids.products.push(ids.pa);
    await p().query(`INSERT INTO product_store_stock (product_id, store_id, stock_quantity) VALUES ($1, $2, 1000)`, [ids.pa, fx.storeId]);
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('un virement réparti sur deux factures, le reste en avance ; affectation ultérieure ; lettrage par facture', async () => {
    const a = await invoice('2027-06-02');
    const b = await invoice('2027-06-03');
    await expect(receipts.create({ customerId: ids.customer, amount: 50, paymentMethod: 'bank', paymentDate: '2027-06-10', userId: fx.userId,
      allocations: [{ invoiceId: a.id, amount: 36 }, { invoiceId: b.id, amount: 20 }] })).rejects.toThrow(/supérieur au règlement/);
    await expect(receipts.create({ customerId: ids.customer, amount: 50, paymentMethod: 'bank', paymentDate: '2027-06-10', userId: fx.userId,
      allocations: [{ invoiceId: a.id, amount: 40 }] })).rejects.toThrow(/il n'en reste que 36/);

    const r = await receipts.create({ customerId: ids.customer, amount: 80, paymentMethod: 'bank', paymentDate: '2027-06-10', userId: fx.userId,
      reference: `VIR-${RUN}`, allocations: [{ invoiceId: a.id, amount: 36 }, { invoiceId: b.id, amount: 30 }] });
    ids.receipt = r.payment.id;
    expect(r).toMatchObject({ allocated: 66, unapplied: 14 });
    expect(await inv(a.id)).toEqual({ status: 'paid', paid: 36 });
    expect(await inv(b.id)).toEqual({ status: 'partial', paid: 30 });

    // Écriture : banque 80 / 3421 par facture (axe facture) / avance 4421 14 — plus de 7585.
    const e = await ledger(r.payment.id);
    expect(e.map(l => [l.code, l.d, l.c, l.invoice_id])).toEqual([
      ['5141', 80, 0, null], ['3421', 0, 36, a.id], ['3421', 0, 30, b.id], ['4421', 0, 14, null],
    ]);
    // Facture A lettrée (36 = 36) ; facture B pas encore (36 ≠ 30).
    const la = await lettered3421(a.id);
    expect(la).toHaveLength(2);
    expect(la.every(x => x && x === la[0])).toBe(true);
    expect((await lettered3421(b.id)).every(x => x === null)).toBe(true);

    // Encours : factures ouvertes − avance.
    expect(Number((await p().query(`SELECT fn_customer_exposure($1) AS e`, [ids.customer])).rows[0].e)).toBe(6 - 14);
    expect((await receivables.customerSituation(ids.customer)).unappliedCash).toBe(14);

    // Affectation de 6 DH d'avance à B : écriture 4421 → 3421, B soldée et lettrée.
    const al = await receipts.allocate({ paymentId: r.payment.id, invoiceId: b.id, userId: fx.userId });
    expect(al).toEqual({ allocated: 6, unapplied: 8 });
    expect(await inv(b.id)).toEqual({ status: 'paid', paid: 36 });
    const od = (await ledger(r.payment.id)).filter(l => String(l.source_detail ?? '').startsWith('alloc:'));
    expect(od.map(l => [l.code, l.d, l.c, l.invoice_id])).toEqual([['4421', 6, 0, null], ['3421', 0, 6, b.id]]);
    const lb = await lettered3421(b.id);
    expect(lb).toHaveLength(3);
    expect(lb.every(x => x && x === lb[0])).toBe(true);
    await expect(receipts.allocate({ paymentId: r.payment.id, invoiceId: b.id, userId: fx.userId })).rejects.toThrow(/déjà réglée/);

    // Relevé : le virement apparaît une seule fois, au crédit, pour son montant.
    const st = await receivables.customerStatement(ids.customer, '2027-06-01', '2027-06-30');
    expect(st!.entries.filter(x => x.kind === 'payment').map(x => x.credit)).toEqual([80]);
    expect(st!.closing).toBe(72 - 80);
  });

  it('annulation du règlement réparti : les deux factures se rouvrent, écritures extournées', async () => {
    const reason = (await p().query(
      `SELECT id FROM ref_entries WHERE table_id = 'purchase_reason_codes' AND is_active AND metadata -> 'scope' ? 'void_payment'
          AND NOT COALESCE((metadata->>'requires_note')::boolean, false) LIMIT 1`)).rows[0]?.id;
    expect(reason).toBeTruthy();
    const allocated = (await p().query(`SELECT DISTINCT invoice_id FROM payment_allocations WHERE payment_id = $1`, [ids.receipt])).rows.map(r => r.invoice_id);
    // Annulé à sa date (exercice de test 2027) : l'extourne reste dans le même exercice.
    const c = await p().connect();
    try {
      await c.query('BEGIN');
      await payments.voidPaymentInTx(c as never, ids.receipt, { reasonCodeId: reason, userId: fx.userId, date: '2027-06-20' });
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    for (const id of allocated) expect(await inv(id)).toEqual({ status: 'pending', paid: 0 });
    expect(Number((await p().query(`SELECT fn_customer_exposure($1) AS e`, [ids.customer])).rows[0].e)).toBe(72);
  });

  it('règlement saisi sur une facture : affectation créée d\'office ; mode « avoir » refusé', async () => {
    const c = await invoice('2027-06-12');
    const pay = await payments.create({ type: 'income', invoiceId: c.id, amount: 20, paymentMethod: 'cash', paymentDate: '2027-06-13', createdBy: fx.userId });
    expect((await p().query(`SELECT amount::float8 AS a, invoice_id FROM payment_allocations WHERE payment_id = $1`, [pay.id])).rows).toEqual([{ a: 20, invoice_id: c.id }]);
    expect((await p().query(`SELECT customer_id FROM payments WHERE id = $1`, [pay.id])).rows[0].customer_id).toBe(ids.customer);
    expect(await inv(c.id)).toEqual({ status: 'partial', paid: 20 });
    await expect(payments.create({ type: 'income', invoiceId: c.id, amount: 5, paymentMethod: 'avoir', paymentDate: '2027-06-13', createdBy: fx.userId }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('ticket à crédit : créance 3421 à la vente, encaissement trésorerie / 3421 lettré', async () => {
    const sale = await sales.create({
      userId: fx.userId, storeId: fx.storeId, customerId: ids.customer, subtotal: 25, taxAmount: 0, discountAmount: 0, total: 25,
      paymentMethod: 'credit', paymentStatus: 'unpaid', skipStockDeduction: true,
      items: [{ productId: ids.pa, quantity: 5, unitPrice: 5, subtotal: 25 }],
    } as Parameters<typeof sales.create>[0]) as { id: string };
    expect((await p().query(`SELECT sold_on_credit FROM sales WHERE id = $1`, [sale.id])).rows[0].sold_on_credit).toBe(true);
    expect((await ledger(sale.id)).map(l => [l.code, l.d, l.c])).toEqual([['3421', 25, 0], ['7111', 0, 25]]);

    const paid = await sales.markPaid(sale.id, { paymentMethod: 'cash', sessionId: null, userId: fx.userId });
    expect(paid.ok).toBe(true);
    const all = await ledger(sale.id);
    expect(all.filter(l => l.source_detail === 'settlement').map(l => [l.code, l.d, l.c])).toEqual([['5161', 25, 0], ['3421', 0, 25]]);
    const l3421 = all.filter(l => l.code === '3421');
    expect(l3421).toHaveLength(2);
    expect(l3421[0].lettrage_id).not.toBeNull();
    expect(l3421[1].lettrage_id).toBe(l3421[0].lettrage_id);
  });
});
