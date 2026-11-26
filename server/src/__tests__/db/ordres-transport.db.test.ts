/**
 * Ordres de transport (mig 726), sur une vraie base : prix par la grille du client, cycle
 * saisi → planifié (tournée) → enlevé → livré (preuve) → facturé une seule fois, annulation
 * refusée après l'enlèvement, tournée terminée refusée.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Ordres de transport', () => {
  let fx: Fixtures;
  let customerId = '';
  let gridId = '';
  let routeId = '';
  let doneRouteId = '';
  const orderIds: string[] = [];
  const invoiceIds: string[] = [];
  let repo: typeof import('../../repositories/transport-order.repository.js').transportOrderRepository;

  const input = (extra: Record<string, unknown> = {}) => ({
    customerId, pickupAddress: 'Entrepôt Ain Sebaa', deliveryAddress: 'Plateforme Tanger Med', originZone: `Casa-${RUN}`,
    destinationZone: 'Tanger', goodsDescription: '12 palettes de conserves', weightKg: 400, pricingBasis: 'weight' as const, ...extra,
  });

  beforeAll(async () => {
    fx = await createBaseFixtures();
    repo = (await import('../../repositories/transport-order.repository.js')).transportOrderRepository;
    const grids = (await import('../../repositories/freight-rate.repository.js')).freightRateRepository;
    const p = testPool();
    customerId = (await p.query(`INSERT INTO customers (first_name, last_name, company_name) VALUES ('Chargeur', $1, $2) RETURNING id`, [RUN, `Conserverie ${RUN}`])).rows[0].id;
    gridId = await grids.create({ name: `OT ${RUN}`, basis: 'weight', customerId, originZone: `Casa-${RUN}`, minimumCharge: 0, tvaRate: 14,
      brackets: [{ upTo: null, unitPrice: 1.5 }] }, fx.userId);
    routeId = (await p.query(`INSERT INTO delivery_routes (label, driver_name, vehicle_label, created_by) VALUES ($1, 'Karim', 'Camion 12 t', $2) RETURNING id`,
      [`Tournée ${RUN}`, fx.userId])).rows[0].id;
    doneRouteId = (await p.query(`INSERT INTO delivery_routes (label, status, created_by) VALUES ($1, 'done', $2) RETURNING id`,
      [`Tournée close ${RUN}`, fx.userId])).rows[0].id;
  });

  afterAll(async () => {
    const p = testPool();
    await p.query(`DELETE FROM transport_orders WHERE id = ANY($1::uuid[])`, [orderIds]);
    if (invoiceIds.length) {
      await p.query(`DELETE FROM invoice_items WHERE invoice_id = ANY($1::uuid[])`, [invoiceIds]).catch(() => undefined);
      await p.query(`DELETE FROM invoices WHERE id = ANY($1::uuid[])`, [invoiceIds]).catch(() => undefined);
    }
    await p.query(`DELETE FROM delivery_routes WHERE id = ANY($1::uuid[])`, [[routeId, doneRouteId].filter(Boolean)]);
    if (gridId) await p.query(`DELETE FROM freight_rate_grids WHERE id = $1`, [gridId]);
    if (customerId) await p.query(`DELETE FROM customers WHERE id = $1`, [customerId]).catch(() => undefined);
    await cleanupFixtures(fx);
    await closeTestPool();
  });

  it('la saisie numérote l’ordre et le chiffre par la grille du client', async () => {
    const o = await repo.create(input(), fx.userId);
    orderIds.push(o.id);
    expect(o.number).toMatch(/^OT-\d{4}-\d+/);
    expect(o.status).toBe('draft');
    expect(o.grid_id).toBe(gridId);
    expect(Number(o.amount_ht)).toBe(600);   // 400 kg × 1,5
    expect(Number(o.tax_amount)).toBe(84);   // TVA 14 %
    expect(o.customer_name).toBe(`Conserverie ${RUN}`);
  });

  it('sans grille couvrant le trajet, la saisie est refusée ; sans base, le prix saisi est gardé', async () => {
    await expect(repo.create(input({ originZone: 'Nulle-part' }), fx.userId)).rejects.toMatchObject({ statusCode: 422 });
    const manual = await repo.create(input({ pricingBasis: null, amountHt: 1000, tvaRate: 20 }), fx.userId);
    orderIds.push(manual.id);
    expect([Number(manual.amount_ht), Number(manual.tax_amount), Number(manual.total_ttc)]).toEqual([1000, 200, 1200]);
  });

  it('planifié sur une tournée, enlevé, livré avec preuve, puis facturé une seule fois', async () => {
    const id = orderIds[0];
    await expect(repo.pickup(id)).rejects.toMatchObject({ statusCode: 409 });       // pas encore planifié
    await expect(repo.plan(id, doneRouteId)).rejects.toMatchObject({ statusCode: 409 });
    const planned = await repo.plan(id, routeId);
    expect([planned.status, planned.route_label, planned.vehicle_label]).toEqual(['planned', `Tournée ${RUN}`, 'Camion 12 t']);
    await expect(repo.invoice(id, fx.userId)).rejects.toThrow(/preuve de livraison/);
    expect((await repo.pickup(id)).status).toBe('in_transit');
    await expect(repo.cancel(id)).rejects.toMatchObject({ statusCode: 409 });
    await expect(repo.update(id, input())).rejects.toMatchObject({ statusCode: 409 });
    await expect(repo.deliver(id, '  ')).rejects.toThrow(/réceptionné/);
    const delivered = await repo.deliver(id, 'M. Alaoui', 'Une palette abîmée');
    expect([delivered.status, delivered.pod_name]).toEqual(['delivered', 'M. Alaoui']);
    const billed = await repo.invoice(id, fx.userId);
    invoiceIds.push(billed.invoice_id);
    expect(billed.invoice_number).toBeTruthy();
    const inv = (await testPool().query(`SELECT amount, tax_amount, total_amount, customer_id FROM invoices WHERE id = $1`, [billed.invoice_id])).rows[0];
    expect([Number(inv.amount), Number(inv.tax_amount), Number(inv.total_amount), inv.customer_id]).toEqual([600, 84, 684, customerId]);
    await expect(repo.invoice(id, fx.userId)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('un ordre saisi s’annule et quitte sa tournée', async () => {
    const id = orderIds[1];
    await repo.plan(id, routeId);
    const c = await repo.cancel(id);
    expect([c.status, c.route_id]).toEqual(['cancelled', null]);
  });
});
