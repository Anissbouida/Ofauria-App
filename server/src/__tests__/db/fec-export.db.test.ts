/**
 * Export FEC (avis CNC n° 24, art. 210 CGI) — intégration base migrée.
 *
 * On passe une facture fournisseur et son règlement, lettrés ensemble, avec un
 * libellé piégé (tabulation, saut de ligne), puis on exporte la journée :
 *   1. fichier conforme : en-tête des 18 colonnes, 18 champs par ligne, CRLF,
 *      numérotation continue 1..N, chaque écriture équilibrée, empreinte exacte ;
 *   2. nos lignes : tiers renseigné sur 4411, même code de lettrage daté,
 *      libellé nettoyé, numéro interne en fin de libellé, montants à virgule.
 *
 * La journée exportée peut contenir les écritures d'autres suites (parallèles) :
 * les contrôles du fichier sont généraux, ceux des lignes ciblent notre marqueur.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

const HEADER = [
  'JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib',
  'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit',
  'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise',
];

describe.skipIf(!hasTestDb)('Export FEC (avis CNC n° 24)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let buildFec: typeof import('../../services/fec.service.js').buildFec;
  let admin: string;
  const day = new Date().toISOString().slice(0, 10);
  const marker = `FEC-${RUN}`;

  beforeAll(async () => {
    repos = await importRepositories();
    buildFec = (await import('../../services/fec.service.js')).buildFec;
    const p = testPool();
    admin = (await p.query(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`)).rows[0].id;
    const aux = (await p.query(
      `SELECT aa.id FROM account_auxiliaries aa JOIN accounts a ON a.id = aa.account_id WHERE a.code = '4411' LIMIT 1`)).rows[0].id;
    const lettrage = crypto.randomUUID();
    const post = async (journal: string, n: number, lines: [string, string | null, number, number, string][]) => {
      const e = await p.query(
        `INSERT INTO journal_entries (entry_number, journal_id, entry_date, fiscal_period_id, description, source_kind, created_by)
         SELECT $1, j.id, $2::date, fn_ensure_fiscal_period($2::date), $3, 'manual', $4 FROM journals j WHERE j.code = $5 RETURNING id`,
        [`${marker}-${n}`, day, `Test ${marker}`, admin, journal]);
      let o = 0;
      for (const [code, auxId, debit, credit, label] of lines) {
        await p.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, line_order, account_id, auxiliary_id, debit, credit, label, lettrage_id)
           SELECT $1, $2, a.id, $3, $4, $5, $6, CASE WHEN a.code = '4411' THEN $7::uuid END FROM accounts a WHERE a.code = $8`,
          [e.rows[0].id, ++o, auxId, debit, credit, label, lettrage, code]);
      }
      await p.query(`UPDATE journal_entries SET status = 'posted', posted_at = now(), posted_by = $2 WHERE id = $1`, [e.rows[0].id, admin]);
    };
    await post('AC', 1, [['6181', null, 120.5, 0, `Charge\tpiégée\r\nsur deux lignes ${marker}`], ['4411', aux, 0, 120.5, `Facture ${marker}`]]);
    await post('BQ', 2, [['4411', aux, 120.5, 0, `Règlement ${marker}`], ['5141', null, 0, 120.5, `Banque ${marker}`]]);
  }, 60_000);

  afterAll(async () => {
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('produit un fichier conforme : 18 colonnes, numérotation continue, écritures équilibrées, empreinte exacte', async () => {
    const r = await buildFec({ start: day, end: day }, { userId: admin, ip: null });
    const lines = r.content.split('\r\n');
    expect(lines.pop()).toBe('');                       // fin de fichier en CRLF
    expect(lines[0].split('\t')).toEqual(HEADER);
    const rows = lines.slice(1).map(l => l.split('\t'));
    expect(rows.length).toBe(r.stats.lines);
    expect(rows.every(f => f.length === 18)).toBe(true);

    const nums = [...new Set(rows.map(f => Number(f[2])))];
    expect(nums).toEqual(nums.map((_, i) => i + 1));    // séquence continue 1..N
    const cents = (v: string) => Math.round(Number(v.replace(',', '.') || 0) * 100);
    const byNum = new Map<number, number>();
    for (const f of rows) byNum.set(Number(f[2]), (byNum.get(Number(f[2])) ?? 0) + cents(f[11]) - cents(f[12]));
    expect([...byNum.values()].every(v => v === 0)).toBe(true);
    expect(rows.every(f => /^\d{8}$/.test(f[3]) && /^\d{8}$/.test(f[9]) && /^\d{8}$/.test(f[15]))).toBe(true);

    expect(r.stats.sha256).toBe(crypto.createHash('sha256').update(r.content, 'utf8').digest('hex'));
    expect(r.attestation).toContain(r.stats.sha256);
    expect(r.filename).toMatch(/FEC\d{8}\.txt$/);
  });

  it('porte le tiers, un lettrage daté commun et un libellé nettoyé sur nos écritures', async () => {
    const r = await buildFec({ start: day, end: day }, { userId: admin, ip: null });
    const ours = r.content.split('\r\n').slice(1).map(l => l.split('\t')).filter(f => f[10]?.includes(marker));
    expect(ours).toHaveLength(4);
    const supplier = ours.filter(f => f[4] === '4411');
    expect(supplier).toHaveLength(2);
    expect(supplier.every(f => f[6] !== '' && f[7] !== '')).toBe(true);      // CompAuxNum / CompAuxLib
    expect(supplier[0][13]).not.toBe('');
    expect(supplier[0][13]).toBe(supplier[1][13]);                             // même code de lettrage
    expect(supplier.every(f => /^\d{8}$/.test(f[14]))).toBe(true);             // DateLet
    const charge = ours.find(f => f[4] === '6181')!;
    expect(charge[10]).toMatch(/^Charge piégée sur deux lignes .* \[FEC-.*-1\]$/);
    expect(charge[11]).toBe('120,50');
    expect(charge[12]).toBe('0,00');
    expect(ours.find(f => f[4] === '5141')![10]).toContain(`[${marker}-2]`);
  });
});
