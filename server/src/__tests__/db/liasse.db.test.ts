/**
 * Liasse fiscale (lot Bonus 14) — intégration base migrée.
 *
 * Exercice 2021 réservé à ce test. La base n'est pas remise à zéro entre deux
 * passages : on vérifie les invariants (actif = passif, résultats concordants,
 * aucun compte sans rubrique) et l'effet d'une écriture par différence.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Liasse fiscale — bilan, CPC, ESG', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let liasse: typeof import('../../repositories/liasse.repository.js').liasseRepository;
  let manual: typeof import('../../repositories/manual-entry.repository.js').manualEntryRepository;
  let actor: { userId: string; storeId: null };
  const acc = async (code: string) => (await testPool().query(`SELECT id FROM accounts WHERE code = $1`, [code])).rows[0].id as string;

  beforeAll(async () => {
    repos = await importRepositories();
    liasse = (await import('../../repositories/liasse.repository.js')).liasseRepository;
    manual = (await import('../../repositories/manual-entry.repository.js')).manualEntryRepository;
    actor = { userId: (await testPool().query(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`)).rows[0].id, storeId: null };
  }, 60_000);

  afterAll(async () => {
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  const invariants = (l: Awaited<ReturnType<typeof liasse.build>>) => {
    expect(l.totals.actif).toBeCloseTo(l.totals.passif, 2);
    expect(l.passif.find(x => x.id === 'K8')!.amount).toBeCloseTo(l.totals.result, 2);
    expect(l.tfr.find(x => x.id === 'X')!.amount).toBeCloseTo(l.totals.result, 2);
    expect(l.cpc.find(x => x.id === 'XVI')!.amount).toBeCloseTo(l.totals.result, 2);
    expect(l.controls.filter(c => c.message.includes('sans rubrique'))).toEqual([]);
  };

  it('invariants sur les exercices présents en base', async () => {
    const years = (await testPool().query(
      `SELECT DISTINCT extract(year FROM entry_date)::int AS y FROM journal_entries WHERE status IN ('posted', 'reversed') ORDER BY 1`)).rows.map(r => r.y as number);
    for (const y of years.slice(-4)) invariants(await liasse.build(y));
  }, 60_000);

  it('une écriture d\'achat d\'immobilisation, de dotation et de charge se reporte dans les tableaux', async () => {
    const before = await liasse.build(2021);
    const [mat, amort, bank, cust, dot, ext, sales] = await Promise.all(['2332', '2833', '5141', '3481', '6191', '6133', '7121'].map(acc));
    await manual.createAndPost({ journalCode: 'OD', date: '2021-06-10', description: `Liasse ${RUN} — matériel`, lines: [
      { accountId: mat, debit: 12_000, credit: 0 }, { accountId: bank, debit: 0, credit: 12_000 }] }, actor);
    await manual.createAndPost({ journalCode: 'OD', date: '2021-12-31', description: `Liasse ${RUN} — dotation`, lines: [
      { accountId: dot, debit: 1_200, credit: 0 }, { accountId: amort, debit: 0, credit: 1_200 }] }, actor);
    await manual.createAndPost({ journalCode: 'OD', date: '2021-07-01', description: `Liasse ${RUN} — vente et entretien`, lines: [
      { accountId: cust, debit: 20_000, credit: 0 }, { accountId: sales, debit: 0, credit: 20_000 },
      { accountId: ext, debit: 3_000, credit: 0 }, { accountId: cust, debit: 0, credit: 3_000 }] }, actor);
    const after = await liasse.build(2021);
    invariants(after);
    const d = <T extends { id: string }>(k: keyof T, a: T[], b: T[], id: string) =>
      Math.round((Number(a.find(x => x.id === id)![k]) - Number(b.find(x => x.id === id)![k])) * 100) / 100;
    expect(d('gross', after.actif, before.actif, 'C3')).toBe(12_000);
    expect(d('amort', after.actif, before.actif, 'C3')).toBe(1_200);
    expect(d('net', after.actif, before.actif, 'C3')).toBe(10_800);
    expect(d('amount', after.cpc, before.cpc, 'I2')).toBe(20_000);
    expect(d('amount', after.cpc, before.cpc, 'II3')).toBe(3_000);
    expect(d('amount', after.cpc, before.cpc, 'II7')).toBe(1_200);
    expect(Math.round((after.totals.result - before.totals.result) * 100) / 100).toBe(15_800);
    // CAF : + dotation d'exploitation de l'actif immobilisé.
    expect(d('amount', after.caf, before.caf, 'I')).toBe(17_000);
    // Colonne N−1 de l'exercice suivant = exercice 2021.
    const next = await liasse.build(2022);
    expect(next.cpc.find(x => x.id === 'XIII')!.previous).toBeCloseTo(after.totals.result, 2);
    expect(next.actif.find(x => x.id === 'C3')!.previous_net).toBeCloseTo(after.actif.find(x => x.id === 'C3')!.net, 2);
  }, 60_000);

  it('modèle simplifié : mêmes totaux, rubriques regroupées', async () => {
    const n = await liasse.build(2021, 'normal'), s = await liasse.build(2021, 'simplifie');
    expect(s.actif.find(x => x.id === 'C3')).toBeUndefined();
    expect(s.actif.find(x => x.id === 'C')!.net).toBeCloseTo(n.actif.find(x => x.id === 'C')!.net, 2);
    expect(s.totals).toEqual(n.totals);
  }, 60_000);
  it('fichiers EDI : relevé des déductions et état 9421 cohérents avec leurs lignes', async () => {
    const { buildVatDeductionEdi, buildIr9421Edi } = await import('../../services/dgi-edi.service.js');
    const year = Number((await testPool().query(
      `SELECT COALESCE(max(extract(year FROM vat_recoverable_from))::int, 2026) AS y FROM invoices WHERE invoice_type = 'received'`)).rows[0].y);
    for (const period of [1, 2, 3, 4]) {
      const t = await buildVatDeductionEdi({ year, period, regime: 2 });
      const xml = t.xml.subarray(3).toString('utf8');
      expect(xml.startsWith('<DeclarationReleveDeduction>')).toBe(true);
      expect((xml.match(/<rd>/g) ?? []).length).toBe(t.lines.length);
      expect(t.totals.tva).toBeCloseTo(t.lines.reduce((s, l) => s + l.tva, 0), 2);
      for (const l of t.lines) expect(l.dfac <= t.period.end).toBe(true);
    }
    const ir = await buildIr9421Edi(year);
    const x = ir.xml.toString('utf8');
    expect(x).toContain('<TraitementEtSalaire xmlns:xsi=');
    expect((x.match(/<PersonnelPermanent>/g) ?? []).length).toBe(ir.staff.length);
    expect(ir.totals.ir).toBeCloseTo(ir.staff.reduce((s, e) => s + e.ir, 0), 2);
  }, 60_000);
  it('liasse IS en EDI : cellules des totaux égales à la liasse, dans les deux modèles', async () => {
    const { buildLiasseIsEdi } = await import('../../services/dgi-edi.service.js');
    const n = await liasse.build(2021, 'normal');
    const val = (xml: Buffer, code: number) => Number(new RegExp(`<codeEdi>${code}</codeEdi>\\s*</cellule>\\s*<valeur>([^<]*)</valeur>`).exec(xml.toString('utf8'))?.[1]);
    for (const [model, actif, passif, result] of [['normal', 188, 13368, 13409], ['simplifie', 4699, 5277, 5229]] as const) {
      const e = await buildLiasseIsEdi(2021, model);
      expect(e.xml.toString('utf8')).toContain(`<modele>\r\n\t\t<id>${model === 'normal' ? 1 : 7}</id>`);
      expect(val(e.xml, actif)).toBeCloseTo(n.totals.actif, 2);
      expect(val(e.xml, passif)).toBeCloseTo(n.totals.passif, 2);
      expect(val(e.xml, result)).toBeCloseTo(n.totals.result, 2);
      expect(val(e.xml, 1332)).toBeCloseTo(n.totals.result, 2);
    }
  }, 60_000);
});
