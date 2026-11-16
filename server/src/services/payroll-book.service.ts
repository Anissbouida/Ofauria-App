import { db } from '../config/database.js';
import type { Edition, EditionCol, EditionRow } from './ledger-editions.service.js';

/**
 * G0-12 (plan d'action 2026-11) — livre de paie.
 *
 * Une ligne par salarié et par mois, reprise TELLE QUELLE des bulletins (aucun
 * recalcul) : les totaux du livre sont donc la somme des bulletins du mois.
 * Sorties : données (écran), PDF paysage et Excel, par mois ou par année, via le
 * moteur d'éditions commun (ledger-editions.service).
 *
 * La présentation est à faire valider par le comptable avant diffusion.
 */
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

/** Colonnes chiffrées du livre, dans l'ordre d'affichage. */
export const BOOK_AMOUNTS = ['base', 'overtime', 'bonuses', 'gross', 'cnss', 'amo', 'cimr', 'ir', 'advances', 'net'] as const;
export type BookAmount = typeof BOOK_AMOUNTS[number];

export interface PayrollBookLine extends Record<BookAmount, number> {
  payroll_id: string; employee_id: string; month: number; year: number;
  name: string; cnss_number: string | null; cin: string | null; days: number; paid: boolean;
}
export interface PayrollBookMonth { month: number; year: number; label: string; lines: PayrollBookLine[]; totals: Record<BookAmount, number> }
export interface PayrollBook { year: number; month: number | null; months: PayrollBookMonth[]; totals: Record<BookAmount, number>; count: number }

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);
const zero = (): Record<BookAmount, number> => Object.fromEntries(BOOK_AMOUNTS.map(k => [k, 0])) as Record<BookAmount, number>;
const add = (into: Record<BookAmount, number>, l: Record<BookAmount, number>) => { for (const k of BOOK_AMOUNTS) into[k] = r2(into[k] + l[k]); };

export async function loadPayrollBook(p: { year: number; month?: number | null; storeId?: string | null }): Promise<PayrollBook> {
  const params: unknown[] = [p.year];
  let where = 'p.year = $1';
  if (p.month) { params.push(p.month); where += ` AND p.month = $${params.length}`; }
  if (p.storeId) { params.push(p.storeId); where += ` AND (e.store_id = $${params.length} OR e.store_id IS NULL)`; }
  const rows = (await db.query(
    `SELECT p.id AS payroll_id, p.employee_id, p.month, p.year, p.paid,
            e.last_name || ' ' || e.first_name AS name, e.cnss_number, e.cin,
            p.worked_days, p.base_salary, p.overtime_amount, p.bonuses, p.gross_salary,
            p.cnss_employee, p.amo_employee, p.cimr_employee, p.ir_net, p.advance_deduction, p.net_salary
       FROM payroll p JOIN employees e ON e.id = p.employee_id
      WHERE ${where}
      ORDER BY p.month, e.last_name, e.first_name, p.id`, params)).rows as Record<string, unknown>[];

  const months = new Map<number, PayrollBookMonth>();
  const totals = zero();
  for (const r of rows) {
    const line: PayrollBookLine = {
      payroll_id: String(r.payroll_id), employee_id: String(r.employee_id), month: Number(r.month), year: Number(r.year),
      name: String(r.name), cnss_number: (r.cnss_number as string) ?? null, cin: (r.cin as string) ?? null,
      days: num(r.worked_days), paid: r.paid === true,
      base: num(r.base_salary), overtime: num(r.overtime_amount), bonuses: num(r.bonuses), gross: num(r.gross_salary),
      cnss: num(r.cnss_employee), amo: num(r.amo_employee), cimr: num(r.cimr_employee), ir: num(r.ir_net),
      advances: num(r.advance_deduction), net: num(r.net_salary),
    };
    let m = months.get(line.month);
    if (!m) { m = { month: line.month, year: line.year, label: `${MONTHS[line.month - 1]} ${line.year}`, lines: [], totals: zero() }; months.set(line.month, m); }
    m.lines.push(line);
    add(m.totals, line);
    add(totals, line);
  }
  return { year: p.year, month: p.month ?? null, months: [...months.values()], totals, count: rows.length };
}

/** Livre mis en forme pour le moteur d'éditions (PDF paysage / Excel). */
export function payrollBookEdition(book: PayrollBook): Edition {
  const amt = (key: BookAmount, label: string): EditionCol => ({ key, label, width: 7.4, align: 'right', amount: true });
  const rows: EditionRow[] = [];
  const amounts = (o: Record<BookAmount, number>) => Object.fromEntries(BOOK_AMOUNTS.map(k => [k, o[k] || null]));
  const byYear = !book.month;
  for (const m of book.months) {
    if (byYear) rows.push({ kind: 'group', cells: { name: m.label } });
    for (const l of m.lines) {
      rows.push({ kind: 'line', cells: { name: l.name, cnss_number: l.cnss_number ?? '', days: l.days || null, ...amounts(l) } });
    }
    if (byYear) rows.push({ kind: 'subtotal', cells: { name: `Total ${m.label} (${m.lines.length} bulletin(s))`, ...amounts(m.totals) } });
  }
  rows.push({ kind: 'total', cells: { name: `Total ${byYear ? book.year : book.months[0]?.label ?? ''} (${book.count} bulletin(s))`.trim(), ...amounts(book.totals) } });
  const period = byYear ? `Exercice ${book.year}` : `${MONTHS[(book.month ?? 1) - 1]} ${book.year}`;
  return {
    key: `livre_de_paie_${book.year}${book.month ? `-${String(book.month).padStart(2, '0')}` : ''}`,
    title: 'Livre de paie', period, orientation: 'landscape',
    columns: [
      { key: 'name', label: 'Salarié', width: 15 },
      { key: 'cnss_number', label: 'N° CNSS', width: 7.5 },
      { key: 'days', label: 'Jours', width: 3.5, align: 'right' },
      amt('base', 'Base'), amt('overtime', 'Heures sup.'), amt('bonuses', 'Primes'), amt('gross', 'Brut'),
      amt('cnss', 'CNSS'), amt('amo', 'AMO'), amt('cimr', 'CIMR'), amt('ir', 'IR'), amt('advances', 'Avances'), amt('net', 'Net'),
    ],
    rows,
    notes: ['Montants repris des bulletins de paie, sans recalcul. Cotisations : part salariale.'],
  };
}
