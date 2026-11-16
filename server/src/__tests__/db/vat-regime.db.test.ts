/**
 * G0-16 — régime de TVA lu par la déclaration.
 * Facture à crédit de janvier (36 DH TTC, TVA 6 DH) réglée moitié en février, moitié en mars :
 *  - régime des débits : TVA déclarée en janvier ;
 *  - régime des encaissements : 3 DH en février, 3 DH en mars, rien en janvier ;
 *  - facture antérieure à la date de bascule : reste déclarée à la facturation ;
 *  - encaissement sans date de bascule : la déclaration reste au régime des débits.
 *
 * Les montants sont lus en écart par rapport à un relevé pris avant la facture : d'autres
 * suites laissent des écritures sans établissement sur les mêmes mois.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

const REGIMES = {
  debit: { mode: 'debit' },
  cash: { mode: 'encaissement', since: '2027-01-01' },
  cashLate: { mode: 'encaissement', since: '2027-02-01' },
  cashNoDate: { mode: 'encaissement' },
} as const;
type RegimeKey = keyof typeof REGIMES;
type Reading = { collected: number[]; awaiting: number[]; regime: { mode: string; since: string | null; missing_since: boolean } };

describe.skipIf(!hasTestDb)('Régime de TVA (G0-16)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let tva: typeof import('../../repositories/ledger.repository.js').tvaDeclarationRepository;
  let fx: Fixtures;
  let previous: unknown;
  const before = {} as Record<RegimeKey, Reading>;
  const p = () => testPool();
  const r2 = (n: number) => Math.round(n * 100) / 100;

  const setRegime = (value: unknown) => p().query(
    `INSERT INTO module_parameters (key, value) VALUES ('sales.vat_regime', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(value)]);
  /** Déclarations de janvier à avril 2027 sous un régime donné. */
  const read = async (key: RegimeKey): Promise<Reading> => {
    await setRegime(REGIMES[key]);
    const out: Reading = { collected: [], awaiting: [], regime: { mode: '', since: null, missing_since: false } };
    for (const m of [1, 2, 3, 4]) {
      const mm = String(m).padStart(2, '0');
      const d = await tva.declaration({ startDate: `2027-${mm}-01`, endDate: `2027-${mm}-${new Date(Date.UTC(2027, m, 0)).getUTCDate()}`, storeId: fx.storeId });
      out.collected.push(d.total_collected); out.awaiting.push(d.awaiting_collection); out.regime = d.regime;
    }
    return out;
  };
  /** Écart de TVA collectée et de TVA en attente dû à la facture du test. */
  const delta = async (key: RegimeKey) => {
    const now = await read(key);
    return {
      collected: now.collected.map((v, i) => r2(v - before[key].collected[i])),
      awaiting: now.awaiting.map((v, i) => r2(v - before[key].awaiting[i])),
      regime: now.regime,
    };
  };

  beforeAll(async () => {
    repos = await importRepositories();
    const notes = (await import('../../repositories/delivery-note.repository.js')).deliveryNoteRepository;
    const receipts = (await import('../../repositories/customer-receipt.repository.js')).customerReceiptRepository;
    tva = (await import('../../repositories/ledger.repository.js')).tvaDeclarationRepository;
    fx = await createBaseFixtures();
    previous = (await p().query(`SELECT value FROM module_parameters WHERE key = 'sales.vat_regime'`)).rows[0]?.value ?? { mode: 'debit' };
    for (const k of Object.keys(REGIMES) as RegimeKey[]) before[k] = await read(k);

    const customerId = (await p().query(
      `INSERT INTO customers (company_name, first_name, last_name, customer_type, billing_frequency) VALUES ($1, 'Hôtel', 'TVA', 'professionnel', 'monthly') RETURNING id`,
      [`Hôtel TVA ${RUN}`])).rows[0].id;
    const productId = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1, $2, 3) RETURNING id`, [`Pain TVA ${RUN}`, `pain-tva-${RUN}`])).rows[0].id;
    fx.ids.products.push(productId);
    await p().query(`INSERT INTO product_store_stock (product_id, store_id, stock_quantity) VALUES ($1, $2, 1000)`, [productId, fx.storeId]);
    await setRegime(REGIMES.debit);
    const note = await notes.create({ customerId, deliveryDate: '2027-01-10', createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId, quantity: 10, unitPrice: 3, tvaRate: 20 }] }) as { id: string };
    const invoiceId = (await notes.invoice({ deliveryNoteIds: [note.id], invoiceDate: '2027-01-10', createdBy: fx.userId })).id;
    await receipts.create({ customerId, amount: 18, paymentMethod: 'bank', paymentDate: '2027-02-05', userId: fx.userId,
      reference: `VIR-A-${RUN}`, allocations: [{ invoiceId, amount: 18 }] });
    await receipts.create({ customerId, amount: 18, paymentMethod: 'bank', paymentDate: '2027-03-12', userId: fx.userId,
      reference: `VIR-B-${RUN}`, allocations: [{ invoiceId, amount: 18 }] });
  }, 120_000);

  afterAll(async () => {
    await setRegime(previous).catch(() => undefined);
    if (fx) await cleanupFixtures(fx).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('régime des débits : la TVA est déclarée le mois de la facture', async () => {
    const d = await delta('debit');
    expect(d.collected).toEqual([6, 0, 0, 0]);
    expect(d.awaiting).toEqual([0, 0, 0, 0]);
    expect(d.regime.mode).toBe('debit');
  });

  it('régime des encaissements : la TVA suit les règlements, au prorata', async () => {
    const d = await delta('cash');
    expect(d.collected).toEqual([0, 3, 3, 0]);
    expect(d.awaiting).toEqual([6, 3, 0, 0]);       // TVA facturée, pas encore encaissée en fin de mois
    expect(d.regime).toMatchObject({ mode: 'encaissement', since: '2027-01-01' });
  });

  it('facture antérieure à la bascule : déclarée à la facturation, pas une seconde fois au règlement', async () => {
    const d = await delta('cashLate');
    expect(d.collected).toEqual([6, 0, 0, 0]);
  });

  it('encaissement sans date de bascule : la déclaration reste au régime des débits et le signale', async () => {
    const d = await delta('cashNoDate');
    expect(d.collected).toEqual([6, 0, 0, 0]);
    expect(d.regime).toMatchObject({ mode: 'debit', missing_since: true });
  });
});
