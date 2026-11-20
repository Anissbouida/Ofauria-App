/**
 * Scénario 1, constat 81 — « Éditer les lignes » d'une facture fournisseur.
 *  - une ligne existante renvoyée avec son id est mise à jour sur place : même id, liens vers
 *    la ligne de BC, la ligne de réception et la catégorie conservés (avant : tout était effacé
 *    puis réinséré sans liens, le rapprochement perdait la ligne) ;
 *  - une ligne absente du payload est supprimée, une ligne nouvelle est créée ;
 *  - un id étranger à la facture ne touche pas l'autre facture : la ligne est créée à neuf.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Édition des lignes de facture : liens conservés', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let invoices: typeof import('../../repositories/accounting.repository.js').invoiceRepository;
  let fx: Fixtures;
  let supplierId = '', categoryId = '';
  const poIds: string[] = [], invoiceIds: string[] = [];
  const p = () => testPool();
  const today = new Date().toISOString().slice(0, 10);

  const setup = async (tag: string) => {
    const ing = await createIngredient(fx, { name: `Sucre ${tag}`, unit: 'kg', unitCost: 5 });
    const po = (await p().query(
      `INSERT INTO purchase_orders (order_number, supplier_id, store_id, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id`, [`BC-EDL-${tag}-${RUN}`, supplierId, fx.storeId, fx.userId])).rows[0].id;
    poIds.push(po);
    const poi = (await p().query(
      `INSERT INTO purchase_order_items (purchase_order_id, ingredient_id, quantity_ordered, unit_price)
       VALUES ($1, $2, 90, 5) RETURNING id`, [po, ing])).rows[0].id;
    await p().query(`UPDATE purchase_orders SET status = 'livre_complet' WHERE id = $1`, [po]);
    const rv = (await p().query(
      `INSERT INTO reception_vouchers (voucher_number, purchase_order_id, store_id, received_by)
       VALUES ($1, $2, $3, $4) RETURNING id`, [`BR-EDL-${tag}-${RUN}`, po, fx.storeId, fx.userId])).rows[0].id;
    const rvi = (await p().query(
      `INSERT INTO reception_voucher_items (reception_voucher_id, purchase_order_item_id, ingredient_id, quantity_received, unit_price)
       VALUES ($1, $2, $3, 90, 5) RETURNING id`, [rv, poi, ing])).rows[0].id;
    const inv = await invoices.create({
      invoiceType: 'received', supplierId, categoryId, invoiceDate: today, amount: 450, taxAmount: 0, totalAmount: 450,
      createdBy: fx.userId, storeId: fx.storeId, notes: `EDL ${tag} ${RUN}`,
    } as never);
    invoiceIds.push(inv.id);
    await p().query(`UPDATE invoices SET purchase_order_id = $2 WHERE id = $1`, [inv.id, po]);
    const line = (await p().query(
      `INSERT INTO invoice_items (invoice_id, ingredient_id, description, quantity, unit_price, subtotal,
                                  purchase_order_item_id, reception_voucher_item_id, category_id)
       VALUES ($1, $2, 'Sucre semoule', 90, 5, 450, $3, $4, $5) RETURNING id`, [inv.id, ing, poi, rvi, categoryId])).rows[0].id;
    return { ing, poi, rvi, invId: inv.id as string, line: line as string };
  };

  const lines = async (invId: string) => (await p().query(
    `SELECT id, description, quantity::float, unit_price::float, purchase_order_item_id, reception_voucher_item_id, category_id
       FROM invoice_items WHERE invoice_id = $1 ORDER BY created_at, id`, [invId])).rows;

  beforeAll(async () => {
    repos = await importRepositories();
    invoices = (await import('../../repositories/accounting.repository.js')).invoiceRepository;
    fx = await createBaseFixtures();
    supplierId = (await p().query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`Fournisseur EDL ${RUN}`])).rows[0].id;
    categoryId = (await p().query(
      `SELECT ec.id FROM expense_categories ec JOIN accounts a ON a.id = ec.account_id WHERE a.code LIKE '61%' ORDER BY a.code LIMIT 1`)).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    const run = async (sql: string, params: unknown[]) => { try { await p().query(sql, params); } catch { /* best effort */ } };
    await run(`DELETE FROM po_line_events WHERE po_line_id IN (SELECT id FROM purchase_order_items WHERE purchase_order_id = ANY($1::uuid[]))`, [poIds]);
    await run(`DELETE FROM invoice_items WHERE invoice_id = ANY($1::uuid[])`, [invoiceIds]);
    await run(`DELETE FROM invoices WHERE id = ANY($1::uuid[])`, [invoiceIds]);
    await run(`DELETE FROM reception_voucher_items WHERE reception_voucher_id IN (SELECT id FROM reception_vouchers WHERE purchase_order_id = ANY($1::uuid[]))`, [poIds]);
    await run(`DELETE FROM reception_vouchers WHERE purchase_order_id = ANY($1::uuid[])`, [poIds]);
    await run(`DELETE FROM purchase_order_items WHERE purchase_order_id = ANY($1::uuid[])`, [poIds]);
    await run(`DELETE FROM purchase_orders WHERE id = ANY($1::uuid[])`, [poIds]);
    await run(`DELETE FROM suppliers WHERE id = $1`, [supplierId]);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('ligne existante corrigée : même id, liens BC/réception/catégorie conservés', async () => {
    const s = await setup('A');
    await invoices.replaceItems(s.invId, [
      { id: s.line, ingredientId: s.ing, description: 'Sucre semoule', quantity: 90, unitPrice: 5.5, subtotal: 495 },
    ]);
    const after = await lines(s.invId);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(s.line);
    expect(after[0].unit_price).toBeCloseTo(5.5, 4);
    expect(after[0].purchase_order_item_id).toBe(s.poi);
    expect(after[0].reception_voucher_item_id).toBe(s.rvi);
    expect(after[0].category_id).toBe(categoryId);
  });

  it('ligne retirée supprimée, ligne ajoutée créée, ligne gardée intacte', async () => {
    const s = await setup('B');
    const extra = (await p().query(
      `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, subtotal) VALUES ($1, 'Transport', 1, 30, 30) RETURNING id`,
      [s.invId])).rows[0].id;
    await invoices.replaceItems(s.invId, [
      { id: s.line, ingredientId: s.ing, description: 'Sucre semoule', quantity: 90, unitPrice: 5, subtotal: 450 },
      { ingredientId: null, description: 'Palette consignée', quantity: 1, unitPrice: 12, subtotal: 12 },
    ]);
    const after = await lines(s.invId);
    expect(after.map(l => l.id)).not.toContain(extra);
    expect(after).toHaveLength(2);
    const kept = after.find(l => l.id === s.line)!;
    expect(kept.purchase_order_item_id).toBe(s.poi);
    expect(kept.reception_voucher_item_id).toBe(s.rvi);
    const added = after.find(l => l.id !== s.line)!;
    expect(added.description).toBe('Palette consignée');
    expect(added.purchase_order_item_id).toBeNull();
  });

  it('id d\'une ligne d\'une autre facture : l\'autre facture n\'est pas touchée', async () => {
    const a = await setup('C1');
    const b = await setup('C2');
    await invoices.replaceItems(a.invId, [
      { id: b.line, ingredientId: a.ing, description: 'Intrus', quantity: 1, unitPrice: 1, subtotal: 1 },
    ]);
    const other = await lines(b.invId);
    expect(other).toHaveLength(1);
    expect(other[0].description).toBe('Sucre semoule');
    expect(other[0].unit_price).toBeCloseTo(5, 4);
    const mine = await lines(a.invId);
    expect(mine).toHaveLength(1);
    expect(mine[0].id).not.toBe(b.line);
    expect(mine[0].description).toBe('Intrus');
  });
});
