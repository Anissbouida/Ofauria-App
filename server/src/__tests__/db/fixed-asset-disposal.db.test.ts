/**
 * Cession d'immobilisation (mig 427) — intégration base migrée.
 *
 * Matériel acquis le 15/01 à 12 000 DH, linéaire 5 ans (200 DH/mois), dotations
 * passées de janvier à mars ; vendu le 10/06 à 9 000 DH HT + TVA 20 % par banque :
 *   - dotation complémentaire avril-juin = 600, cumul 1 200, VNC 10 800 ;
 *   - écriture : 2833 D 1 200, 6513 D 10 800 / 2332 C 12 000 ;
 *     5141 D 10 800 / 7513 C 9 000, 44551 C 1 800 → moins-value 1 800 ;
 *   - plus de dotation, suppression et extourne manuelle refusées ;
 *   - tableau de l'exercice ; annulation de la sortie.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Cession d\'immobilisation', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let svc: typeof import('../../services/depreciation.service.js');
  let manual: typeof import('../../repositories/manual-entry.repository.js').manualEntryRepository;
  let admin: string;
  let assetId: string;
  const year = 2026;
  const acc: Record<string, string> = {};

  const depreciate = async (month: number) => {
    const c = await repos.db.getClient();
    try {
      await c.query('BEGIN');
      const r = await svc.runDepreciation(c, { year, month, userId: admin });
      await c.query('COMMIT');
      return r;
    } finally { c.release(); }
  };

  beforeAll(async () => {
    repos = await importRepositories();
    svc = await import('../../services/depreciation.service.js');
    manual = (await import('../../repositories/manual-entry.repository.js')).manualEntryRepository;
    const p = testPool();
    admin = (await p.query(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`)).rows[0].id;
    for (const r of (await p.query(`SELECT id, code FROM accounts WHERE code IN ('2332', '2833', '6191')`)).rows) acc[r.code] = r.id;
    const a = await svc.fixedAssetRepository.create({
      label: `Pétrin test ${RUN}`, assetAccountId: acc['2332'], depreciationAccountId: acc['2833'], expenseAccountId: acc['6191'],
      acquisitionDate: `${year}-01-15`, acquisitionCost: 12000, durationYears: 5, createdBy: admin,
    });
    assetId = a.id;
    // Dotations de janvier à mars (les autres immobilisations de la base passent aussi : sans effet ici).
    for (const m of [1, 2, 3]) await depreciate(m);
  }, 60_000);

  afterAll(async () => {
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  const sale = { date: `${year}-06-10`, kind: 'sale' as const, price: 9000, vatRate: 20, counterpart: 'bank' as const, buyer: 'Boulangerie voisine' };

  it('aperçu puis cession : dotation complémentaire, VNC, moins-value, écriture équilibrée', async () => {
    expect(await svc.fixedAssetDisposal.preview(assetId, sale)).toMatchObject({ cost: 12000, complementary: 600, months: 3, cumulated: 1200, vnc: 10800, gain: -1800 });
    const r = await svc.fixedAssetDisposal.dispose(assetId, sale, admin);
    expect(r).toMatchObject({ complementary: 600, cumulated: 1200, vnc: 10800, price: 9000, vat: 1800, gain: -1800 });

    const p = testPool();
    const fa = (await p.query(`SELECT status, disposal_entry_id, disposal_gain FROM fixed_assets WHERE id = $1`, [assetId])).rows[0];
    expect(fa.status).toBe('disposed');
    expect(Number(fa.disposal_gain)).toBe(-1800);
    const lines = (await p.query(
      `SELECT a.code, jel.debit::float8 AS d, jel.credit::float8 AS c FROM journal_entry_lines jel JOIN accounts a ON a.id = jel.account_id
        WHERE jel.journal_entry_id = $1 ORDER BY jel.line_order`, [fa.disposal_entry_id])).rows;
    expect(lines).toEqual([
      { code: '2833', d: 1200, c: 0 }, { code: '6513', d: 10800, c: 0 }, { code: '2332', d: 0, c: 12000 },
      { code: '5141', d: 10800, c: 0 }, { code: '7513', d: 0, c: 9000 }, { code: '44551', d: 0, c: 1800 },
    ]);
    const months = (await p.query(`SELECT period_month FROM depreciation_entries WHERE fixed_asset_id = $1 AND disposal ORDER BY 1`, [assetId])).rows;
    expect(months.map((m: { period_month: number }) => m.period_month)).toEqual([4, 5, 6]);
  });

  it('une immobilisation sortie ne s\'amortit plus et ne se supprime pas', async () => {
    await depreciate(7);
    expect((await testPool().query(`SELECT 1 FROM depreciation_entries WHERE fixed_asset_id = $1 AND period_month = 7`, [assetId])).rows).toHaveLength(0);
    await expect(svc.fixedAssetRepository.delete(assetId)).rejects.toThrow(/annulez d'abord la cession/);
    await expect(svc.fixedAssetDisposal.dispose(assetId, sale, admin)).rejects.toThrow(/déjà sortie/);
    const entry = (await testPool().query(`SELECT disposal_entry_id FROM fixed_assets WHERE id = $1`, [assetId])).rows[0].disposal_entry_id;
    await expect(manual.reverse(entry, { reason: 'test' }, { userId: admin, storeId: null })).rejects.toThrow(/Immobilisations/);
  });

  it('tableau de l\'exercice : entrée et sortie dans l\'année, cession listée', async () => {
    const t = await svc.fixedAssetDisposal.table(year);
    const item = t.groups.flatMap(g => g.items).find(i => i.id === assetId)!;
    expect(item).toMatchObject({ gross_start: 0, acquisitions: 12000, disposals: 12000, gross_end: 0, dep_start: 0, dep_year: 1200, dep_out: 1200, dep_end: 0, vnc_end: 0 });
    expect(t.disposals.find(d => d.id === assetId)).toMatchObject({ kind: 'sale', price: 9000, vnc: 10800, gain: -1800 });
  });

  it('annulation de la sortie : extournes, dotations complémentaires retirées, immobilisation de nouveau active', async () => {
    const r = await svc.fixedAssetDisposal.cancel(assetId, `erreur de saisie ${RUN}`, admin);
    expect(r.status).toBe('active');
    const p = testPool();
    expect((await p.query(`SELECT count(*)::int AS n FROM depreciation_entries WHERE fixed_asset_id = $1`, [assetId])).rows[0].n).toBe(3);
    const reversed = (await p.query(
      `SELECT count(*)::int AS n FROM journal_entries WHERE source_id = $1 AND status = 'reversed'`, [assetId])).rows[0].n;
    expect(reversed).toBe(2);                     // cession + dotation complémentaire
    // Datée avant la dernière dotation passée : refusée.
    await expect(svc.fixedAssetDisposal.dispose(assetId, { ...sale, date: `${year}-02-10` }, admin)).rejects.toThrow(/déjà passées après/);
    // Mise au rebut : pas de prix, VNC entière en charge.
    const scrap = await svc.fixedAssetDisposal.dispose(assetId, { date: `${year}-03-31`, kind: 'scrap' }, admin);
    expect(scrap).toMatchObject({ complementary: 0, cumulated: 600, vnc: 11400, price: 0, gain: -11400 });
  });
});
