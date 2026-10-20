// Test de bout en bout de la paie sur la base LOCALE, dans une seule
// transaction annulee a la fin : rien n'est ecrit.
//
// Parcours verifie (repositories et services reels, pas de mock) :
//   1. mensuel : generation du bulletin, paiement, cloture comptable
//      (4432 solde, 6171 = brut) ;
//   2. hebdo declare (mig 327) : acomptes avec retenue provisoire, bulletin
//      mensuel, blocages (semaine impayee, acomptes perimes, annulation
//      d'un acompte deduit), reste a payer, cloture comptable.
//
// Usage (depuis server/, base locale avec pointage) :
//   npx tsx scripts/e2e-paie.ts            -> mois par defaut : juillet 2026
//   npx tsx scripts/e2e-paie.ts 7 2026
//
// Pieges : les modules de l'app ouvrent leur propre pg.Pool ; on remplace
// pg.Pool.prototype pour router toutes les requetes vers UNE connexion en
// transaction (BEGIN/COMMIT internes -> SAVEPOINT), et on verifie le txid.
import pg from 'pg';

const MONTH = parseInt(process.argv[2] ?? '7', 10);
const YEAR = parseInt(process.argv[3] ?? '2026', 10);
const url = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) throw new Error('Base non locale : test refuse.');

const conn = new pg.Client({ connectionString: url });
await conn.connect();
await conn.query('BEGIN');
const txid = (await conn.query('SELECT txid_current() AS t')).rows[0].t;
let sp = 0;
const tx = {
  query: async (text: any, params?: any) => {
    const t = typeof text === 'string' ? text.trim().toUpperCase() : '';
    if (t === 'BEGIN') { sp++; return conn.query(`SAVEPOINT s${sp}`); }
    if (t === 'COMMIT') return conn.query(`RELEASE SAVEPOINT s${sp--}`);
    if (t === 'ROLLBACK') return conn.query(`ROLLBACK TO SAVEPOINT s${sp--}`);
    return conn.query(text, params);
  },
  release: () => undefined,
};
(pg.Pool.prototype as any).query = function (text: any, params?: any) { return tx.query(text, params); };
(pg.Pool.prototype as any).connect = async function () { return tx; };

const { weeklyPayrollRepository } = await import('../src/repositories/weekly-payroll.repository.js');
const { payrollRepository } = await import('../src/repositories/employee.repository.js');
const { payrollLedger } = await import('../src/services/payroll-ledger.service.js');

const n = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const pad = (x: number) => String(x).padStart(2, '0');
const start = `${YEAR}-${pad(MONTH)}-01`;
const end = new Date(Date.UTC(YEAR, MONTH, 0)).toISOString().slice(0, 10);
let failures = 0;
const ok = (cond: boolean, label: string, detail?: unknown) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${detail !== undefined ? ` ${JSON.stringify(detail)}` : ''}`);
  if (!cond) failures++;
};
const rejects = async (fn: () => Promise<unknown>, pattern: RegExp, label: string) => {
  try { await fn(); ok(false, `${label} (accepte a tort)`); }
  catch (e: any) { ok(pattern.test(e.message), label, e.message); }
};
let preexisting: string[] = [];
async function balances(payrollId: string, employeeId: string, paymentRefs: string[]) {
  const rows = (await conn.query(
    `SELECT a.code, ROUND(SUM(l.debit - l.credit), 2) AS solde
       FROM journal_entry_lines l
       JOIN journal_entries e ON e.id = l.journal_entry_id
       JOIN accounts a ON a.id = l.account_id
      WHERE a.code IN ('6171', '4432')
        AND (e.source_id = $1
             OR e.source_id IN (SELECT id FROM payments WHERE employee_id = $2 AND type = 'salary'
                                  AND reference LIKE ANY($3) AND id <> ALL($4::uuid[]))
             -- reclassement du bulletin : sa piece source peut etre un paiement anterieur
             OR (e.source_detail = 'payroll-settlement' AND e.description LIKE '%' || $5 || '%'
                 AND e.source_id IN (SELECT id FROM payments WHERE employee_id = $2)))
      GROUP BY 1`, [payrollId, employeeId, paymentRefs, preexisting, `${pad(MONTH)}/${YEAR}`])).rows;
  return Object.fromEntries(rows.map((r: any) => [r.code, n(r.solde)]));
}

try {
  const U = (await conn.query(`SELECT id FROM users WHERE role = 'admin' AND is_active ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  if (!U) throw new Error('Aucun admin en base.');
  const period = (await conn.query(`SELECT status FROM payroll_periods WHERE year = $1 AND month = $2`, [YEAR, MONTH])).rows[0];
  if (period?.status === 'closed') throw new Error(`${pad(MONTH)}/${YEAR} est cloture : choisissez un mois ouvert.`);

  // ─── 1. Salarie mensuel ───
  console.log(`\nMensuel ${pad(MONTH)}/${YEAR}`);
  const { payrolls } = await payrollRepository.generate(MONTH, YEAR);
  const monthly = payrolls.find((p: any) => p.pay_frequency === 'monthly' && !p.paid && n(p.net_salary) > 0) as any;
  ok(!!monthly, 'au moins un bulletin mensuel genere');
  if (monthly) {
    ok(Math.abs(n(monthly.gross_salary) - n(monthly.cnss_employee) - n(monthly.amo_employee) - n(monthly.cimr_employee)
      - n(monthly.ir_net) - n(monthly.other_deductions) - n(monthly.net_salary)) < 0.02, 'net = brut - cotisations - IR - retenues');
    await payrollRepository.markPaid(monthly.id, 'cash', U);
    await payrollLedger.postMonth(MONTH, YEAR, U);
    const b = await balances(monthly.id, monthly.employee_id, [`SAL-${MONTH}/${YEAR}-%`]);
    ok(Math.abs((b['4432'] ?? 0)) < 0.01, '4432 net a payer solde', b);
    ok(Math.abs((b['6171'] ?? 0) - n(monthly.gross_salary)) < 0.02, '6171 = brut du bulletin', { attendu: monthly.gross_salary });
    await payrollLedger.reverseMonth(MONTH, YEAR);
  }

  // ─── 2. Salarie hebdo declare ───
  console.log(`\nHebdo declare ${pad(MONTH)}/${YEAR}`);
  const emp = (await conn.query(
    `SELECT e.id FROM employees e
      WHERE e.is_active AND e.pay_frequency = 'weekly' AND e.is_declared IS NOT FALSE AND e.weekly_salary > 0
        AND EXISTS (SELECT 1 FROM attendance a WHERE a.employee_id = e.id AND a.is_expected = false AND a.date BETWEEN $1 AND $2)
      LIMIT 1`, [start, end])).rows[0];
  if (!emp) {
    console.log('  (aucun salarie hebdo declare pointe ce mois : partie ignoree)');
  } else {
    // Etat de depart propre : semaines du mois non payees (annule au ROLLBACK).
    const weekStarts = (await conn.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS ws, to_char(d + 6, 'YYYY-MM-DD') AS we
         FROM generate_series(date_trunc('week', $1::date - 3)::date, $2::date, '7 days'::interval) g(t), LATERAL (SELECT t::date AS d) x
        WHERE (d + 3) BETWEEN $1::date AND $2::date`, [start, end])).rows;
    // Paiements deja presents (ancien modele) : exclus du controle comptable.
    preexisting = (await conn.query(`SELECT id FROM payments WHERE type = 'salary' AND employee_id = $1`, [emp.id])).rows.map((r: any) => r.id);
    await conn.query(`UPDATE weekly_payroll SET paid = false WHERE employee_id = $1 AND week_start = ANY($2::date[])`,
      [emp.id, weekStarts.map((w: any) => w.ws)]);
    for (const w of weekStarts) await weeklyPayrollRepository.generate(w.ws, w.we);
    const weeks = (await conn.query(
      `SELECT * FROM weekly_payroll WHERE employee_id = $1 AND week_start = ANY($2::date[]) ORDER BY week_start`,
      [emp.id, weekStarts.map((w: any) => w.ws)])).rows;
    ok(weeks.length > 0 && weeks.every((w: any) => n(w.withholding_amount) > 0 || n(w.gross_amount) === 0), 'acomptes avec retenue provisoire', weeks.length);
    ok(weeks.every((w: any) => Math.abs(n(w.gross_amount) - n(w.withholding_amount) - n(w.net_amount)) < 0.01), 'net acompte = brut - retenue');

    const { payrolls: p1 } = await payrollRepository.generate(MONTH, YEAR);
    const slip = p1.find((p: any) => p.employee_id === emp.id) as any;
    ok(!!slip && slip.pay_frequency === 'weekly', 'bulletin mensuel genere pour l\'hebdo declare');
    const grossWeeks = weeks.reduce((s: number, w: any) => s + n(w.gross_amount), 0);
    ok(Math.abs(n(slip.gross_salary) - n(slip.seniority_bonus) - grossWeeks) < 0.02, 'brut du bulletin = semaines du mois + anciennete',
      { brut: slip.gross_salary, semaines: grossWeeks.toFixed(2) });
    await rejects(() => payrollRepository.markPaid(slip.id, 'cash', U), /non payée/, 'paiement bloque tant qu\'une semaine est impayee');

    for (const w of weeks) await weeklyPayrollRepository.markPaid(w.id, 'cash', U);
    await rejects(() => payrollRepository.markPaid(slip.id, 'cash', U), /régénérez/, 'paiement bloque si acomptes perimes');

    const { payrolls: p2 } = await payrollRepository.generate(MONTH, YEAR);
    const slip2 = p2.find((p: any) => p.id === slip.id) as any;
    const acomptes = weeks.reduce((s: number, w: any) => s + n(w.net_amount), 0);
    ok(Math.abs(n(slip2.acomptes_amount) - acomptes) < 0.01, 'acomptes du bulletin = nets verses', slip2.acomptes_amount);
    const reste = n(slip2.net_salary) - n(slip2.acomptes_amount);
    ok(reste > -0.01 && reste < n(slip2.net_salary) * 0.05 + 1, 'reste a payer faible et positif (retenue provisoire juste)', reste.toFixed(2));

    await payrollRepository.markPaid(slip.id, 'cash', U);
    await rejects(() => weeklyPayrollRepository.unmarkPaid(weeks[0].id, U), /déjà payé/, 'acompte deduit d\'un bulletin paye non annulable');

    await payrollLedger.postMonth(MONTH, YEAR, U);
    const b = await balances(slip.id, emp.id, [`SAL-${MONTH}/${YEAR}-%`, ...weekStarts.map((w: any) => `SAL-S${w.ws}-%`)]);
    ok(Math.abs(b['4432'] ?? 0) < 0.01, '4432 solde (acomptes + reste = net)', b);
    ok(Math.abs((b['6171'] ?? 0) - n(slip2.gross_salary)) < 0.02, '6171 = brut du bulletin (acomptes reclasses)', { attendu: slip2.gross_salary });
  }

  const t = (await conn.query('SELECT txid_current() AS t')).rows[0].t;
  ok(t === txid, 'toutes les ecritures sont restees dans la transaction de test');
} catch (e: any) {
  failures++;
  console.error('ECHEC', e.stack ?? e);
} finally {
  await conn.query('ROLLBACK');
  await conn.end();
  console.log(`\n${failures ? `${failures} echec(s)` : 'Tout est vert'} — transaction annulee, base inchangee.`);
  process.exit(failures ? 1 : 0);
}
