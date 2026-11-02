/**
 * Import de relevés bancaires (mig 426) — intégration base migrée.
 *
 *   1. Aperçu d'un CSV avec profil : rien n'est écrit, compte bancaire par défaut.
 *   2. Import : relevé créé avec son origine (format, fichier, empreinte).
 *   3. Réimport du même fichier : refusé (tout est déjà connu).
 *   4. Relevé qui chevauche (OFX) : seules les opérations nouvelles entrent,
 *      deux opérations identiques du même jour restent distinctes.
 *   5. Profil d'import enregistré puis réutilisé.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Import de relevés bancaires', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let bank: typeof import('../../repositories/bank-reconciliation.repository.js').bankImportRepository;
  let admin: string;
  // Montants propres au passage : l'empreinte est globale au compte.
  const k = 1 + Math.floor(Math.random() * 80000) / 100;
  const a1 = (100 + k).toFixed(2), a2 = (2500 + k).toFixed(2), a3 = (42 + k).toFixed(2);
  const fr = (s: string) => s.replace('.', ',');
  const csv = `Date;Libellé;Débit;Crédit\n02/06/2026;VIR FOURNISSEUR ${RUN};${fr(a1)};\n05/06/2026;REMISE ${RUN};;${fr(a2)}\n`;
  const profile = { decimalSep: ',' as const, dateFormat: 'DD/MM/YYYY' as const, skipRows: 0, hasHeader: true, colDate: 0, colLabel: 1, colDebit: 2, colCredit: 3 };
  const file = (s: string, fileName: string, extra: Record<string, unknown> = {}) =>
    ({ content: Buffer.from(s, 'utf-8'), fileName, ...extra });

  beforeAll(async () => {
    repos = await importRepositories();
    bank = (await import('../../repositories/bank-reconciliation.repository.js')).bankImportRepository;
    admin = (await testPool().query(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`)).rows[0].id;
  });

  afterAll(async () => {
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('aperçu puis import d\'un CSV ; le réimport est refusé', async () => {
    const before = Number((await testPool().query(`SELECT count(*) FROM bank_statements`)).rows[0].count);
    const pv = await bank.preview(file(csv, 'releve.csv', { profile }));
    expect(pv.format).toBe('csv');
    expect(pv.treasuryAccount.account_code).toBe('5141');
    expect(pv.stats).toMatchObject({ count: 2, duplicates: 0, in: Number(a2), out: Number(a1) });
    expect(pv.lines.every(l => !l.duplicate)).toBe(true);
    expect(Number((await testPool().query(`SELECT count(*) FROM bank_statements`)).rows[0].count)).toBe(before);  // rien d'écrit

    const r = await bank.importStatement({ ...file(csv, 'releve.csv', { profile }), userId: admin, openingBalance: 1000 });
    expect(r).toMatchObject({ imported: 2, skipped: 0 });
    expect(r.statement).toMatchObject({ source_format: 'csv', file_name: 'releve.csv', statement_date: expect.anything() });
    expect(Number(r.statement.closing_balance)).toBe(Math.round((1000 + Number(a2) - Number(a1)) * 100) / 100);

    await expect(bank.importStatement({ ...file(csv, 'releve.csv', { profile }), userId: admin }))
      .rejects.toThrow(/déjà importé/);
    expect((await bank.preview(file(csv, 'releve.csv', { profile }))).stats.duplicates).toBe(2);
  });

  it('un relevé OFX qui chevauche n\'importe que les opérations nouvelles', async () => {
    const trn = (date: string, amt: string, id: string) =>
      `<STMTTRN><TRNTYPE>X<DTPOSTED>${date}<TRNAMT>${amt}<FITID>${id}<NAME>OP ${id}</STMTTRN>\n`;
    const ofx = `OFXHEADER:100\n<OFX><BANKTRANLIST>\n${trn('20260602', `-${a1}`, 'X1')}${trn('20260605', a2, 'X2')}`
      + `${trn('20260608', `-${a3}`, 'X3')}${trn('20260608', `-${a3}`, 'X4')}</BANKTRANLIST></OFX>`;
    const pv = await bank.preview(file(ofx, 'juin.ofx'));
    expect(pv.format).toBe('ofx');
    expect(pv.lines.map(l => l.duplicate)).toEqual([true, true, false, false]);
    const r = await bank.importStatement({ ...file(ofx, 'juin.ofx'), userId: admin });
    expect(r).toMatchObject({ imported: 2, skipped: 2 });
    expect(r.statement.duplicates_skipped).toBe(2);
    const lines = (await testPool().query(
      `SELECT amount, fingerprint FROM bank_statement_lines WHERE bank_statement_id = $1`, [r.statement.id])).rows;
    expect(lines).toHaveLength(2);
    expect(new Set(lines.map((l: { fingerprint: string }) => l.fingerprint)).size).toBe(2);   // deux opérations identiques, deux empreintes
  });

  it('enregistre un profil puis l\'utilise par son identifiant', async () => {
    const p = await bank.saveProfile({ name: `Banque test ${RUN}`, ...profile }, admin);
    await expect(bank.saveProfile({ name: `Banque test ${RUN}`, ...profile }, admin)).rejects.toThrow(/existe déjà/);
    await expect(bank.saveProfile({ name: `Incomplet ${RUN}`, ...profile, colDebit: null, colCredit: null }, admin)).rejects.toThrow(/débit\/crédit/);
    const pv = await bank.preview(file(csv, 'releve.csv', { profileId: p.id }));
    expect(pv.profileId).toBe(p.id);
    expect(pv.lines).toHaveLength(2);
    await bank.deleteProfile(p.id);
    expect((await bank.listProfiles()).some((x: { id: string }) => x.id === p.id)).toBe(false);
  });
});
