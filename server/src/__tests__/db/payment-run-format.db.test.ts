/**
 * G4-01 — les deux points restants des paiements fournisseurs en lot (mig 600).
 *  1. Format du fichier de virement par compte bancaire :
 *     - sans format saisi, le fichier est EXACTEMENT le CSV générique des salaires ;
 *     - un format délimité et un format à positions fixes, résultats écrits à la main ;
 *     - contrôles (RIB et montant obligatoires, largeurs en positions fixes, caisse refusée) ;
 *     - le fichier d'une campagne suit le format du compte débité (extension .txt).
 *  2. Circuit d'approbation par défaut : une campagne soumise par un non-administrateur part
 *     en approbation (règle payment_run_default → administrateur) ; l'approbation la rend
 *     « approuvée ».
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Paiements en lot — format banque et circuit par défaut (G4-01, mig 600)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let runs: typeof import('../../repositories/payment-run.repository.js')['paymentRunRepository'];
  let fmt: typeof import('../../services/bank-transfer-format.js');
  let salary: typeof import('../../services/salary-transfer.js');
  let approvals: typeof import('../../services/approval.service.js')['approvalService'];
  let admin: { id: string; role: string }, manager: { id: string; role: string };
  let bank: string, cash: string, supplier: string, savedFormat: unknown, savedIban: string | null;
  const acc: Record<string, string> = {};
  const invoices: string[] = [];
  const runIds: string[] = [];
  const day = new Date().toISOString().slice(0, 10);
  const p = () => testPool();

  // RIB à clé valide (97 − (22 premiers chiffres × 100) mod 97).
  const RIB_A = '011780000012345678901296';
  const RIB_B = '007780000098765432109876';
  const lines = [
    { payrollId: '', employeeId: '1', name: 'Minoterie Atlas', rib: RIB_A, bankName: 'Attijariwafa bank', amount: 12500.5 },
    { payrollId: '', employeeId: '2', name: 'Société d\'Emballages; Sud', rib: RIB_B, bankName: 'Banque Populaire', amount: 980 },
  ];
  const ctx = { motif: 'REGLEMENT CP-20261130-01', paymentDate: '2026-11-30', debitRib: '022780000011111111111111', currency: 'MAD', reference: 'CP-20261130-01' };

  const invoice = async (supplierId: string, n: string, total: number) => {
    const id = (await p().query(
      `INSERT INTO invoices (invoice_number, invoice_type, supplier_id, invoice_date, due_date, amount, total_amount, status,
                             supplier_invoice_number, declared_ttc, validation_status)
       VALUES ($1, 'received', $2, $3, $3, $4, $4, 'pending', $1, $4, 'validated') RETURNING id`,
      [`${n}-${RUN}`, supplierId, day, total])).rows[0].id as string;
    invoices.push(id);
    return id;
  };

  beforeAll(async () => {
    repos = await importRepositories();
    ({ paymentRunRepository: runs } = await import('../../repositories/payment-run.repository.js'));
    fmt = await import('../../services/bank-transfer-format.js');
    salary = await import('../../services/salary-transfer.js');
    ({ approvalService: approvals } = await import('../../services/approval.service.js'));
    await import('../../services/approval-handlers.js');
    admin = (await p().query(`SELECT id, role FROM users WHERE role = 'admin' AND NOT is_system AND is_active ORDER BY created_at LIMIT 1`)).rows[0];
    manager = (await p().query(`SELECT id, role FROM users WHERE role = 'manager' AND NOT is_system AND is_active ORDER BY created_at LIMIT 1`)).rows[0];
    for (const r of (await p().query(`SELECT id, code FROM accounts WHERE code IN ('6181', '4411')`)).rows) acc[r.code] = r.id;
    const b = (await p().query(`SELECT id, transfer_format, iban FROM treasury_accounts WHERE kind = 'bank' AND is_active ORDER BY is_default DESC LIMIT 1`)).rows[0];
    bank = b.id; savedFormat = b.transfer_format; savedIban = b.iban;
    cash = (await p().query(`SELECT id FROM treasury_accounts WHERE kind = 'cash' AND is_active LIMIT 1`)).rows[0].id;
    supplier = (await p().query(
      `INSERT INTO suppliers (name, rib, bank_name) VALUES ($1, $2, 'Attijariwafa') RETURNING id`, [`Fournisseur format ${RUN}`, RIB_A])).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await p().query(`UPDATE treasury_accounts SET transfer_format = $2::jsonb, iban = $3 WHERE id = $1`, [bank, savedFormat == null ? null : JSON.stringify(savedFormat), savedIban]).catch(() => undefined);
    await p().query(`DELETE FROM approval_requests WHERE doc_type = 'payment_run' AND doc_id = ANY($1)`, [runIds]).catch(() => undefined);
    await p().query(`DELETE FROM payment_runs WHERE id = ANY($1)`, [runIds]).catch(() => undefined);
    await p().query(`DELETE FROM invoices WHERE id = ANY($1)`, [invoices]).catch(() => undefined);
    await p().query(`DELETE FROM suppliers WHERE id = $1`, [supplier]).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('sans format saisi : le fichier est exactement le CSV générique des salaires', () => {
    const generic = fmt.buildBankTransferFile(lines, ctx, null);
    expect(generic.extension).toBe('csv');
    expect(generic.content).toBe(salary.buildTransferCsv(lines, ctx.motif));
    expect(generic.content).toBe(
      'N°;Bénéficiaire;RIB;Banque;Montant;Motif\r\n'
      + `1;MINOTERIE ATLAS;${RIB_A};Attijariwafa bank;12500.50;REGLEMENT CP-20261130-01\r\n`
      + `2;SOCIETE D'EMBALLAGES SUD;${RIB_B};Banque Populaire;980.00;REGLEMENT CP-20261130-01\r\n`);
  });

  it('format délimité : séparateur, montant en centimes, date, RIB débité, sans en-tête', () => {
    const { format, errors } = fmt.normalizeTransferFormat({
      separator: '|', decimal: '.', amountInCents: true, header: false, dateFormat: 'YYYYMMDD', uppercase: true, lineEnding: 'lf',
      columns: ['date', 'debit_rib', 'rib', 'name', 'amount', 'currency', 'reference'],
    });
    expect(errors).toEqual([]);
    expect(fmt.buildBankTransferFile(lines, ctx, format).content).toBe(
      `20261130|022780000011111111111111|${RIB_A}|MINOTERIE ATLAS|1250050|MAD|CP-20261130-01\n`
      + `20261130|022780000011111111111111|${RIB_B}|SOCIETE D'EMBALLAGES SUD|98000|MAD|CP-20261130-01\n`);
    // Virgule décimale, en-tête, texte d'origine : la valeur contenant le séparateur est entre guillemets.
    const fr = fmt.normalizeTransferFormat({ separator: ';', decimal: ',', header: true, uppercase: false, dateFormat: 'DD/MM/YYYY', columns: ['name', 'rib', 'amount', 'date'] }).format;
    expect(fmt.buildBankTransferFile(lines, ctx, fr).content).toBe(
      'Bénéficiaire;RIB du bénéficiaire;Montant;Date d\'exécution\r\n'
      + `Minoterie Atlas;${RIB_A};12500,50;30/11/2026\r\n`
      + `"Société d'Emballages; Sud";${RIB_B};980,00;30/11/2026\r\n`);
  });

  it('positions fixes : texte cadré à gauche, montant cadré à droite en zéros, nom tronqué', () => {
    const { format } = fmt.normalizeTransferFormat({
      separator: 'fixed', decimal: '.', amountInCents: true, columns: ['rib', 'name', 'amount'], widths: { rib: 24, name: 10, amount: 12 },
    });
    expect(format).toMatchObject({ header: false, extension: 'txt' });
    expect(fmt.buildBankTransferFile(lines, ctx, format).content).toBe(
      `${RIB_A}MINOTERIE 000001250050\r\n`
      + `${RIB_B}SOCIETE D'000000098000\r\n`);
    const tiny = fmt.normalizeTransferFormat({ separator: 'fixed', decimal: '.', amountInCents: true, columns: ['rib', 'amount'], widths: { rib: 24, amount: 5 } }).format;
    expect(() => fmt.buildBankTransferFile(lines, ctx, tiny)).toThrow(/dépasse la largeur/);
  });

  it('contrôles du format', () => {
    expect(fmt.normalizeTransferFormat({ separator: ';', decimal: '.', columns: ['name', 'amount'] }).errors).toContain('Le RIB du bénéficiaire est obligatoire');
    expect(fmt.normalizeTransferFormat({ separator: ';', decimal: '.', columns: ['rib', 'name'] }).errors).toContain('Le montant est obligatoire');
    expect(fmt.normalizeTransferFormat({ separator: ',', decimal: ',', columns: ['rib', 'amount'] }).errors.join()).toMatch(/Séparateur et virgule décimale/);
    expect(fmt.normalizeTransferFormat({ separator: 'fixed', decimal: '.', columns: ['rib', 'amount'], widths: { rib: 20, amount: 10 } }).errors)
      .toContain('La colonne RIB doit faire au moins 24 caractères');
    expect(fmt.normalizeTransferFormat({ separator: 'fixed', decimal: '.', columns: ['rib', 'amount'], widths: { rib: 24 } }).errors.join()).toMatch(/Largeur manquante.*Montant/);
  });

  it('enregistrement par compte : aperçu, caisse refusée, retour au générique', async () => {
    await expect(runs.saveTransferFormat(cash, { separator: ';', decimal: '.', columns: ['rib', 'amount'] })).rejects.toThrow(/compte bancaire/);
    await expect(runs.saveTransferFormat(bank, { separator: ';', decimal: '.', columns: ['name'] })).rejects.toThrow(/RIB du bénéficiaire est obligatoire/);
    const saved = await runs.saveTransferFormat(bank, { separator: 'fixed', decimal: '.', amountInCents: true, columns: ['rib', 'name', 'amount'], widths: { rib: 24, name: 10, amount: 12 } });
    expect(saved.isGeneric).toBe(false);
    expect(saved.preview).toBe(`${RIB_A}MINOTERIE 000001250050\r\n${RIB_B}EMBALLAGES000000098000\r\n`);
    const reset = await runs.saveTransferFormat(bank, null);
    expect(reset.isGeneric).toBe(true);
    expect(reset.preview.split('\r\n')[0]).toBe('N°;Bénéficiaire;RIB;Banque;Montant;Motif');
  });

  it('le fichier d\'une campagne suit le format du compte débité', async () => {
    const inv = await invoice(supplier, 'FF1', 1234.56);
    const runId = await runs.create({ paymentDate: day, treasuryAccountId: bank, lines: [{ invoiceId: inv, amount: 1234.56 }], userId: admin.id });
    runIds.push(runId);
    expect(await runs.submit(runId, admin.id)).toEqual({ status: 'approved' });   // administrateur : sa soumission vaut approbation
    await runs.saveTransferFormat(bank, { separator: ';', decimal: ',', header: false, dateFormat: 'DDMMYYYY', columns: ['rib', 'amount', 'date', 'reference'], extension: 'txt' });
    const run = (await runs.get(runId))!;
    const file = await runs.transferFile(runId);
    expect(file.extension).toBe('txt');
    expect(file.filename).toBe(`virement_fournisseurs_${run.run_number}.txt`);
    const [y, m, d] = day.split('-');
    expect(file.csv).toBe(`${RIB_A};1234,56;${d}${m}${y};${run.run_number}\r\n`);
    await runs.cancel(runId, admin.id);
  });

  it('circuit par défaut : la campagne d\'un gérant attend l\'administrateur, puis est approuvée', async () => {
    const rule = (await p().query(
      `SELECT r.enabled, r.condition, s.approver_role FROM approval_rules r JOIN approval_rule_steps s ON s.rule_id = r.id WHERE r.code = 'payment_run_default'`)).rows;
    expect(rule).toEqual([{ enabled: true, condition: { field: 'amount', op: 'gt', value: 0 }, approver_role: 'admin' }]);
    const inv = await invoice(supplier, 'FF2', 500);
    const runId = await runs.create({ paymentDate: day, treasuryAccountId: bank, lines: [{ invoiceId: inv, amount: 500 }], userId: manager.id });
    runIds.push(runId);
    expect(await runs.submit(runId, manager.id)).toEqual({ status: 'pending_approval' });
    const req = await approvals.forDocument('payment_run', runId);
    expect(req).toMatchObject({ rule_code: 'payment_run_default', status: 'pending' });
    expect(Number(req!.amount)).toBe(500);
    await approvals.decide(req!.id, { userId: admin.id, role: admin.role, storeId: null } as never, 'approve');
    expect((await runs.get(runId))!).toMatchObject({ status: 'approved', approved_by: admin.id });
    await runs.cancel(runId, admin.id);
  }, 60_000);
});
