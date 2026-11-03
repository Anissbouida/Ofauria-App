/**
 * Lot Bonus 17 (mig 437) — intégration base migrée.
 *
 * Deux établissements créés pour le test, exercice 2027 : A encaisse 1 000 de
 * ventes, B paie 400 de charges, A cède 300 de caisse à B. On vérifie nos
 * colonnes, l'élimination de la liaison et le rapprochement avec la liasse de
 * la société (toutes les écritures de l'exercice dans la base de test).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Consolidation multi-établissements', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let conso: typeof import('../../repositories/consolidation.repository.js').consolidationRepository;
  let manual: typeof import('../../repositories/manual-entry.repository.js').manualEntryRepository;
  const ids: Record<string, string> = {};
  let userId: string;
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    conso = (await import('../../repositories/consolidation.repository.js')).consolidationRepository;
    manual = (await import('../../repositories/manual-entry.repository.js')).manualEntryRepository;
    userId = (await p().query(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`)).rows[0].id;
    for (const k of ['A', 'B']) ids[k] = (await p().query(`INSERT INTO stores (name, city) VALUES ($1, 'Test') RETURNING id`, [`Conso ${k} ${RUN}`])).rows[0].id;
    const acc = async (code: string) => (await p().query(`SELECT id FROM accounts WHERE code = $1`, [code])).rows[0].id as string;
    const [cash, sales, rent] = [await acc('5161'), await acc('7111'), await acc('6131')];
    await manual.createAndPost({ journalCode: 'OD', date: '2027-03-04', description: `Ventes A ${RUN}`, lines: [
      { accountId: cash, debit: 1000, credit: 0 }, { accountId: sales, debit: 0, credit: 1000 }] }, { userId, storeId: ids.A });
    await manual.createAndPost({ journalCode: 'OD', date: '2027-03-05', description: `Loyer B ${RUN}`, lines: [
      { accountId: rent, debit: 400, credit: 0 }, { accountId: cash, debit: 0, credit: 400 }] }, { userId, storeId: ids.B });
  }, 60_000);

  afterAll(async () => {
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('transfert entre établissements, colonnes, élimination et rapprochement avec la liasse', async () => {
    await expect(conso.transfer({ date: '2027-03-06', fromStoreId: ids.A, toStoreId: ids.A, accountCode: '5161', amount: 10, label: '', userId }))
      .rejects.toThrow(/deux établissements différents/);
    await expect(conso.transfer({ date: '2027-03-06', fromStoreId: ids.A, toStoreId: ids.B, accountCode: '3421', amount: 10, label: '', userId }))
      .rejects.toThrow(/stock \(classe 3\) ou de trésorerie/);
    const t = await conso.transfer({ date: '2027-03-06', fromStoreId: ids.A, toStoreId: ids.B, accountCode: '5161', amount: 300, label: `Fonds de caisse ${RUN}`, userId });
    expect(t.entries).toHaveLength(2);
    const stores = (await p().query(
      `SELECT je.store_id, a.code, jel.debit::float8 AS d, jel.credit::float8 AS c FROM journal_entries je
         JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id JOIN accounts a ON a.id = jel.account_id
        WHERE je.source_detail = $1 ORDER BY je.entry_number, jel.line_order`, [`liaison:${t.transfer_id}`])).rows;
    expect(stores).toEqual([
      { store_id: ids.A, code: '1811', d: 300, c: 0 }, { store_id: ids.A, code: '5161', d: 0, c: 300 },
      { store_id: ids.B, code: '5161', d: 300, c: 0 }, { store_id: ids.B, code: '1811', d: 0, c: 300 },
    ]);

    const r = await conso.build(2027);
    const a = r.columns.find(c => c.key === ids.A)!, b = r.columns.find(c => c.key === ids.B)!;
    expect(a).toMatchObject({ result: 1000, liaison: -300, ecart: 0, total_actif: 700 });
    expect(a.actif.T3).toBe(700);
    expect(b).toMatchObject({ result: -400, liaison: 300, ecart: 0 });
    expect(b.cpc.II).toBe(400);
    expect(r.combined.liaison_residual).toBe(0);
    expect(r.controls.filter(c => /liaison|liasse|déséquilibré/.test(c.message))).toEqual([]);
    expect(r.combined.result).toBeCloseTo(r.company.result, 2);
    expect(r.transfers.find(x => x.transfer_id === t.transfer_id)).toMatchObject({ active: true, from_store_id: ids.A, to_store_id: ids.B, account_code: '5161', amount: 300 });

    // Une seule écriture de liaison ne s'extourne pas à la main ; le transfert s'annule entier.
    const one = (await p().query(`SELECT id FROM journal_entries WHERE source_detail = $1 LIMIT 1`, [`liaison:${t.transfer_id}`])).rows[0].id;
    await expect(manual.reverse(one, { reason: 'test' }, { userId, storeId: null })).rejects.toThrow(/liaison entre établissements/);
    await conso.cancelTransfer(t.transfer_id, { userId, reason: 'Test annulation' });
    await expect(conso.cancelTransfer(t.transfer_id, { userId, reason: 'Test annulation' })).rejects.toThrow(/déjà annulé/);
    const after = await conso.build(2027);
    expect(after.columns.find(c => c.key === ids.A)).toMatchObject({ liaison: 0, total_actif: 1000 });
    expect(after.transfers.find(x => x.transfer_id === t.transfer_id)?.active).toBe(false);
  }, 60_000);
});
