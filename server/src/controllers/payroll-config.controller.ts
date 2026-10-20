import type { Response } from 'express';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { db } from '../config/database.js';
import { checkStoreOwnership } from '../middleware/tenant.middleware.js';
import { payrollRepository } from '../repositories/employee.repository.js';
import {
  taxScaleRepository, payrollSettingsRepository, rubriqueRepository,
  employeePayrollItemRepository, payrollPeriodRepository, monthBounds,
} from '../repositories/payroll-config.repository.js';
import { settingsRepository } from '../repositories/settings.repository.js';
import { serviceYears } from '../services/payroll-engine.js';
import { generatePayslipPdf, type PayslipLineRow } from '../services/payslip-pdf.service.js';
import { companyLegalFromRow } from '../utils/company-legal.js';
import { payrollLedger } from '../services/payroll-ledger.service.js';
import { payrollDeclarationRepository, type DeclarationKind } from '../repositories/payroll-declarations.repository.js';

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const METHODS: Record<string, string> = { cash: 'espèces', bank: 'virement', check: 'chèque' };

const fail = (res: Response, err: unknown, status = 400) =>
  res.status(status).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });

/** Bulletin + identite du salarie (pour le PDF). */
export async function loadPayrollForPdf(id: string) {
  const r = await db.query(
    `SELECT p.*, e.store_id, e.first_name, e.last_name, e.cin, e.cnss_number, e.role, e.hire_date,
            e.contract_type, e.seniority_years, e.nb_dependents AS emp_dependents
       FROM payroll p JOIN employees e ON e.id = p.employee_id WHERE p.id = $1`,
    [id]
  );
  return r.rows[0] ?? null;
}

async function payrollInScope(id: string, userStoreId?: string) {
  const r = await db.query(
    `SELECT p.*, e.store_id, e.first_name, e.last_name, e.cin, e.cnss_number, e.role, e.hire_date,
            e.contract_type, e.seniority_years, e.nb_dependents AS emp_dependents
       FROM payroll p JOIN employees e ON e.id = p.employee_id WHERE p.id = $1`,
    [id]
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.store_id !== null && !checkStoreOwnership(row.store_id, userStoreId)) return null;
  return row;
}

async function employeeInScope(id: string, userStoreId?: string) {
  const r = await db.query('SELECT id, store_id FROM employees WHERE id = $1', [id]);
  const row = r.rows[0];
  if (!row) return null;
  if (row.store_id !== null && !checkStoreOwnership(row.store_id, userStoreId)) return null;
  return row;
}

const fr = (d: unknown) => {
  if (!d) return null;
  const s = d instanceof Date
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : String(d).slice(0, 10);
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
};
const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const fmt = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[\u202F\u00A0]/g, ' ');
const pct = (v: number) => `${(v * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;

function resolveLogo(logoUrl?: string | null): string | Buffer | null {
  if (logoUrl?.startsWith('data:')) {
    try { return Buffer.from(logoUrl.slice(logoUrl.indexOf(',') + 1), 'base64'); } catch { return null; }
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const candidates = [
    logoUrl ? resolve(root, 'uploads', logoUrl) : '',
    logoUrl ? resolve(root, logoUrl) : '',
    resolve(root, 'client', 'public', 'images', 'logo-horizontal.png'),
  ].filter(Boolean);
  return candidates.find(c => existsSync(c)) ?? null;
}

export const payrollConfigController = {
  // ─── Bulletin : lignes, PDF ───
  async lines(req: AuthRequest, res: Response) {
    if (!(await payrollInScope(req.params.id, req.user!.storeId))) { res.status(404).json({ success: false, error: { message: 'Bulletin introuvable' } }); return; }
    res.json({ success: true, data: await payrollRepository.lines(req.params.id) });
  },

  async setLines(req: AuthRequest, res: Response) {
    if (!(await payrollInScope(req.params.id, req.user!.storeId))) { res.status(404).json({ success: false, error: { message: 'Bulletin introuvable' } }); return; }
    try {
      const payroll = await payrollRepository.setManualLines(req.params.id, req.body.lines);
      res.json({ success: true, data: { payroll, lines: await payrollRepository.lines(req.params.id) } });
    } catch (err) { fail(res, err); }
  },

  async pdf(req: AuthRequest, res: Response) {
    const p = await payrollInScope(req.params.id, req.user!.storeId);
    if (!p) { res.status(404).json({ success: false, error: { message: 'Bulletin introuvable' } }); return; }
    await sendPayslipPdf(res, p);
  },

  // ─── Cloture de periode ───
  async period(req: AuthRequest, res: Response) {
    const month = parseInt(String(req.query.month), 10);
    const year = parseInt(String(req.query.year), 10);
    if (!month || !year) { res.status(400).json({ success: false, error: { message: 'month et year requis' } }); return; }
    res.json({ success: true, data: await payrollPeriodRepository.get(month, year) });
  },
  async closePeriod(req: AuthRequest, res: Response) {
    const { month, year } = req.body;
    // Comptabilise d'abord : si l'ecriture echoue (compte manquant, periode
    // comptable verrouillee), le mois reste ouvert et l'erreur est affichee.
    try {
      const { posted } = await payrollLedger.postMonth(month, year, req.user!.userId);
      await payrollPeriodRepository.close(month, year, req.user!.userId);
      res.json({ success: true, data: { ...(await payrollPeriodRepository.get(month, year)), entriesPosted: posted } });
    } catch (err) { fail(res, err); }
  },
  async reopenPeriod(req: AuthRequest, res: Response) {
    const { month, year } = req.body;
    // Extourne les ecritures de paie (refuse si la periode comptable est verrouillee).
    try {
      // Un mois deja declare (CNSS/IR/CIMR) ne se rouvre pas : ses montants
      // ont ete transmis, et un reglement solderait une dette extournee.
      const declared = await payrollDeclarationRepository.list(month, year);
      if (declared.length > 0) {
        throw new Error(`Mois déjà déclaré (${declared.map((d: Record<string, any>) => d.kind.toUpperCase()).join(', ')}) : régularisez sur le mois suivant plutôt que de le rouvrir.`);
      }
      const { reversed } = await payrollLedger.reverseMonth(month, year);
      await payrollPeriodRepository.reopen(month, year);
      res.json({ success: true, data: { ...(await payrollPeriodRepository.get(month, year)), entriesReversed: reversed } });
    } catch (err) { fail(res, err); }
  },

  // ─── Parametres ───
  async getSettings(_req: AuthRequest, res: Response) {
    const [settings, taxScales] = await Promise.all([payrollSettingsRepository.get(), taxScaleRepository.list()]);
    res.json({ success: true, data: { settings, taxScales } });
  },
  async updateSettings(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await payrollSettingsRepository.update(req.body, req.user!.userId) });
  },
  async updateTaxScale(req: AuthRequest, res: Response) {
    try {
      const row = await taxScaleRepository.update(req.params.id, req.body, req.user!.userId);
      if (!row) { res.status(404).json({ success: false, error: { message: 'Barème introuvable' } }); return; }
      res.json({ success: true, data: row });
    } catch (err) { fail(res, err); }
  },

  // ─── Rubriques ───
  async listRubriques(req: AuthRequest, res: Response) {
    res.json({ success: true, data: await rubriqueRepository.list(req.query.all === 'true') });
  },
  async createRubrique(req: AuthRequest, res: Response) {
    try { res.status(201).json({ success: true, data: await rubriqueRepository.create(req.body) }); }
    catch (err) {
      if ((err as { code?: string }).code === '23505') { fail(res, new Error('Ce code de rubrique existe déjà'), 409); return; }
      fail(res, err);
    }
  },
  async updateRubrique(req: AuthRequest, res: Response) {
    const row = await rubriqueRepository.update(req.params.id, req.body);
    if (!row) { res.status(404).json({ success: false, error: { message: 'Rubrique introuvable' } }); return; }
    res.json({ success: true, data: row });
  },

  // ─── Declarations CNSS / IR / CIMR ───
  async declarations(req: AuthRequest, res: Response) {
    const month = parseInt(String(req.query.month), 10);
    const year = parseInt(String(req.query.year), 10);
    if (!month || !year) { res.status(400).json({ success: false, error: { message: 'month et year requis' } }); return; }
    const [cnss, ir, cimr, declared, period] = await Promise.all([
      payrollDeclarationRepository.cnssStatement(month, year),
      payrollDeclarationRepository.irStatement(month, year),
      payrollDeclarationRepository.cimrTotal(month, year),
      payrollDeclarationRepository.list(month, year),
      payrollPeriodRepository.get(month, year),
    ]);
    res.json({ success: true, data: { cnss, ir, cimr, declared, period } });
  },
  async annualIr(req: AuthRequest, res: Response) {
    const year = parseInt(String(req.query.year), 10);
    if (!year) { res.status(400).json({ success: false, error: { message: 'year requis' } }); return; }
    res.json({ success: true, data: await payrollDeclarationRepository.annualIr(year) });
  },
  async declare(req: AuthRequest, res: Response) {
    const { kind, month, year, reference } = req.body as { kind: DeclarationKind; month: number; year: number; reference?: string | null };
    try { res.json({ success: true, data: await payrollDeclarationRepository.declare(kind, month, year, reference ?? null, req.user!.userId) }); }
    catch (err) { fail(res, err); }
  },
  async settle(req: AuthRequest, res: Response) {
    const { kind, month, year, paymentMethod, paymentDate } = req.body;
    try {
      res.json({ success: true, data: await payrollDeclarationRepository.settle(kind, month, year, {
        paymentMethod, paymentDate, userId: req.user!.userId, storeId: req.user!.storeId,
      }) });
    } catch (err) { fail(res, err); }
  },

  // ─── Elements fixes par employe ───
  async listItems(req: AuthRequest, res: Response) {
    if (!(await employeeInScope(req.params.employeeId, req.user!.storeId))) { res.status(404).json({ success: false, error: { message: 'Employe non trouve' } }); return; }
    res.json({ success: true, data: await employeePayrollItemRepository.listByEmployee(req.params.employeeId) });
  },
  async createItem(req: AuthRequest, res: Response) {
    if (!(await employeeInScope(req.params.employeeId, req.user!.storeId))) { res.status(404).json({ success: false, error: { message: 'Employe non trouve' } }); return; }
    try {
      const row = await employeePayrollItemRepository.create({ ...req.body, employeeId: req.params.employeeId }, req.user!.userId);
      res.status(201).json({ success: true, data: row });
    } catch (err) { fail(res, err); }
  },
  async updateItem(req: AuthRequest, res: Response) {
    const item = await employeePayrollItemRepository.findById(req.params.itemId);
    if (!item || !(await employeeInScope(item.employee_id, req.user!.storeId))) { res.status(404).json({ success: false, error: { message: 'Élément introuvable' } }); return; }
    try { res.json({ success: true, data: await employeePayrollItemRepository.update(req.params.itemId, req.body) }); }
    catch (err) { fail(res, err); }
  },
  async deleteItem(req: AuthRequest, res: Response) {
    const item = await employeePayrollItemRepository.findById(req.params.itemId);
    if (!item || !(await employeeInScope(item.employee_id, req.user!.storeId))) { res.status(404).json({ success: false, error: { message: 'Élément introuvable' } }); return; }
    await employeePayrollItemRepository.delete(req.params.itemId);
    res.json({ success: true, data: null });
  },
};

/** Genere et envoie le PDF d'un bulletin (gestion de paie ou espace employe). */
export async function sendPayslipPdf(res: Response, p: Record<string, any>) {
    const [lines, settings, company, roleRef, cumulRes, scaleRes] = await Promise.all([
    payrollRepository.lines(p.id),
    payrollSettingsRepository.get(),
    settingsRepository.get(),
    db.query(`SELECT label FROM ref_entries WHERE table_id = 'employee_roles' AND code = $1 LIMIT 1`, [p.role]),
    db.query(
      `SELECT COUNT(*)::int AS months,
              COALESCE(SUM(gross_salary), 0) AS gross, COALESCE(SUM(COALESCE(brut_imposable, gross_salary)), 0) AS brut_imposable,
              COALESCE(SUM(COALESCE(net_imposable,
                gross_salary - COALESCE(cnss_employee, 0) - COALESCE(amo_employee, 0) - COALESCE(cimr_employee, 0) - COALESCE(frais_pro, 0))), 0) AS net_imposable, COALESCE(SUM(ir_net), 0) AS ir,
              COALESCE(SUM(cnss_employee), 0) AS cnss, COALESCE(SUM(amo_employee), 0) AS amo, COALESCE(SUM(net_salary), 0) AS net
         FROM payroll WHERE employee_id = $1 AND year = $2 AND month <= $3`,
      [p.employee_id, p.year, p.month]
    ),
    db.query('SELECT * FROM payroll_tax_scales WHERE id = $1', [p.tax_scale_id]),
  ]);
  // Taux du bareme qui a servi au calcul (snapshot), pas ceux d'aujourd'hui.
  const sc = scaleRes.rows[0];
  const rate = (col: string) => (sc ? pct(num(sc[col])) : '');
  const { start, end } = monthBounds(p.month, p.year);
  const baseDays = num(settings.monthly_base_days) || 26;
  const daily = num(p.base_salary) / baseDays;
  const declared = p.is_declared !== false;

  const rows: PayslipLineRow[] = [
    { label: 'Salaire de base', base: `${baseDays} j`, rate: fmt(daily), gain: num(p.base_salary) },
  ];
  if (num(p.deductions) > 0) rows.push({ label: 'Absences non couvertes', base: `${num(p.absent_days)} j`, rate: fmt(daily), retenue: num(p.deductions) });
  if (num(p.seniority_bonus) > 0) rows.push({ label: 'Prime d\'ancienneté', base: fmt(num(p.base_salary) - num(p.deductions)), rate: p.seniority_rate != null ? pct(num(p.seniority_rate)) : '', gain: num(p.seniority_bonus) });
  if (num(p.overtime_amount) > 0) {
    // Detail par majoration (lot 3) ; bulletins anterieurs : une seule ligne.
    const hourly = num(p.base_salary) / (num(settings.monthly_legal_hours) || 191);
    const cats: Array<[string, number, number]> = [
      ['Heures sup. jour', num(p.ot_day_hours), num(settings.ot_rate_day ?? 0.25)],
      ['Heures sup. nuit', num(p.ot_night_hours), num(settings.ot_rate_night ?? 0.5)],
      ['Heures sup. repos (jour)', num(p.ot_rest_day_hours), num(settings.ot_rate_rest_day ?? 0.5)],
      ['Heures sup. repos (nuit)', num(p.ot_rest_night_hours), num(settings.ot_rate_rest_night ?? 1)],
    ];
    const detailed = cats.filter(c => c[1] > 0);
    if (detailed.length) {
      for (const [label, h, rate] of detailed) {
        rows.push({ label: `${label} (+${Math.round(rate * 100)} %)`, base: `${fmt(h)} h`, rate: fmt(hourly * (1 + rate)), gain: Math.round(h * hourly * (1 + rate) * 100) / 100 });
      }
      // Ecart d'arrondi eventuel : la derniere ligne porte le total exact.
      const sum = rows.slice(-detailed.length).reduce((s2, r) => s2 + (r.gain ?? 0), 0);
      rows[rows.length - 1].gain = Math.round(((rows[rows.length - 1].gain ?? 0) + num(p.overtime_amount) - sum) * 100) / 100;
    } else {
      rows.push({ label: 'Heures supplémentaires', base: `${num(p.overtime_hours).toFixed(2)} h`, gain: num(p.overtime_amount) });
    }
  }
  if (num(p.holiday_premium) > 0) rows.push({ label: 'Indemnité jour férié travaillé', base: `${num(p.holiday_worked_days)} j`, rate: fmt(daily), gain: num(p.holiday_premium) });
  if (num(p.extra_shift_amount) > 0) rows.push({ label: 'Doubles services', base: `${num(p.extra_shift_days)} j`, rate: fmt(daily), gain: num(p.extra_shift_amount) });
  for (const l of lines.filter((x: Record<string, any>) => x.kind === 'gain')) {
    rows.push({ label: l.label, gain: num(l.amount), note: num(l.exempt_amount) > 0 ? `dont ${fmt(num(l.exempt_amount))} exonérés` : undefined });
  }
  const cnssBase = Math.min(num(p.base_cnss ?? p.gross_salary), sc ? num(sc.cnss_plafond) : 6000);
  if (declared) {
    rows.push({ label: 'CNSS (prestations sociales)', base: fmt(cnssBase), rate: rate('cnss_rate_employee'), retenue: num(p.cnss_employee) });
    rows.push({ label: 'AMO', base: fmt(num(p.base_cnss ?? p.gross_salary)), rate: rate('amo_rate_employee'), retenue: num(p.amo_employee) });
    if (num(p.cimr_employee) > 0) rows.push({ label: 'CIMR', base: fmt(num(p.base_cnss ?? p.gross_salary)), retenue: num(p.cimr_employee) });
    // Regularisation annuelle (decembre / sortie, mig 325) : ligne distincte.
    const irReg = num(p.ir_regularisation);
    rows.push({ label: 'Impôt sur le revenu', base: fmt(num(p.net_imposable)), retenue: Math.round((num(p.ir_net) - irReg) * 100) / 100 });
    if (irReg > 0) rows.push({ label: 'Régularisation annuelle IR', note: 'recalcul sur le cumul de l\'année', retenue: irReg });
    if (irReg < 0) rows.push({ label: 'Régularisation annuelle IR (trop-perçu)', note: 'recalcul sur le cumul de l\'année', gain: -irReg });
  }
  for (const l of lines.filter((x: Record<string, any>) => x.kind === 'retenue')) rows.push({ label: l.label, retenue: num(l.amount) });

  // Le brut affiche en « Totaux » : gains - absences = brut.
  const totalRetenues = num(p.cnss_employee) + num(p.amo_employee) + num(p.cimr_employee) + num(p.ir_net) + num(p.other_deductions);
  const c = cumulRes.rows[0];
  const buffer = await generatePayslipPdf({
    company: { ...companyLegalFromRow(company), cnss: settings.employer_cnss_number },
    logo: resolveLogo(company?.logo_url),
    periodLabel: `${MONTHS[p.month - 1]} ${p.year}`,
    periodRange: `Du ${fr(start)} au ${fr(end)}`,
    employee: {
      name: `${p.first_name} ${p.last_name}`, cin: p.cin, cnss: p.cnss_number,
      role: roleRef.rows[0]?.label ?? p.role, hireDate: fr(p.hire_date),
      seniorityYears: serviceYears(p.hire_date ? (fr(p.hire_date) as string).split('/').reverse().join('-') : null, end) ?? (p.seniority_years ?? null),
      dependents: num(p.nb_dependents), contract: p.contract_type ? String(p.contract_type).toUpperCase() : null, declared,
    },
    workedDays: num(p.worked_days), baseDays, absentDays: num(p.absent_days), paidLeaveDays: num(p.paid_leave_days), holidayPaidDays: num(p.holiday_paid_days),
    lines: rows,
    // Trop-percu d'IR affiche en gain : ajoute aux deux totaux (net inchange).
    grossSalary: num(p.gross_salary) + num(p.deductions) + Math.max(0, -num(p.ir_regularisation)),
    totalRetenues: totalRetenues + num(p.deductions) + Math.max(0, -num(p.ir_regularisation)),
    netSalary: num(p.net_salary),
    advanceDeduction: num(p.advance_deduction),
    acomptes: num(p.acomptes_amount),
    bases: {
      brutImposable: num(p.brut_imposable ?? p.gross_salary), fraisPro: num(p.frais_pro),
      netImposable: num(p.net_imposable), irGross: num(p.ir_gross), familyDeduction: num(p.family_deduction),
    },
    employer: declared ? [
      { label: `CNSS patronale (${rate('cnss_rate_employer')})`, amount: num(p.cnss_employer) },
      { label: `AMO patronale (${rate('amo_rate_employer')})`, amount: num(p.amo_employer) },
      { label: `Allocations familiales (${rate('alloc_familiales_rate')})`, amount: num(p.alloc_familiales) },
      { label: `Taxe formation prof. (${rate('taxe_fp_rate')})`, amount: num(p.taxe_fp) },
      ...(num(p.cimr_employer) > 0 ? [{ label: 'CIMR patronale', amount: num(p.cimr_employer) }] : []),
    ] : [{ label: 'Salarié non déclaré', amount: 0 }],
    totalEmployer: num(p.total_charges_patron),
    cumuls: {
      months: c.months, gross: num(c.gross), brutImposable: num(c.brut_imposable), netImposable: num(c.net_imposable),
      ir: num(c.ir), cnss: num(c.cnss), amo: num(c.amo), net: num(c.net),
    },
    payment: p.paid ? { method: METHODS[p.payment_method] ?? p.payment_method, date: fr(p.paid_at) as string } : null,
    generatedAt: new Date().toLocaleDateString('fr-FR'),
  });
  const filename = `bulletin_${p.last_name}_${p.first_name}_${p.year}-${String(p.month).padStart(2, '0')}.pdf`.replace(/[^\w.-]/g, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
}
