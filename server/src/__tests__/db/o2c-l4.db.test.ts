/**
 * Cycle de vente (O2C), lot L4 (mig 450) — intégration base migrée.
 * Facture liée ligne à ligne au BL, facturé ≤ livré, date de facture ≥
 * livraison, facture directe réservée aux prestations, avoirs (annulation,
 * retour, prix) numérotés AV, imputés et lettrés, avoir non imputé au crédit
 * du client, relevé, suppression refusée, facturation planifiée des BL.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('O2C L4 — facturation sur livré et avoirs', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let notes: typeof import('../../repositories/delivery-note.repository.js').deliveryNoteRepository;
  let invoices: typeof import('../../repositories/accounting.repository.js').invoiceRepository;
  let payments: typeof import('../../repositories/accounting.repository.js').paymentRepository;
  let credits: typeof import('../../repositories/credit-note.repository.js').creditNoteRepository;
  let receivables: typeof import('../../repositories/receivables.repository.js').receivablesRepository;
  let scheduler: typeof import('../../services/scheduler.js');
  let fx: Fixtures;
  const ids: Record<string, string> = {};
  const p = () => testPool();
  let n = 0;
  /** Date des avoirs refusés : après les factures de l'exercice de test (2027). */
  const D = '2027-06-01';

  /** BL direct de 10 × 3 DH HT, TVA 20 % (36 DH TTC). */
  const deliver = async (customer = ids.customer, date = '2027-05-03', qty = 10) => notes.create({
    customerId: customer, deliveryDate: date, createdBy: fx.userId, storeId: fx.storeId,
    items: [{ productId: ids.pa, quantity: qty, unitPrice: 3, tvaRate: 20 }],
  }) as Promise<{ id: string }>;
  const row = async (id: string) => (await p().query(`SELECT * FROM invoices WHERE id = $1`, [id])).rows[0];
  const ledger = async (sourceId: string) => (await p().query(
    `SELECT a.code, jel.debit::float8 AS d, jel.credit::float8 AS c, jel.lettrage_id
       FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id JOIN accounts a ON a.id = jel.account_id
      WHERE je.source_id = $1 AND je.status = 'posted' ORDER BY a.code`, [sourceId])).rows;

  beforeAll(async () => {
    repos = await importRepositories();
    notes = (await import('../../repositories/delivery-note.repository.js')).deliveryNoteRepository;
    const acc = await import('../../repositories/accounting.repository.js');
    invoices = acc.invoiceRepository; payments = acc.paymentRepository;
    credits = (await import('../../repositories/credit-note.repository.js')).creditNoteRepository;
    receivables = (await import('../../repositories/receivables.repository.js')).receivablesRepository;
    scheduler = await import('../../services/scheduler.js');
    fx = await createBaseFixtures();
    const cust = async (name: string, freq: string) => (await p().query(
      `INSERT INTO customers (company_name, first_name, last_name, customer_type, billing_frequency) VALUES ($1, 'Hôtel', 'L4', 'professionnel', $2) RETURNING id`,
      [`${name} ${RUN}`, freq])).rows[0].id as string;
    ids.customer = await cust('Hôtel L4', 'monthly');
    ids.perDelivery = await cust('Café L4', 'per_delivery');
    ids.pa = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1, $2, 3) RETURNING id`, [`Pain L4 ${RUN}`, `pain-l4-${RUN}`])).rows[0].id;
    fx.ids.products.push(ids.pa);
    await p().query(`INSERT INTO product_store_stock (product_id, store_id, stock_quantity) VALUES ($1, $2, 1000)`, [ids.pa, fx.storeId]);
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('facture du BL : lignes liées au BL et à la commande, date ≥ livraison, facturé ≤ livré', async () => {
    // Commande livrée en partie : la ligne de facture porte la ligne de BL et la ligne de commande.
    const o = (await p().query(
      `INSERT INTO orders (order_number, user_id, type, status, subtotal, total, store_id, customer_id)
       VALUES ($1, $2, 'custom', 'ready', 30, 30, $3, $4) RETURNING id`, [`L4-${++n}-${RUN}`.slice(0, 20), fx.userId, fx.storeId, ids.customer])).rows[0].id;
    const oi = (await p().query(`INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal) VALUES ($1, $2, 10, 3, 30) RETURNING id`, [o, ids.pa])).rows[0].id;
    const bl = await notes.createFromOrder(o, fx.userId, fx.storeId, { quantities: { [oi]: 6 }, deliveryDate: '2027-05-03' }) as { id: string };
    await expect(notes.invoice({ deliveryNoteIds: [bl.id], invoiceDate: '2027-05-02', createdBy: fx.userId })).rejects.toThrow(/antérieure à la dernière livraison/);
    const inv = await notes.invoice({ deliveryNoteIds: [bl.id], invoiceDate: '2027-05-04', createdBy: fx.userId });
    const line = (await p().query(
      `SELECT ii.delivery_note_item_id, ii.order_item_id, dni.qty_invoiced::float8 AS qi
         FROM invoice_items ii JOIN delivery_note_items dni ON dni.id = ii.delivery_note_item_id WHERE ii.invoice_id = $1`, [inv.id])).rows;
    expect(line).toEqual([{ delivery_note_item_id: expect.any(String), order_item_id: oi, qi: 6 }]);

    // Une deuxième facture sur la même ligne de BL : refusée au COMMIT par la base.
    const c = await p().connect();
    try {
      await c.query('BEGIN');
      const dup = (await c.query(
        `INSERT INTO invoices (invoice_number, invoice_type, customer_id, invoice_date, amount, total_amount)
         VALUES ($1, 'emitted', $2, '2027-05-04', 18, 18) RETURNING id`, [`DUP-${RUN}`, ids.customer])).rows[0].id;
      await c.query(
        `INSERT INTO invoice_items (invoice_id, product_id, description, quantity, unit_price, subtotal, delivery_note_item_id)
         VALUES ($1, $2, 'doublon', 6, 3, 18, $3)`, [dup, ids.pa, line[0].delivery_note_item_id]);
      await expect(c.query('COMMIT')).rejects.toThrow(/au-delà du livré/);
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
    }
  });

  it('facture directe : prestations seulement, total = somme des lignes ; une facture émise ne se supprime pas', async () => {
    await expect(invoices.create({
      invoiceType: 'emitted', customerId: ids.customer, invoiceDate: '2027-05-05', amount: 30, createdBy: fx.userId,
      items: [{ productId: ids.pa, quantity: 10, unitPrice: 3, subtotal: 30 }],
    })).rejects.toMatchObject({ statusCode: 400 });
    const svc = await invoices.create({
      invoiceType: 'emitted', customerId: ids.customer, invoiceDate: '2027-05-05', amount: 1, taxAmount: 0, totalAmount: 999, createdBy: fx.userId,
      items: [{ description: 'Livraison spéciale', quantity: 2, unitPrice: 25, subtotal: 50 }],
    });
    expect(Number(svc.total_amount)).toBe(50);
    await expect(invoices.deleteById(svc.id)).rejects.toThrow(/ne se supprime pas/);
  });

  it('avoir d\'annulation : pièce AV, facture soldée par imputation, écritures lettrées, BL de nouveau à facturer', async () => {
    const bl = await deliver();
    const inv = await notes.invoice({ deliveryNoteIds: [bl.id], invoiceDate: '2027-05-06', createdBy: fx.userId });
    const r = await credits.create({ invoiceId: inv.id, reason: 'cancellation', userId: fx.userId, date: '2027-05-07' });
    expect(r.creditNote.invoice_number).toMatch(/^AV-2027-/);
    expect(r).toMatchObject({ applied: 36, unapplied: 0 });
    const cn = await row(r.creditNote.id);
    expect(cn).toMatchObject({ kind: 'credit_note', credited_invoice_id: inv.id, credit_reason: 'cancellation', status: 'paid' });
    expect(await row(inv.id)).toMatchObject({ status: 'paid' });
    // BL rendu à facturer, facturé net nul.
    expect((await p().query(`SELECT status, invoice_id FROM delivery_notes WHERE id = $1`, [bl.id])).rows[0]).toEqual({ status: 'delivered', invoice_id: null });
    expect((await p().query(`SELECT qty_invoiced::float8 AS q FROM delivery_note_items WHERE delivery_note_id = $1`, [bl.id])).rows[0].q).toBe(0);
    // Écriture de l'avoir : 7111 + TVA au débit, 3421 au crédit ; 3421 lettré avec la facture.
    const e = await ledger(cn.id);
    expect(e.find(l => l.code === '7111')).toMatchObject({ d: 30, c: 0 });
    expect(e.find(l => l.code === '3421')).toMatchObject({ d: 0, c: 36 });
    const l3421 = [...await ledger(inv.id), ...e].filter(l => l.code === '3421');
    expect(l3421).toHaveLength(2);
    expect(new Set(l3421.map(l => l.lettrage_id)).size).toBe(1);
    expect(l3421[0].lettrage_id).not.toBeNull();
    // Le BL se refacture.
    const again = await notes.invoice({ deliveryNoteIds: [bl.id], invoiceDate: '2027-05-08', createdBy: fx.userId });
    expect(Number(again.total_amount)).toBe(36);
    // Une facture déjà annulée par avoir ne s'annule pas deux fois ; un avoir ne se crédite pas.
    await expect(credits.create({ invoiceId: inv.id, reason: 'cancellation', userId: fx.userId, date: D })).rejects.toThrow(/déjà créditée/);
    await expect(credits.create({ invoiceId: cn.id, reason: 'cancellation', userId: fx.userId, date: D })).rejects.toThrow(/ne se crédite pas/);
  });

  it('avoir de retour sur facture en partie réglée : surplus au crédit du client, imputé ensuite sur une autre facture', async () => {
    const inv = await notes.invoice({ deliveryNoteIds: [(await deliver()).id], invoiceDate: '2027-05-10', createdBy: fx.userId });
    await payments.create({ type: 'income', invoiceId: inv.id, amount: 30, paymentMethod: 'cash', paymentDate: '2027-05-11', createdBy: fx.userId });
    const item = (await p().query(`SELECT id FROM invoice_items WHERE invoice_id = $1`, [inv.id])).rows[0].id;
    await expect(credits.create({ invoiceId: inv.id, reason: 'return', userId: fx.userId, date: D, lines: [{ invoiceItemId: item, quantity: 11 }] }))
      .rejects.toThrow(/Quantité retournée invalide/);
    // Retour de 4 : 12 HT + 2,40 TVA = 14,40 ; 6 restaient dus → 6 imputés, 8,40 au crédit du client.
    const r = await credits.create({ invoiceId: inv.id, reason: 'return', userId: fx.userId, date: '2027-05-12', lines: [{ invoiceItemId: item, quantity: 4 }] });
    expect(r).toMatchObject({ applied: 6, unapplied: 8.4 });
    expect(await row(inv.id)).toMatchObject({ status: 'paid' });
    expect(await row(r.creditNote.id)).toMatchObject({ status: 'partial' });
    // Le retour ne rend pas la quantité à facturer.
    expect((await p().query(
      `SELECT dni.qty_invoiced::float8 AS q FROM invoice_items ii JOIN delivery_note_items dni ON dni.id = ii.delivery_note_item_id WHERE ii.id = $1`, [item])).rows[0].q).toBe(10);
    await expect(credits.create({ invoiceId: inv.id, reason: 'return', userId: fx.userId, date: D, lines: [{ invoiceItemId: item, quantity: 7 }] }))
      .rejects.toThrow(/reste créditable : 6/);

    // Crédit du client : situation et encours en tiennent compte.
    const situation = await receivables.customerSituation(ids.customer);
    expect(situation.unappliedCredits).toBe(8.4);
    const other = await notes.invoice({ deliveryNoteIds: [(await deliver(ids.customer, '2027-05-13')).id], invoiceDate: '2027-05-13', createdBy: fx.userId });
    const listed = await credits.forInvoice(other.id);
    expect(listed!.openCredits.map(c => c.id)).toContain(r.creditNote.id);
    const applied = await credits.apply({ creditNoteId: r.creditNote.id, invoiceId: other.id, userId: fx.userId });
    expect(applied).toEqual({ applied: 8.4, unapplied: 0 });
    expect(Number((await row(other.id)).paid_amount)).toBe(8.4);
    expect(await row(r.creditNote.id)).toMatchObject({ status: 'paid' });
    // L'imputation d'un avoir ne passe aucune écriture de trésorerie.
    const imputations = (await p().query(`SELECT id FROM payments WHERE credit_note_id = $1`, [r.creditNote.id])).rows;
    expect(imputations).toHaveLength(2);
    for (const pay of imputations) expect(await ledger(pay.id)).toEqual([]);
  });

  it('avoir de prix (7129) borné par le montant facturé ; annulation refusée après un avoir partiel ; relevé', async () => {
    const inv = await notes.invoice({ deliveryNoteIds: [(await deliver(ids.customer, '2027-05-14')).id], invoiceDate: '2027-05-14', createdBy: fx.userId });
    const item = (await p().query(`SELECT id FROM invoice_items WHERE invoice_id = $1`, [inv.id])).rows[0].id;
    await expect(credits.create({ invoiceId: inv.id, reason: 'price', userId: fx.userId, date: D, lines: [{ invoiceItemId: item, amount: 31 }] }))
      .rejects.toThrow(/reste créditable : 30,00|reste créditable : 30.00/);
    const r = await credits.create({ invoiceId: inv.id, reason: 'price', userId: fx.userId, date: '2027-05-15', lines: [{ invoiceItemId: item, amount: 5 }] });
    expect(Number((await row(r.creditNote.id)).total_amount)).toBe(6);
    expect((await ledger(r.creditNote.id)).find(l => l.code === '7129')).toMatchObject({ d: 5 });
    await expect(credits.create({ invoiceId: inv.id, reason: 'cancellation', userId: fx.userId, date: D })).rejects.toThrow(/déjà créditée en partie/);

    // Relevé : l'avoir au crédit, son imputation n'est pas un second règlement.
    const st = await receivables.customerStatement(ids.customer, '2027-05-14', '2027-05-15');
    const kinds = st!.entries.map(e => `${e.kind}:${e.debit}:${e.credit}`);
    expect(kinds).toEqual(['invoice:36:0', 'credit_note:0:6']);
  });

  it('facturation planifiée : mois terminé pour un client mensuel, lendemain pour « à chaque livraison »', async () => {
    const lastMonth = (await p().query(
      `SELECT (date_trunc('month', (now() AT TIME ZONE 'Africa/Casablanca')::date) - interval '10 days')::date::text AS d,
              ((now() AT TIME ZONE 'Africa/Casablanca')::date - 1)::text AS y,
              (now() AT TIME ZONE 'Africa/Casablanca')::date::text AS t`)).rows[0];
    const monthly = await deliver(ids.customer, lastMonth.d);
    const thisMonth = await deliver(ids.customer, lastMonth.t);
    const r1 = await scheduler.monthlyInvoicing({ customerId: ids.customer });
    expect(r1.items).toBe(1);
    const dn = (await p().query(
      `SELECT dn.id, dn.status, i.invoice_date::text AS d FROM delivery_notes dn LEFT JOIN invoices i ON i.id = dn.invoice_id WHERE dn.id = ANY($1)`,
      [[monthly.id, thisMonth.id]])).rows;
    const m = dn.find(x => x.id === monthly.id)!;
    expect(m.status).toBe('invoiced');
    // Daté du dernier jour du mois livré (ou d'aujourd'hui si la période est verrouillée).
    expect([lastMonth.t, (await p().query(`SELECT (date_trunc('month', $1::date) + interval '1 month - 1 day')::date::text AS d`, [lastMonth.d])).rows[0].d]).toContain(m.d);
    expect(dn.find(x => x.id === thisMonth.id)!.status).toBe('delivered');

    const yesterday = await deliver(ids.perDelivery, lastMonth.y);
    await deliver(ids.perDelivery, lastMonth.t);
    const r2 = await scheduler.monthlyInvoicing({ customerId: ids.perDelivery });
    expect(r2.items).toBe(1);
    expect((await p().query(`SELECT status FROM delivery_notes WHERE id = $1`, [yesterday.id])).rows[0].status).toBe('invoiced');
  });
});
