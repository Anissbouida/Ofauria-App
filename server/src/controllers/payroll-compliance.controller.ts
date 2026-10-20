import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { db } from '../config/database.js';
import { checkStoreOwnership } from '../middleware/tenant.middleware.js';
import { payrollSettingsRepository, taxScaleRepository, monthBounds } from '../repositories/payroll-config.repository.js';
import { payrollDeclarationRepository } from '../repositories/payroll-declarations.repository.js';
import { buildEbds, parsePreetabli } from '../services/ebds.js';
import { loadCompanyLegal } from '../utils/company-legal.js';
import {
  generateEmploymentAttestationPdf, generateSalaryAttestationPdf, generateTransferOrderPdf,
} from '../services/hr-documents-pdf.service.js';
import { buildTransferCsv, formatRib, normalizeRib, ribKeyValid, splitTransferLines, type TransferLine } from '../services/salary-transfer.js';

/**
 * Conformite marocaine de la paie (mig 325) :
 *  - fichier e-BDS Damancom, genere depuis le preetabli CNSS du mois ;
 *  - ordre de virement groupe des salaires (CSV banque + lettre PDF) ;
 *  - attestations de travail et de salaire a la demande (salarie en poste).
 */

type Row = Record<string, any>;
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const CONTRACT_LABEL: Record<string, string> = {
  cdi: 'contrat à durée indéterminée', cdd: 'contrat à durée déterminée', stage: 'convention de stage',
  interim: 'contrat d\'intérim', saisonnier: 'contrat saisonnier',
};
const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const iso = (d: unknown) => {
  if (!d) return '';
  return d instanceof Date
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : String(d).slice(0, 10);
};
const fr = (d: unknown) => { const s = iso(d); return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : ''; };
const safe = (s: string) => s.replace(/[^\w.-]/g, '_');

function sendPdf(res: Response, buffer: Buffer, filename: string) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${safe(filename)}"`);
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
}

// ─── Virement groupe ─────────────────────────────────────────────────────

/**
 * Bulletins du mois a virer : payes par virement (net verse = net - retenue
 * d'avance) ; avec includeUnpaid, aussi les bulletins non encore payes (net
 * du bulletin), pour preparer l'ordre avant de pointer le paiement.
 */
export async function loadTransferLines(month: number, year: number, includeUnpaid: boolean, userStoreId?: string): Promise<TransferLine[]> {
  const r = await db.query(
    `SELECT p.id, p.net_salary, p.advance_deduction, p.acomptes_amount, p.paid, p.payment_method,
            e.id AS employee_id, e.first_name, e.last_name, e.rib, e.bank_name, e.store_id
       FROM payroll p JOIN employees e ON e.id = p.employee_id
      WHERE p.month = $1 AND p.year = $2
        AND ((p.paid AND p.payment_method = 'bank') OR ($3 AND NOT p.paid))
      ORDER BY e.last_name, e.first_name`,
    [month, year, includeUnpaid]
  );
  return r.rows
    .filter((x: Row) => x.store_id === null || checkStoreOwnership(x.store_id, userStoreId))
    .map((x: Row) => ({
      payrollId: x.id, employeeId: x.employee_id, name: `${x.last_name} ${x.first_name}`,
      rib: x.rib, bankName: x.bank_name,
      // Acomptes hebdo / quinzaine deja verses (mig 327) : seul le reste est vire.
      amount: Math.round((num(x.net_salary) - num(x.acomptes_amount) - (x.paid ? num(x.advance_deduction) : 0)) * 100) / 100,
    }))
    .filter(l => l.amount > 0);
}

export const payrollComplianceController = {
  /**
   * POST /payroll/declarations/ebds (multipart : file = preetabli AFFEBDS_…,
   * month, year). Renvoie le fichier DS_… (base64, latin-1) et les alertes.
   */
  async ebds(req: AuthRequest, res: Response) {
    const month = parseInt(String(req.body.month), 10);
    const year = parseInt(String(req.body.year), 10);
    const file = (req as AuthRequest & { file?: { buffer: Buffer } }).file;
    if (!month || !year) { res.status(400).json({ success: false, error: { message: 'month et year requis' } }); return; }
    if (!file) { res.status(400).json({ success: false, error: { message: 'Joignez le préétabli AFFEBDS_… téléchargé sur Damancom.' } }); return; }
    try {
      // latin-1 : les zones du preetabli sont recopiees octet pour octet.
      const pre = parsePreetabli(file.buffer.toString('latin1'));
      const expected = `${year}${String(month).padStart(2, '0')}`;
      if (pre.periode !== expected) throw new Error(`Le préétabli porte sur la période ${pre.periode.slice(4)}/${pre.periode.slice(0, 4)}, pas ${String(month).padStart(2, '0')}/${year}.`);
      const [statement, scale, settings] = await Promise.all([
        payrollDeclarationRepository.cnssStatement(month, year),
        taxScaleRepository.findForDate(monthBounds(month, year).start),
        payrollSettingsRepository.get(),
      ]);
      const result = buildEbds(pre, statement.rows.map(r => ({
        name: r.name, cnssNumber: r.cnssNumber, cin: r.cin, days: r.days, salaireReel: r.salaireReel,
      })), num(scale?.cnss_plafond) || 6000);
      const affSettings = String(settings.employer_cnss_number ?? '').replace(/\D/g, '');
      if (affSettings && affSettings !== pre.affilie) result.warnings.unshift(`N° d'affilié du préétabli (${pre.affilie}) différent de celui des paramètres de paie (${affSettings}).`);
      res.json({ success: true, data: {
        fileName: result.fileName, content: Buffer.from(result.content, 'latin1').toString('base64'),
        warnings: result.warnings, totals: result.totals, raisonSociale: pre.raisonSociale,
      } });
    } catch (err) {
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Préétabli illisible' } });
    }
  },

  /** GET /payroll/transfer?month&year&includeUnpaid&format=json|csv|pdf */
  async transferOrder(req: AuthRequest, res: Response) {
    const month = parseInt(String(req.query.month), 10);
    const year = parseInt(String(req.query.year), 10);
    if (!month || !year) { res.status(400).json({ success: false, error: { message: 'month et year requis' } }); return; }
    const includeUnpaid = req.query.includeUnpaid === 'true';
    const format = String(req.query.format ?? 'json');
    const { valid, issues } = splitTransferLines(await loadTransferLines(month, year, includeUnpaid, req.user!.storeId));
    const total = Math.round(valid.reduce((s, l) => s + l.amount, 0) * 100) / 100;
    const [settings, legal] = await Promise.all([payrollSettingsRepository.get(), loadCompanyLegal()]);
    const employerRib = normalizeRib(settings.employer_rib);
    const period = `${year}-${String(month).padStart(2, '0')}`;
    const periodLabel = `${MONTHS[month - 1]} ${year}`;

    if (format === 'json') {
      res.json({ success: true, data: {
        lines: valid, issues, total,
        employerRib: employerRib ? formatRib(employerRib) : null, employerBank: settings.employer_bank_name ?? null,
        employerRibValid: employerRib ? ribKeyValid(employerRib) : false,
      } });
      return;
    }
    if (!valid.length) { res.status(400).json({ success: false, error: { message: 'Aucun salaire à virer (RIB manquants ou aucun bulletin payé par virement).' } }); return; }
    if (format === 'csv') {
      const csv = buildTransferCsv(valid, `SALAIRE ${String(month).padStart(2, '0')}/${year}`);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="virement_salaires_${period}.csv"`);
      res.send(csv);
      return;
    }
    if (!employerRib) { res.status(400).json({ success: false, error: { message: 'Renseignez le RIB de l\'entreprise dans Paramètres de paie avant d\'éditer l\'ordre de virement.' } }); return; }
    const buffer = await generateTransferOrderPdf({
      company: { ...legal, cnss: settings.employer_cnss_number },
      employerRib: formatRib(employerRib), employerBank: settings.employer_bank_name ?? null,
      periodLabel, total, place: legal.city ?? null, issuedOn: fr(new Date()),
      lines: valid.map(l => ({ name: l.name, rib: formatRib(l.rib as string), bank: l.bankName, amount: l.amount })),
    });
    sendPdf(res, buffer, `ordre_virement_salaires_${period}.pdf`);
  },

  /** GET /employees/:employeeId/attestations/:kind (travail | salaire) */
  async attestation(req: AuthRequest, res: Response) {
    const emp = (await db.query('SELECT * FROM employees WHERE id = $1', [req.params.employeeId])).rows[0];
    if (!emp || (emp.store_id !== null && !checkStoreOwnership(emp.store_id, req.user!.storeId))) {
      res.status(404).json({ success: false, error: { message: 'Employe non trouve' } });
      return;
    }
    await sendAttestation(res, emp, req.params.kind, parseInt(String(req.query.months ?? '3'), 10));
  },
};

/**
 * Attestation de travail ou de salaire d'un salarie EN POSTE (un salarie sorti
 * recoit le certificat de travail du solde de tout compte, art. 72).
 */
export async function sendAttestation(res: Response, emp: Row, kind: string, monthsWanted = 3) {
  if (kind !== 'travail' && kind !== 'salaire') { res.status(400).json({ success: false, error: { message: 'Attestation inconnue (travail ou salaire)' } }); return; }
  const today = iso(new Date());
  if (emp.is_active === false || (emp.exit_date && iso(emp.exit_date) < today)) {
    res.status(400).json({ success: false, error: { message: 'Salarié sorti des effectifs : délivrez le certificat de travail du solde de tout compte.' } });
    return;
  }
  const [contract, role, settings, legal] = await Promise.all([
    db.query(`SELECT contract_type, job_title, monthly_salary FROM employee_contracts WHERE employee_id = $1 AND status = 'active' ORDER BY start_date DESC LIMIT 1`, [emp.id]),
    db.query(`SELECT label FROM ref_entries WHERE table_id = 'employee_roles' AND code = $1 LIMIT 1`, [emp.role]),
    payrollSettingsRepository.get(),
    loadCompanyLegal(),
  ]);
  const c = contract.rows[0];
  const base = {
    company: { ...legal, cnss: settings.employer_cnss_number },
    employee: { name: `${emp.first_name} ${emp.last_name}`, cin: emp.cin, cnss: emp.cnss_number },
    hireDate: fr(emp.hire_date),
    jobTitle: c?.job_title || role.rows[0]?.label || emp.role,
    contractLabel: CONTRACT_LABEL[c?.contract_type ?? emp.contract_type] ?? null,
    place: legal.city ?? null,
    issuedOn: fr(new Date()),
  };
  const slug = `${emp.last_name}_${emp.first_name}`;
  if (kind === 'travail') {
    sendPdf(res, await generateEmploymentAttestationPdf(base), `attestation_travail_${slug}.pdf`);
    return;
  }
  // Derniers bulletins mensuels arretes (payes ou mois clotures).
  const n = Math.min(Math.max(Number.isFinite(monthsWanted) ? monthsWanted : 3, 1), 12);
  const slips = await db.query(
    `SELECT p.month, p.year, p.gross_salary, p.net_salary
       FROM payroll p LEFT JOIN payroll_periods pp ON pp.year = p.year AND pp.month = p.month
      WHERE p.employee_id = $1 AND (p.paid OR pp.status = 'closed')
      ORDER BY p.year DESC, p.month DESC LIMIT $2`,
    [emp.id, n]
  );
  const buffer = await generateSalaryAttestationPdf({
    ...base,
    monthlySalary: num(c?.monthly_salary ?? emp.monthly_salary) || null,
    months: slips.rows.reverse().map((s: Row) => ({ label: `${MONTHS[s.month - 1]} ${s.year}`, gross: num(s.gross_salary), net: num(s.net_salary) })),
  });
  sendPdf(res, buffer, `attestation_salaire_${slug}.pdf`);
}
