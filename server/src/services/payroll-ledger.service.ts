import type { PoolClient } from 'pg';
import { db } from '../config/database.js';
import { FLAGS } from '../config/feature-flags.js';
import { paymentRepository } from '../repositories/accounting.repository.js';
import { persistEntry, reverseEntriesForSource, type GeneratedEntry, type GeneratedLine } from './journal-generator.service.js';

/**
 * Comptabilisation de la paie mensuelle (lot 5, mig 319).
 *
 * 1. Ecriture de paie (OD) par bulletin, a la CLOTURE du mois (bulletins
 *    figes), datee du dernier jour du mois :
 *      D 6171 brut                     D 6174 charges patronales
 *      C 4441 CNSS + AMO (sal. + pat.) + alloc. familiales + TFP
 *      C 4443 CIMR (sal. + pat.)       C 44525 IR retenu
 *      C 3431 (ou compte de la rubrique) retenues diverses
 *      C 4432 net a payer
 *    source : manual / payroll.id / 'payroll-accrual'.
 * 2. Reclassement au paiement : le paiement de salaire (generateur
 *    d'ecritures commun) debite 6171, et la retenue d'avance aussi (OD
 *    6171/3431). Quand l'ecriture de paie existe, on solde la dette :
 *      D 4432 / C 6171 du net du bulletin
 *    source : manual / payment.id / 'payroll-settlement'. Net : le salaire
 *    n'est passe qu'une fois en charge, et 4432 revient a zero.
 * 3. Rouvrir le mois extourne les deux ; annuler un paiement extourne le
 *    reclassement.
 * Les paies hebdo/quinzaine (sans cotisations) restent en charge au paiement.
 */

type Row = Record<string, any>;
const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (month: number, year: number) =>
  `${year}-${pad(month)}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;

export const ACCRUAL_DETAIL = 'payroll-accrual';
export const SETTLEMENT_DETAIL = 'payroll-settlement';

/** Ecriture de paie d'un bulletin (pure : la ligne payroll + ses retenues). */
export function buildAccrualEntry(p: Row, retenues: Array<{ amount: unknown; account_code?: string | null; label: string }>): GeneratedEntry | null {
  const name = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
  const lbl = `Paie ${pad(p.month)}/${p.year} ${name}`.trim();
  const lines: GeneratedLine[] = [];
  const add = (account_code: string, debit: number, credit: number, label: string) => {
    if (r2(debit) > 0 || r2(credit) > 0) lines.push({ account_code, debit: r2(debit), credit: r2(credit), label });
  };

  add('6171', num(p.gross_salary), 0, `Salaires bruts ${lbl}`);
  add('6174', num(p.total_charges_patron), 0, `Charges patronales ${lbl}`);
  add('4441', 0,
    num(p.cnss_employee) + num(p.amo_employee) + num(p.cnss_employer) + num(p.amo_employer)
      + num(p.alloc_familiales) + num(p.taxe_fp),
    `CNSS / AMO ${lbl}`);
  add('4443', 0, num(p.cimr_employee) + num(p.cimr_employer), `CIMR ${lbl}`);
  add('44525', 0, num(p.ir_net), `IR retenu ${lbl}`);
  // Retenues regroupees par compte de contrepartie.
  const byAccount = new Map<string, number>();
  for (const r of retenues) {
    const code = r.account_code || '3431';
    byAccount.set(code, (byAccount.get(code) ?? 0) + num(r.amount));
  }
  for (const [code, amount] of byAccount) add(code, 0, amount, `Retenues ${lbl}`);
  add('4432', 0, num(p.net_salary), `Net à payer ${lbl}`);

  const debit = r2(lines.reduce((s, l) => s + l.debit, 0));
  const credit = r2(lines.reduce((s, l) => s + l.credit, 0));
  if (debit === 0) return null;
  // Ecart d'arrondi (centimes) : porte sur le net a payer, jamais silencieux au-dela.
  const gap = r2(debit - credit);
  if (Math.abs(gap) > 0.05) throw new Error(`Ecriture de paie desequilibree (${gap} DH) pour ${name}`);
  if (gap !== 0) {
    const net = lines.find(l => l.account_code === '4432');
    if (net) net.credit = r2(net.credit + gap);
  }

  return {
    journal_code: 'OD',
    entry_date: lastDay(p.month, p.year),
    description: lbl,
    source_kind: 'manual',
    source_id: p.id,
    source_detail: ACCRUAL_DETAIL,
    store_id: p.store_id ?? null,
    lines,
  };
}

/** Paiements de salaire (non annules) d'un bulletin mensuel. */
async function salaryPayments(q: PoolClient | typeof db, p: Row): Promise<Row[]> {
  const hasStatus = await paymentsHaveStatus(q);
  const r = await q.query(
    `SELECT * FROM payments
      WHERE type = 'salary' AND employee_id = $1 AND reference LIKE $2
        ${hasStatus ? "AND status <> 'void' AND voids_payment_id IS NULL" : ''}
      ORDER BY created_at`,
    [p.employee_id, `SAL-${p.month}/${p.year}-%`]
  );
  return r.rows;
}

let statusColumn: boolean | null = null;
async function paymentsHaveStatus(q: PoolClient | typeof db): Promise<boolean> {
  if (statusColumn === null) {
    const r = await q.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'payments' AND column_name = 'voids_payment_id'`
    );
    statusColumn = (r.rowCount ?? 0) > 0;
  }
  return statusColumn;
}

async function hasAccrual(client: PoolClient, payrollId: string): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM journal_entries WHERE source_id = $1 AND source_detail = $2 AND status <> 'reversed' LIMIT 1`,
    [payrollId, ACCRUAL_DETAIL]
  );
  return (r.rowCount ?? 0) > 0;
}

async function loadPayroll(client: PoolClient, payrollId: string): Promise<Row | null> {
  const r = await client.query(
    `SELECT p.*, e.first_name, e.last_name, e.store_id
       FROM payroll p JOIN employees e ON e.id = p.employee_id WHERE p.id = $1`,
    [payrollId]
  );
  return r.rows[0] ?? null;
}

async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Reclassement D 4432 / C 6171 pour un bulletin paye dont l'ecriture de paie existe. */
async function ensureSettlement(client: PoolClient, p: Row, userId: string) {
  if (!p.paid) return;
  const pays = await salaryPayments(client, p);
  // Source : le paiement ; s'il n'y en a pas (net entierement retenu sur
  // avance), la premiere retenue. Jamais le bulletin, qui porte l'ecriture de paie.
  const reps = pays.length ? [] : await repaymentIds(client, p.id);
  const sourceId = pays[0]?.id ?? reps[0];
  if (!sourceId) return;
  const amount = r2(num(p.net_salary));
  if (amount <= 0) return;
  await persistEntry(client, {
    journal_code: 'OD',
    entry_date: String(pays[0]?.payment_date ? isoOf(pays[0].payment_date) : lastDay(p.month, p.year)),
    description: `Règlement paie ${pad(p.month)}/${p.year} ${p.first_name} ${p.last_name}`,
    source_kind: 'manual',
    source_id: sourceId,
    source_detail: SETTLEMENT_DETAIL,
    store_id: p.store_id ?? null,
    lines: [
      { account_code: '4432', debit: amount, credit: 0, label: 'Net payé (dette soldée)' },
      { account_code: '6171', debit: 0, credit: amount, label: 'Reclassement paiement salaire' },
    ],
  }, { userId });
}

async function repaymentIds(client: PoolClient, payrollId: string): Promise<string[]> {
  const r = await client.query(
    'SELECT id FROM salary_advance_repayments WHERE payroll_id = $1 ORDER BY created_at, id', [payrollId]
  );
  return r.rows.map((x: Row) => x.id as string);
}

async function reverseSettlement(client: PoolClient, p: Row) {
  const pays = await salaryPayments(client, p);
  for (const id of [...pays.map(x => x.id as string), ...(await repaymentIds(client, p.id))]) {
    await reverseManual(client, id, SETTLEMENT_DETAIL);
  }
}

/** Extourne les ecritures 'manual' d'une source portant ce source_detail. */
async function reverseManual(client: PoolClient, sourceId: string, detail: string) {
  const r = await client.query(
    `SELECT 1 FROM journal_entries WHERE source_id = $1 AND source_detail = $2 AND status <> 'reversed' LIMIT 1`,
    [sourceId, detail]
  );
  if (!r.rowCount) return;
  // reverseEntriesForSource traite toutes les ecritures 'manual' de la source :
  // chaque source ne porte ici qu'un seul type (bulletin -> paie, paiement -> reclassement).
  await reverseEntriesForSource(client, { sourceId, sourceKinds: ['manual'] });
}

function isoOf(d: unknown): string {
  if (d instanceof Date) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return String(d).slice(0, 10);
}

export const payrollLedger = {
  /**
   * Cloture du mois : ecriture de paie de chaque bulletin (+ reclassement des
   * bulletins deja payes). Idempotent (persistEntry ne double jamais).
   */
  async postMonth(month: number, year: number, userId: string): Promise<{ posted: number }> {
    if (!FLAGS.LEDGER_AUTOGEN) return { posted: 0 };
    return withTx(async client => {
      const ids = await client.query('SELECT id FROM payroll WHERE month = $1 AND year = $2', [month, year]);
      let posted = 0;
      for (const { id } of ids.rows) {
        const p = await loadPayroll(client, id);
        if (!p) continue;
        const retenues = (await client.query(
          `SELECT l.amount, l.label, r.account_code
             FROM payroll_lines l JOIN payroll_rubriques r ON r.id = l.rubrique_id
            WHERE l.payroll_id = $1 AND l.kind = 'retenue'`,
          [id]
        )).rows;
        const entry = buildAccrualEntry(p, retenues);
        if (!entry) continue;
        const res = await persistEntry(client, entry, { userId });
        if (res.created) posted++;
        await ensureSettlement(client, p, userId);
      }
      return { posted };
    });
  },

  /** Reouverture du mois : extourne ecritures de paie et reclassements. */
  async reverseMonth(month: number, year: number): Promise<{ reversed: number }> {
    if (!FLAGS.LEDGER_AUTOGEN) return { reversed: 0 };
    return withTx(async client => {
      const ids = await client.query('SELECT id FROM payroll WHERE month = $1 AND year = $2', [month, year]);
      let reversed = 0;
      for (const { id } of ids.rows) {
        const p = await loadPayroll(client, id);
        if (!p) continue;
        if (await hasAccrual(client, id)) reversed++;
        await reverseSettlement(client, p);
        await reverseManual(client, id, ACCRUAL_DETAIL);
      }
      return { reversed };
    });
  },

  /** Apres paiement d'un bulletin : reclassement si le mois est deja comptabilise. */
  async afterPaid(payrollId: string, userId: string) {
    if (!FLAGS.LEDGER_AUTOGEN) return;
    await withTx(async client => {
      const p = await loadPayroll(client, payrollId);
      if (p && await hasAccrual(client, payrollId)) await ensureSettlement(client, p, userId);
    });
  },

  /** Avant annulation d'un paiement : extourne le reclassement. */
  async beforeUnpaid(payrollId: string) {
    if (!FLAGS.LEDGER_AUTOGEN) return;
    await withTx(async client => {
      const p = await loadPayroll(client, payrollId);
      if (p) await reverseSettlement(client, p);
    });
  },
};

/**
 * Annule un paiement de paie (salaire ou avance). Un paiement en brouillon se
 * supprime ; un paiement EXECUTE (cas normal depuis la mig 310) ne se supprime
 * plus : contre-piece de montant oppose + extourne de ses ecritures, comme
 * l'annulation de la Tresorerie (qui refuse les paiements de paie et renvoie
 * vers ce module). Sans cette voie, « Annuler le paiement » echouait toujours.
 */
export async function cancelPayrollPayment(paymentId: string, userId: string | undefined, note: string) {
  if (!(await paymentsHaveStatus(db))) {
    await paymentRepository.delete(paymentId);
    return;
  }
  const st = await db.query('SELECT status FROM payments WHERE id = $1', [paymentId]);
  if (!st.rows[0]) return;
  if (st.rows[0].status === 'draft') { await paymentRepository.delete(paymentId); return; }
  if (st.rows[0].status === 'void') return;

  await withTx(async client => {
    const actor = userId ?? (await client.query(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`)).rows[0]?.id;
    const reason = await client.query(
      `SELECT id FROM ref_entries WHERE table_id = 'purchase_reason_codes' AND code = 'payroll_cancel'`
    );
    if (!reason.rows[0]) throw new Error('Motif « payroll_cancel » absent : appliquez la migration 319');
    const r = await client.query('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [paymentId]);
    const p = r.rows[0];
    if (p.cashed_at) throw new Error('Paiement déjà encaissé : annulez d\'abord l\'encaissement en Trésorerie.');
    await client.query(
      `UPDATE payments SET status = 'void', voided_at = now(), voided_by = $2, void_reason_code_id = $3,
              void_note = $4, updated_by = $2 WHERE id = $1`,
      [paymentId, actor, reason.rows[0].id, note]
    );
    // Contre-piece : memes attributs, montant oppose, meme date (cumuls du jour neutralises).
    await client.query(
      `INSERT INTO payments (reference, type, category_id, employee_id, amount, payment_method, payment_mode,
          payment_date, description, created_by, store_id, treasury_account_id, status, voids_payment_id,
          executed_at, executed_by)
       SELECT reference, type, category_id, employee_id, -amount, payment_method, payment_mode,
          payment_date, 'Annulation : ' || COALESCE(description, reference, ''), $2, store_id, treasury_account_id,
          'void', id, now(), $2
         FROM payments WHERE id = $1`,
      [paymentId, actor]
    );
    if (FLAGS.LEDGER_AUTOGEN) {
      await reverseEntriesForSource(client, { sourceId: paymentId, sourceKinds: ['payment', 'backfill'] });
    }
  });
}
