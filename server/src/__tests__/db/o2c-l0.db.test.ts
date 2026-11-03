/**
 * Cycle de vente (O2C), lot L0 (mig 439) — intégration base migrée.
 * docs/AUDIT_O2C_GAP_ANALYSIS.md § 4.2 : types de mouvements, facture client
 * validée figée, numéro imposé, annulation d'une facture réglée, remise de
 * commande atomique.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('O2C L0 — correctifs bloquants', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let invoices: typeof import('../../repositories/accounting.repository.js').invoiceRepository;
  let payments: typeof import('../../repositories/accounting.repository.js').paymentRepository;
  let sales: typeof import('../../repositories/sale.repository.js').saleRepository;
  let fx: Fixtures;
  const ids: Record<string, string> = {};
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    ({ invoiceRepository: invoices, paymentRepository: payments } = await import('../../repositories/accounting.repository.js'));
    sales = (await import('../../repositories/sale.repository.js')).saleRepository;
    fx = await createBaseFixtures();
    ids.customer = (await p().query(`INSERT INTO customers (company_name, first_name, last_name, customer_type) VALUES ($1, 'Client', 'O2C', 'professionnel') RETURNING id`, [`Client O2C ${RUN}`])).rows[0].id;
    ids.product = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1, $2, 10) RETURNING id`, [`Pain O2C ${RUN}`, `pain-o2c-${RUN}`])).rows[0].id;
    fx.ids.products.push(ids.product);
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('types de mouvements : adjustment et unsold_return acceptés, adjust refusé', async () => {
    const c = await p().connect();
    try {
      await c.query('BEGIN');
      for (const type of ['adjustment', 'unsold_return', 'delivery', 'delivery_reversal']) {
        await c.query(`INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, store_id) VALUES ($1, $2, 1, 1, $3)`, [ids.product, type, fx.storeId]);
      }
      await c.query('SAVEPOINT s');
      await expect(c.query(`INSERT INTO product_stock_transactions (product_id, type, quantity_change, stock_after, store_id) VALUES ($1, 'adjust', 1, 1, $2)`, [ids.product, fx.storeId]))
        .rejects.toThrow(/product_stock_transactions_type_check/);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });

  it('facture client validée : numéro de la série, en-tête et lignes figés, notes et échéance libres', async () => {
    const inv = await invoices.create({
      invoiceType: 'emitted', invoiceNumber: `PIRATE-${RUN}`, customerId: ids.customer, invoiceDate: '2027-04-02',
      amount: 100, taxAmount: 0, totalAmount: 100, createdBy: fx.userId,
      // Prestation : une facture directe de marchandises est refusée (O2C L4, depuis le BL).
      items: [{ description: 'Prestation de livraison', quantity: 10, unitPrice: 10, subtotal: 100 }],
    });
    ids.invoice = inv.id;
    expect(inv.invoice_number).not.toBe(`PIRATE-${RUN}`);
    expect(inv.validation_status).toBe('validated');

    await expect(invoices.update(inv.id, { amount: 120 })).rejects.toMatchObject({ statusCode: 409, code: 'INVOICE_LOCKED' });
    await expect(invoices.update(inv.id, { invoiceDate: '2027-04-03' })).rejects.toMatchObject({ code: 'INVOICE_LOCKED' });
    await expect(invoices.replaceItems(inv.id, [{ productId: ids.product, quantity: 1, unitPrice: 10, subtotal: 10 }])).rejects.toThrow();
    const ok = await invoices.update(inv.id, { notes: `Note ${RUN}`, dueDate: '2027-05-02' });
    expect(ok?.notes ?? (await p().query(`SELECT notes FROM invoices WHERE id = $1`, [inv.id])).rows[0].notes).toBe(`Note ${RUN}`);

    // La base porte le même verrou, hors de l'application.
    await expect(p().query(`UPDATE invoices SET total_amount = 1 WHERE id = $1`, [inv.id])).rejects.toThrow(/validée/);
    await expect(p().query(`INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, subtotal) VALUES ($1, 'ajout', 1, 1, 1)`, [inv.id]))
      .rejects.toThrow(/non modifiables/);
    await expect(p().query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [inv.id])).rejects.toThrow(/non modifiables/);
    const lines = (await p().query(`SELECT count(*)::int AS n FROM invoice_items WHERE invoice_id = $1`, [inv.id])).rows[0].n;
    expect(lines).toBe(1);
  });

  it('facture client réglée : annulation refusée par la base', async () => {
    await payments.create({ type: 'income', invoiceId: ids.invoice, amount: 40, paymentMethod: 'cash', paymentDate: '2027-04-05', createdBy: fx.userId });
    await expect(p().query(`UPDATE invoices SET status = 'cancelled' WHERE id = $1`, [ids.invoice])).rejects.toThrow(/réglée/);
  });

  it('remise de commande atomique : la commande passe « remise » avec le ticket, une seule fois', async () => {
    const order = (await p().query(
      `INSERT INTO orders (order_number, user_id, type, status, subtotal, total, store_id)
       VALUES ($1, $2, 'custom', 'ready', 10, 10, $3) RETURNING id`, [`O2C-${RUN}`.slice(0, 20), fx.userId, fx.storeId])).rows[0].id;
    const sale = () => sales.create({
      userId: fx.userId, storeId: fx.storeId, subtotal: 10, taxAmount: 0, discountAmount: 0, total: 10, paymentMethod: 'cash',
      items: [{ productId: ids.product, quantity: 1, unitPrice: 10, subtotal: 10 }], orderId: order, completeOrder: true, skipStockDeduction: true,
    });
    const [a, b] = await Promise.allSettled([sale(), sale()]);
    const ok = [a, b].filter(r => r.status === 'fulfilled');
    const ko = [a, b].filter(r => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(1);
    expect(ko[0].reason).toMatchObject({ statusCode: 409 });
    expect(String(ko[0].reason.message)).toMatch(/déjà remise/);
    const row = (await p().query(`SELECT status, completed_at FROM orders WHERE id = $1`, [order])).rows[0];
    expect(row.status).toBe('completed');
    expect(row.completed_at).not.toBeNull();
    expect((await p().query(`SELECT count(*)::int AS n FROM sales WHERE order_id = $1`, [order])).rows[0].n).toBe(1);
  });
});
