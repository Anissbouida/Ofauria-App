/**
 * Lot Bonus 15 (mig 435) — intégration base migrée.
 *
 * Budget : magasin et compte de charge créés pour le test (aucune autre suite
 * n'y écrit) ; budget 2027 de 100 par mois, réel 500 en mars, BC envoyé de 400
 * non reçu → disponible annuel 300, cumulé à juin −300.
 *
 * Effets : facture client 3 000 réglée par deux traites (1 000 et 1 200) et un
 * chèque (800), en 2027. Les traites sont escomptées (agios 30, commissions 10,
 * TVA 2), le chèque remis à l'encaissement ; la 1re traite est payée à
 * l'échéance, la 2de revient impayée avec 15 de frais.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Budgets et portefeuille d\'effets', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let mgmt: typeof import('../../repositories/management.repository.js').managementRepository;
  let bills: typeof import('../../repositories/bill-portfolio.repository.js').billPortfolioRepository;
  let invoices: typeof import('../../repositories/accounting.repository.js').invoiceRepository;
  let payments: typeof import('../../repositories/accounting.repository.js').paymentRepository;
  let manual: typeof import('../../repositories/manual-entry.repository.js').manualEntryRepository;
  let actor: { userId: string; storeId: string | null };
  const ids: Record<string, string> = {};
  const p = () => testPool();

  const linesOf = (where: string, args: unknown[]) => p().query(
    `SELECT a.code, jel.debit::float8 AS d, jel.credit::float8 AS c, je.entry_date::text AS date, j.code AS journal
       FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id
       JOIN accounts a ON a.id = jel.account_id JOIN journals j ON j.id = je.journal_id
      WHERE ${where} ORDER BY je.created_at, jel.line_order`, args).then(r => r.rows as { code: string; d: number; c: number; date: string; journal: string }[]);

  beforeAll(async () => {
    repos = await importRepositories();
    mgmt = (await import('../../repositories/management.repository.js')).managementRepository;
    bills = (await import('../../repositories/bill-portfolio.repository.js')).billPortfolioRepository;
    ({ invoiceRepository: invoices, paymentRepository: payments } = await import('../../repositories/accounting.repository.js'));
    manual = (await import('../../repositories/manual-entry.repository.js')).manualEntryRepository;
    actor = { userId: (await p().query(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`)).rows[0].id, storeId: null };
    ids.store = (await p().query(`INSERT INTO stores (name, city) VALUES ($1, 'Test') RETURNING id`, [`Budget ${RUN}`])).rows[0].id;
    const code = `613${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
    ids.account = (await p().query(
      `INSERT INTO accounts (code, label, account_class, rubrique, poste, account_type, normal_side)
       VALUES ($1, $2, 6, '61', '613', 'expense', 'D') RETURNING id`, [code, `Charge budget ${RUN}`])).rows[0].id;
    ids.category = (await p().query(`INSERT INTO expense_categories (name, account_id) VALUES ($1, $2) RETURNING id`, [`Catégorie budget ${RUN}`, ids.account])).rows[0].id;
    ids.bank = (await p().query(`SELECT id FROM treasury_accounts WHERE kind = 'bank' AND is_active ORDER BY is_default DESC LIMIT 1`)).rows[0].id;
    ids.customer = (await p().query(`INSERT INTO customers (company_name, first_name, last_name) VALUES ($1, 'Client', 'Effets') RETURNING id`, [`Client effets ${RUN}`])).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('contrôle budgétaire : réel, engagé d\'un BC envoyé et verdict selon la période', async () => {
    const budget = (await p().query(
      `INSERT INTO budgets (fiscal_year, store_id, name, status, control_action, control_period) VALUES (2027, $1, $2, 'approved', 'warn', 'annual') RETURNING id`,
      [ids.store, `Budget ${RUN}`])).rows[0].id;
    for (let m = 1; m <= 12; m++) await p().query(`INSERT INTO budget_lines (budget_id, account_id, month, amount) VALUES ($1, $2, $3, 100)`, [budget, ids.account, m]);
    const acc = (await p().query(`SELECT id FROM accounts WHERE code = '5141'`)).rows[0].id;
    await manual.createAndPost({ journalCode: 'OD', date: '2027-03-10', description: `Réel budget ${RUN}`, lines: [
      { accountId: ids.account, debit: 500, credit: 0 }, { accountId: acc, debit: 0, credit: 500 },
    ] }, { userId: actor.userId, storeId: ids.store });
    const supplier = (await p().query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`Fournisseur budget ${RUN}`])).rows[0].id;
    const po = (await p().query(
      `INSERT INTO purchase_orders (order_number, supplier_id, status, order_date, store_id, created_by)
       VALUES ($1, $2, 'en_attente', '2027-04-02', $3, $4) RETURNING id`, [`BC-T-${RUN}`, supplier, ids.store, actor.userId])).rows[0].id;
    await p().query(
      `INSERT INTO purchase_order_items (purchase_order_id, quantity_ordered, unit_price, category_id, description, line_type)
       VALUES ($1, 4, 100, $2, 'Location matériel', 'service')`, [po, ids.category]);
    await p().query(`UPDATE purchase_orders SET status = 'envoye' WHERE id = $1`, [po]);

    const amounts = await mgmt.purchaseOrderAmounts(po);
    expect(amounts.request.get(ids.account)).toBeCloseTo(400, 2);

    const one = (amount: number) => new Map([[ids.account, amount]]);
    const ok = await mgmt.budgetControl({ date: '2027-06-15', storeId: ids.store, request: one(300) });
    expect(ok.outcome).toBe('ok');
    expect(ok.lines[0]).toMatchObject({ budget: 1200, actual: 500, committed: 400, available: 300 });
    const warn = await mgmt.budgetControl({ date: '2027-06-15', storeId: ids.store, request: one(301) });
    expect(warn).toMatchObject({ outcome: 'warn', lines: [{ exceeded: 1 }] });
    // Le BC contrôlé lui-même n'est pas compté deux fois.
    const self = await mgmt.budgetControl({ date: '2027-06-15', storeId: ids.store, request: amounts.request, excludePurchaseOrderId: po });
    expect(self.lines[0]).toMatchObject({ committed: 0, request: 400, available: 700, exceeded: 0 });

    await mgmt.setControl(budget, { action: 'block', period: 'cumulative' });
    const block = await mgmt.budgetControl({ date: '2027-06-15', storeId: ids.store, request: one(10) });
    expect(block).toMatchObject({ outcome: 'block', lines: [{ budget: 600, actual: 500, committed: 400, available: -300, exceeded: 10 }] });

    // BC facturé en entier : l'engagé disparaît (la charge passe au réel par la facture).
    const inv = (await p().query(
      `INSERT INTO invoices (invoice_number, invoice_date, amount, tax_amount, total_amount, invoice_type, supplier_id, purchase_order_id)
       VALUES ($1, '2027-06-01', 400, 0, 400, 'received', $2, $3) RETURNING id`, [`FF-B-${RUN}`, supplier, po])).rows[0].id;
    await p().query(`INSERT INTO invoice_purchase_orders (invoice_id, purchase_order_id) VALUES ($1, $2)`, [inv, po]);
    const after = await mgmt.budgetControl({ date: '2027-06-15', storeId: ids.store, request: one(10) });
    expect(after.lines[0].committed).toBe(0);

    const cmp = await mgmt.comparison(2027, ids.store);
    const row = cmp.rows.find(r => r.id === ids.account)!;
    expect(row).toMatchObject({ budget_year: 1200, actual_year: 500, committed: 0, available: 700 });
  }, 60_000);

  it('portefeuille d\'effets : escompte, encaissement, échéance et impayé', async () => {
    const inv = await invoices.create({ invoiceType: 'emitted', customerId: ids.customer, invoiceDate: '2027-05-02', amount: 3000, taxAmount: 0,
      totalAmount: 3000, createdBy: actor.userId });
    const pay = (method: 'traite' | 'check', amount: number, n: number, due: string) => payments.create({
      type: 'income', invoiceId: inv.id, amount, paymentMethod: method, paymentDate: '2027-05-10', checkNumber: `${method === 'traite' ? 'LCR' : 'CHQ'}-${n}-${RUN}`,
      checkDate: due, reference: `EFF-${n}-${RUN}`, createdBy: actor.userId,
    });
    const t1 = await pay('traite', 1000, 1, '2027-07-31'), t2 = await pay('traite', 1200, 2, '2027-08-31'), c1 = await pay('check', 800, 3, '2027-05-10');
    expect((await linesOf(`je.source_id = $1 AND je.source_kind = 'payment'`, [t1.id])).map(l => [l.code, l.d, l.c])).toEqual([['5113', 1000, 0], ['3421', 0, 1000]]);

    const list0 = await bills.list({ status: 'portfolio' });
    expect(list0.effects.filter(e => [t1.id, t2.id, c1.id].includes((e as unknown as { id: string }).id))).toHaveLength(3);

    await expect(bills.createRemittance({ kind: 'discount', treasuryAccountId: ids.bank, date: '2027-05-15', paymentIds: [t1.id, c1.id], userId: actor.userId, storeId: null }))
      .rejects.toThrow(/Seules les traites s'escomptent/);
    const disc = await bills.createRemittance({ kind: 'discount', treasuryAccountId: ids.bank, date: '2027-05-15', paymentIds: [t1.id, t2.id],
      interest: 30, commission: 10, commissionVat: 2, userId: actor.userId, storeId: null });
    expect(disc).toMatchObject({ gross_amount: 2200, net_amount: 2158 });
    expect((await linesOf(`je.entry_number = $1`, [disc.entry_number])).map(l => [l.code, l.d, l.c, l.journal])).toEqual([
      ['5141', 2158, 0, 'BQ'], ['6311', 30, 0, 'BQ'], ['6147', 10, 0, 'BQ'], ['34552', 2, 0, 'BQ'], ['5520', 0, 2200, 'BQ'],
    ]);
    await expect(bills.createRemittance({ kind: 'collection', treasuryAccountId: ids.bank, date: '2027-05-16', paymentIds: [t1.id], userId: actor.userId, storeId: null }))
      .rejects.toThrow(/plus en portefeuille/);

    const coll = await bills.createRemittance({ kind: 'collection', treasuryAccountId: ids.bank, date: '2027-05-16', paymentIds: [c1.id], userId: actor.userId, storeId: null });
    expect(coll.entry_number).toBeNull();
    expect(await bills.settleRemittance(coll.id, { date: '2027-05-20', userId: actor.userId })).toEqual({ settled: 1 });
    expect((await linesOf(`je.source_id = $1 AND je.source_detail = 'cashing' AND je.status = 'posted'`, [c1.id])).map(l => [l.code, l.d, l.c]))
      .toEqual([['5141', 800, 0], ['5111', 0, 800]]);

    // Échéance de la 1re traite escomptée : dénouement du crédit d'escompte, sans mouvement de banque.
    await payments.markCashed(t1.id, { cashedAt: '2027-07-31', cashedBy: actor.userId });
    expect((await linesOf(`je.source_id = $1 AND je.source_detail = 'cashing' AND je.status = 'posted'`, [t1.id])).map(l => [l.code, l.d, l.c, l.journal]))
      .toEqual([['5520', 1000, 0, 'OD'], ['5113', 0, 1000, 'OD']]);

    // 2de traite impayée : règlement annulé, facture de nouveau due, banque reprend nominal et frais.
    const u = await bills.markUnpaid(t2.id, { date: '2027-08-31', fees: 15, note: null, userId: actor.userId });
    expect((await linesOf(`je.entry_number = $1`, [u.entry_number])).map(l => [l.code, l.d, l.c])).toEqual([['5520', 1200, 0], ['6147', 15, 0], ['5141', 0, 1215]]);
    const invRow = (await p().query(`SELECT paid_amount::float8 AS paid FROM invoices WHERE id = $1`, [inv.id])).rows[0];
    expect(invRow.paid).toBeCloseTo(1800, 2);
    const extourne = await linesOf(
      `je.reversal_of_entry_id IN (SELECT id FROM journal_entries WHERE source_id = $1 AND source_kind = 'payment')`, [t2.id]);
    expect(extourne.map(l => [l.code, l.d, l.c]).sort()).toEqual([['3421', 1200, 0], ['5113', 0, 1200]]);
    await expect(bills.markUnpaid(t2.id, { date: '2027-09-01', fees: 0, userId: actor.userId })).rejects.toThrow(/déjà déclaré impayé/);

    // Soldes : 5520 et 5113 reviennent à zéro sur nos effets.
    const net = async (code: string) => (await p().query(
      `SELECT COALESCE(sum(jel.debit - jel.credit), 0)::float8 AS s FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id JOIN accounts a ON a.id = jel.account_id
        WHERE a.code = $1 AND je.status IN ('posted', 'reversed')
          AND (je.source_id = ANY($2::uuid[]) OR je.source_detail IN ($3, $4))`,
      [code, [t1.id, t2.id, c1.id], `bill:discount:${disc.id}`, `bill:unpaid:${t2.id}`])).rows[0].s;
    expect(await net('5520')).toBeCloseTo(0, 2);
    expect(await net('5113')).toBeCloseTo(0, 2);

    await expect(bills.cancelRemittance(disc.id, { userId: actor.userId })).rejects.toThrow(/déjà encaissé/);
    const statuses = (await bills.list({ status: 'all' })).effects.filter(e => [t1.id, t2.id, c1.id].includes((e as unknown as { id: string }).id))
      .map(e => (e as unknown as { id: string; status: string }).status).sort();
    expect(statuses).toEqual(['cashed', 'cashed', 'unpaid']);
  }, 60_000);

  it('annulation d\'un bordereau d\'escompte : extourne et retour en portefeuille', async () => {
    const inv = await invoices.create({ invoiceType: 'emitted', customerId: ids.customer, invoiceDate: '2027-06-02', amount: 500, taxAmount: 0,
      totalAmount: 500, createdBy: actor.userId });
    const t = await payments.create({ type: 'income', invoiceId: inv.id, amount: 500, paymentMethod: 'traite', paymentDate: '2027-06-05',
      checkNumber: `LCR-9-${RUN}`, checkDate: '2027-09-30', createdBy: actor.userId });
    const disc = await bills.createRemittance({ kind: 'discount', treasuryAccountId: ids.bank, date: '2027-06-06', paymentIds: [t.id], interest: 5, userId: actor.userId, storeId: null });
    await bills.cancelRemittance(disc.id, { userId: actor.userId });
    const st = (await p().query(
      `SELECT je.status, (SELECT count(*)::int FROM journal_entries x WHERE x.reversal_of_entry_id = je.id) AS rev
         FROM journal_entries je WHERE je.entry_number = $1`, [disc.entry_number])).rows[0];
    expect(st.status).toBe('reversed');
    expect((await p().query(`SELECT remittance_id FROM payments WHERE id = $1`, [t.id])).rows[0].remittance_id).toBeNull();
    // Encaissé hors bordereau : crédit bancaire direct (5141 / 5113).
    await payments.markCashed(t.id, { cashedAt: '2027-09-30', cashedBy: actor.userId });
    expect((await linesOf(`je.source_id = $1 AND je.source_detail = 'cashing' AND je.status = 'posted'`, [t.id])).map(l => [l.code, l.d, l.c]))
      .toEqual([['5141', 500, 0], ['5113', 0, 500]]);
  }, 60_000);
});
