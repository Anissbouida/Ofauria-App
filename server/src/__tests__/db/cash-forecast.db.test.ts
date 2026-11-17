/**
 * G4-03 — prévision de trésorerie.
 * Sur une date de départ propre au test (en 2031, sans autre flux que ceux posés ici) :
 *  - une créance client de 1 000 DH à échéance J+10 est attendue à J+10, à J+25 avec un
 *    scénario de retard de 15 jours ;
 *  - une facture fournisseur de 400 DH à J+5 sort à J+5, ou à la date simulée d'une
 *    campagne de paiement (lien G4-01) ;
 *  - une ligne manuelle (emprunt de 5 000 DH à J+20) entre à sa date ;
 *  - le solde jour par jour suit : ouverture + flux cumulés ; la semaine porte le détail
 *    par catégorie ; le minimum et le passage sous le seuil sont repérés.
 * Les autres sources réelles de la base de test (salaires, autres factures…) ajoutent leurs
 * flux : le test raisonne en écarts entre deux prévisions, pas en totaux absolus.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Prévision de trésorerie (G4-03)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let fc: typeof import('../../services/cash-forecast.js');
  let actor: string, customer: string, supplier: string, recv: string, pay: string, lineId: string;
  const from = '2031-03-03';
  const day = (n: number) => { const d = new Date(`${from}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const p = () => testPool();
  const flowsOf = (r: Awaited<ReturnType<typeof fc.cashForecast>>, ref: string) => r.flows.filter(f => f.ref === ref);

  beforeAll(async () => {
    repos = await importRepositories();
    fc = await import('../../services/cash-forecast.js');
    actor = (await p().query(`SELECT id FROM users WHERE role = 'admin' AND NOT is_system ORDER BY created_at LIMIT 1`)).rows[0].id;
    customer = (await p().query(`INSERT INTO customers (first_name, last_name) VALUES ('Client', $1) RETURNING id`, [`G403 ${RUN}`])).rows[0].id;
    supplier = (await p().query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`Fournisseur G403 ${RUN}`])).rows[0].id;
    recv = (await p().query(
      `INSERT INTO invoices (invoice_number, invoice_type, customer_id, invoice_date, due_date, amount, total_amount, status)
       VALUES ($1, 'emitted', $2, $3, $4, 1000, 1000, 'pending') RETURNING invoice_number`, [`FV-G403-${RUN}`, customer, from, day(10)])).rows[0].invoice_number;
    pay = (await p().query(
      `INSERT INTO invoices (invoice_number, invoice_type, supplier_id, invoice_date, due_date, amount, total_amount, status, validation_status)
       VALUES ($1, 'received', $2, $3, $4, 400, 400, 'pending', 'validated') RETURNING invoice_number`, [`FA-G403-${RUN}`, supplier, from, day(5)])).rows[0].invoice_number;
    lineId = (await fc.cashForecastLines.create({ flowDate: day(20), label: `Emprunt G403 ${RUN}`, amount: 5000, category: 'emprunt' }, actor)).id;
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM cash_forecast_lines WHERE id = $1`, [lineId]).catch(() => undefined);
    await p().query(`DELETE FROM invoices WHERE invoice_number = ANY($1)`, [[recv, pay]]).catch(() => undefined);
    await p().query(`DELETE FROM customers WHERE id = $1`, [customer]).catch(() => undefined);
    await p().query(`DELETE FROM suppliers WHERE id = $1`, [supplier]).catch(() => undefined);
    await fc.cashForecastLines.setThreshold(0, actor).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('chaque source à sa date, 13 semaines, solde = ouverture + flux cumulés', async () => {
    const r = await fc.cashForecast({ from });
    expect(r.days).toHaveLength(91);
    expect(r.weeks).toHaveLength(13);
    expect(flowsOf(r, recv)).toEqual([expect.objectContaining({ date: day(10), amount: 1000, category: 'clients' })]);
    expect(flowsOf(r, pay)).toEqual([expect.objectContaining({ date: day(5), amount: -400, category: 'fournisseurs' })]);
    expect(flowsOf(r, lineId)).toEqual([expect.objectContaining({ date: day(20), amount: 5000, category: 'manuel' })]);
    // Cohérence du solde : le dernier jour = ouverture + somme de tous les flux.
    const total = r.flows.reduce((t, f) => t + f.amount, 0);
    expect(r.days[90].balance).toBeCloseTo(r.opening + total, 2);
    // La semaine 1 (J à J+6) contient la facture fournisseur dans sa catégorie.
    expect(r.weeks[0].byCategory.fournisseurs).toBeLessThanOrEqual(-400);
    expect(r.minimum.balance).toBe(Math.min(...r.days.map(d => d.balance)));
  });

  it('scénario : les clients paient 15 jours plus tard', async () => {
    const r = await fc.cashForecast({ from, customerDelayDays: 15 });
    expect(flowsOf(r, recv)[0].date).toBe(day(25));
    expect(r.customerDelayDays).toBe(15);
  });

  it('simulation G4-01 : la facture choisie sort à la date de la campagne', async () => {
    const id = (await p().query(`SELECT id FROM invoices WHERE invoice_number = $1`, [pay])).rows[0].id;
    const base = await fc.cashForecast({ from });
    const sim = await fc.cashForecast({ from, planned: { date: day(30), invoiceIds: [id] } });
    expect(flowsOf(sim, pay)[0].date).toBe(day(30));
    // Entre J+5 et J+29, le solde simulé est supérieur de 400 DH ; ensuite, identique.
    expect(sim.days[10].balance - base.days[10].balance).toBeCloseTo(400, 2);
    expect(sim.days[40].balance - base.days[40].balance).toBeCloseTo(0, 2);
  });

  it('seuil d\'alerte : premier jour sous le seuil repéré', async () => {
    const base = await fc.cashForecast({ from });
    await fc.cashForecastLines.setThreshold(base.minimum.balance + 1, actor);
    const r = await fc.cashForecast({ from });
    expect(r.threshold).toBeCloseTo(base.minimum.balance + 1, 2);
    expect(r.firstBelowThreshold).not.toBeNull();
    expect(r.firstBelowThreshold!.balance).toBeLessThan(r.threshold);
  });
});
