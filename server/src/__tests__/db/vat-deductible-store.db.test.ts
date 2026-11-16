/**
 * G0-17 — TVA déductible filtrée par établissement, comme la TVA collectée.
 * Deux établissements et une facture sans établissement : chaque établissement voit ses
 * factures et celles sans établissement ; la vue globale voit tout ; la somme des parts
 * propres aux deux établissements, plus la part sans établissement, égale le global.
 * Montants lus en écart par rapport à un relevé pris avant les factures du test.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

const PERIOD = { startDate: '2027-08-01', endDate: '2027-08-31' };
type Reading = { deductible: number; pending: number; pendingCount: number; excluded: number };

describe.skipIf(!hasTestDb)('TVA déductible par établissement (G0-17)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let ledger: typeof import('../../repositories/ledger.repository.js');
  let fx: Fixtures;
  let storeB: string, supplierId: string;
  const invoiceIds: string[] = [];
  const before = {} as Record<'a' | 'b' | 'all', Reading>;
  const p = () => testPool();
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const storeOf = (k: 'a' | 'b' | 'all') => (k === 'a' ? fx.storeId : k === 'b' ? storeB : undefined);

  const read = async (k: 'a' | 'b' | 'all'): Promise<Reading> => {
    const d = await ledger.tvaDeclarationRepository.declaration({ ...PERIOD, storeId: storeOf(k) });
    return {
      deductible: d.total_deductible, pending: d.pending_payment.amount, pendingCount: d.pending_payment.count,
      excluded: d.excluded.reduce((s: number, x: { amount: number }) => s + x.amount, 0),
    };
  };
  const delta = async (k: 'a' | 'b' | 'all') => {
    const now = await read(k);
    return {
      deductible: r2(now.deductible - before[k].deductible), pending: r2(now.pending - before[k].pending),
      pendingCount: now.pendingCount - before[k].pendingCount, excluded: r2(now.excluded - before[k].excluded),
    };
  };
  /** Facture fournisseur à 20 % ; recoverableFrom nul = non soldée (droit pas encore né). */
  const invoice = async (tag: string, storeId: string | null, tva: number, recoverableFrom: string | null, recoverable = true) => {
    const ht = tva * 5;
    const id = (await p().query(
      `INSERT INTO invoices (invoice_number, invoice_type, invoice_date, amount, tax_amount, total_amount, status, store_id, supplier_id,
                             is_vat_recoverable, vat_recoverable_from, vat_non_recoverable_reason)
       VALUES ($1, 'received', '2027-08-05', $2, $3, $4, 'pending', $5, $9, $6, $7, $8) RETURNING id`,
      [`G017-${tag}-${RUN}`, ht, tva, ht + tva, storeId, recoverable, recoverableFrom, recoverable ? null : 'manual', supplierId])).rows[0].id as string;
    invoiceIds.push(id);
    return id;
  };

  beforeAll(async () => {
    repos = await importRepositories();
    ledger = await import('../../repositories/ledger.repository.js');
    fx = await createBaseFixtures();
    storeB = (await p().query(`INSERT INTO stores (name, city) VALUES ($1, 'Test') RETURNING id`, [`Magasin B ${RUN}`])).rows[0].id;
    supplierId = (await p().query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`Fournisseur G017 ${RUN}`])).rows[0].id;
    for (const k of ['a', 'b', 'all'] as const) before[k] = await read(k);
    await invoice('A', fx.storeId, 20, '2027-08-10');           // établissement A, déductible
    await invoice('B', storeB, 10, '2027-08-12');               // établissement B, déductible
    await invoice('N', null, 5, '2027-08-15');                  // sans établissement, déductible
    await invoice('P', fx.storeId, 7, null);                    // A, non soldée : en attente
    await invoice('X', storeB, 3, '2027-08-20', false);         // B, non récupérable : exclue
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM invoices WHERE id = ANY($1)`, [invoiceIds]).catch(() => undefined);
    await p().query(`DELETE FROM suppliers WHERE id = $1`, [supplierId]).catch(() => undefined);
    await p().query(`DELETE FROM stores WHERE id = $1`, [storeB]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('chaque établissement voit ses factures et celles sans établissement', async () => {
    expect(await delta('a')).toEqual({ deductible: 25, pending: 7, pendingCount: 1, excluded: 0 });
    expect(await delta('b')).toEqual({ deductible: 15, pending: 0, pendingCount: 0, excluded: 3 });
  });

  it('la vue globale voit tout ; parts propres + part sans établissement = global', async () => {
    const [a, b, all] = [await delta('a'), await delta('b'), await delta('all')];
    expect(all).toEqual({ deductible: 35, pending: 7, pendingCount: 1, excluded: 3 });
    const shared = 5;                                            // facture sans établissement, vue des deux côtés
    expect(r2((a.deductible - shared) + (b.deductible - shared) + shared)).toBe(all.deductible);
  });

  it('le relevé des déductions suit le même périmètre', async () => {
    const numbers = async (storeId?: string) => (await ledger.purchaseLedgerRepository.vatDeductionStatement({ ...PERIOD, storeId }))
      .map((r: { invoice_number: string }) => r.invoice_number).filter((n: string) => n.endsWith(RUN)).map((n: string) => n.split('-')[1]).sort();
    expect(await numbers(fx.storeId)).toEqual(['A', 'N']);
    expect(await numbers(storeB)).toEqual(['B', 'N', 'X']);
    expect(await numbers()).toEqual(['A', 'B', 'N', 'X']);
  });
});
