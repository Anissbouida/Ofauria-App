/**
 * Plan comptable modifiable (mig 429) — intégration base migrée.
 *
 *   1. Création : structure CGNC déduite (classe, rubrique, poste, parent),
 *      nature et sens proposés (28xx au crédit), règles collectif / TVA.
 *   2. Compte vierge : tout se modifie ; suppression possible.
 *   3. Compte mouvementé : code figé (garde en base), libellé modifiable,
 *      suppression refusée, désactivation refusée tant que le solde n'est pas
 *      nul, acceptée une fois soldé.
 *   4. Journal de paramétrage : chaque modification tracée avec son auteur.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Plan comptable modifiable', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let coa: typeof import('../../repositories/chart-of-accounts.repository.js').chartOfAccountsRepository;
  let manual: typeof import('../../repositories/manual-entry.repository.js').manualEntryRepository;
  let actor: { userId: string; storeId: string | null };
  const day = new Date().toISOString().slice(0, 10);

  /** Code libre sous un préfixe (la base de test garde les comptes des passages précédents). */
  const freeCode = async (prefix: string) => {
    for (;;) {
      const code = `${prefix}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
      if (!(await testPool().query(`SELECT 1 FROM accounts WHERE code = $1`, [code])).rows.length) return code;
    }
  };

  beforeAll(async () => {
    repos = await importRepositories();
    coa = (await import('../../repositories/chart-of-accounts.repository.js')).chartOfAccountsRepository;
    manual = (await import('../../repositories/manual-entry.repository.js')).manualEntryRepository;
    const admin = (await testPool().query(`SELECT id, store_id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`)).rows[0];
    actor = { userId: admin.id, storeId: admin.store_id ?? null };
  });

  afterAll(async () => {
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('crée un compte avec sa structure CGNC, refuse les incohérences', async () => {
    const code = await freeCode('6181');
    const a = await coa.create({ code, label: `Frais de test ${RUN}` }, actor);
    const parent = (await testPool().query(`SELECT id FROM accounts WHERE code = '6181'`)).rows[0].id;
    expect(a).toMatchObject({ code, account_class: 6, rubrique: '61', poste: '618', parent_id: parent, account_type: 'expense', normal_side: 'D', is_collective: false });

    const amort = await coa.create({ code: await freeCode('2833'), label: `Amortissement test ${RUN}` }, actor);
    expect(amort).toMatchObject({ account_type: 'asset', normal_side: 'C' });

    await expect(coa.create({ code, label: 'Doublon' }, actor)).rejects.toThrow(/existe déjà/);
    await expect(coa.create({ code: '9123', label: 'Classe 9' }, actor)).rejects.toThrow(/classe \(1 à 8\)/);
    await expect(coa.create({ code: await freeCode('6181'), label: 'Collectif', isCollective: true }, actor)).rejects.toThrow(/34xx/);
    await expect(coa.create({ code: await freeCode('6181'), label: 'TVA', tvaRate: 20 }, actor)).rejects.toThrow(/3455x/);
    const tva = await coa.create({ code: await freeCode('34552'), label: `TVA test ${RUN}`, tvaRate: 20 }, actor);
    expect(tva).toMatchObject({ tva_direction: 'deductible' });
  });

  it('compte vierge : modifiable et supprimable', async () => {
    const a = await coa.create({ code: await freeCode('6181'), label: `Vierge ${RUN}` }, actor);
    const newCode = await freeCode('6181');
    const u = await coa.update(a.id, { code: newCode, label: `Vierge renommé ${RUN}`, normalSide: 'C' }, actor);
    expect(u).toMatchObject({ code: newCode, normal_side: 'C' });
    await coa.remove(a.id, actor);
    expect((await testPool().query(`SELECT 1 FROM accounts WHERE id = $1`, [a.id])).rows).toHaveLength(0);
  });

  it('compte mouvementé : code figé, suppression refusée, désactivation après solde nul ; audit', async () => {
    // Un code libéré par un test précédent peut revenir : l'audit se lit depuis le début de ce test.
    const since = (await testPool().query(`SELECT COALESCE(max(id), 0) AS m FROM config_audit_log`)).rows[0].m;
    const a = await coa.create({ code: await freeCode('6181'), label: `Mouvementé ${RUN}` }, actor);
    const caisse = (await testPool().query(`SELECT id FROM accounts WHERE code = '5161'`)).rows[0].id;
    const e = await manual.createAndPost({ journalCode: 'CA', date: day, description: `Achat ${RUN}`, lines: [
      { accountId: a.id, debit: 42, credit: 0 }, { accountId: caisse, debit: 0, credit: 42 },
    ] }, actor);

    expect((await coa.usage(a.id))).toMatchObject({ lines: 1, balance: 42 });
    await expect(coa.update(a.id, { code: await freeCode('6181'), label: 'Nouveau code' }, actor)).rejects.toThrow(/figés/);
    expect((await coa.update(a.id, { code: a.code, label: `Libellé corrigé ${RUN}` }, actor)).label).toBe(`Libellé corrigé ${RUN}`);
    await expect(coa.remove(a.id, actor)).rejects.toThrow(/désactivez-le/);
    await expect(coa.setActive(a.id, false, actor)).rejects.toThrow(/Solde non nul \(42.00 DH\)/);

    await manual.reverse(e.id, { reason: `solde ${RUN}` }, actor);
    expect((await coa.setActive(a.id, false, actor)).is_active).toBe(false);
    expect((await coa.setActive(a.id, true, actor)).is_active).toBe(true);

    const audit = (await testPool().query(
      `SELECT operation, changed_by FROM config_audit_log WHERE table_name = 'accounts' AND record_id = $1 AND id > $2 ORDER BY id`, [a.code, since])).rows;
    expect(audit.map((x: { operation: string }) => x.operation)).toEqual(['INSERT', 'UPDATE', 'UPDATE', 'UPDATE']);
    expect(audit.every((x: { changed_by: string }) => x.changed_by === actor.userId)).toBe(true);
  });
});
