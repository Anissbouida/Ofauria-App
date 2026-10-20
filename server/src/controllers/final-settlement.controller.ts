import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { db } from '../config/database.js';
import { checkStoreOwnership } from '../middleware/tenant.middleware.js';
import { finalSettlementRepository } from '../repositories/final-settlement.repository.js';
import { payrollSettingsRepository } from '../repositories/payroll-config.repository.js';
import { EXIT_REASON_LABELS, type ExitReason } from '../services/final-settlement.js';
import { generateSettlementReceiptPdf, generateWorkCertificatePdf } from '../services/hr-documents-pdf.service.js';
import { loadCompanyLegal } from '../utils/company-legal.js';

/** Depart du salarie : solde de tout compte, recu et certificat (lot 6). */

type Row = Record<string, any>;
const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const fr = (d: unknown) => {
  if (!d) return '';
  const s = d instanceof Date
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : String(d).slice(0, 10);
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
};

async function inScope(employeeId: string, userStoreId?: string) {
  const r = await db.query('SELECT id, store_id FROM employees WHERE id = $1', [employeeId]);
  const row = r.rows[0];
  if (!row) return null;
  if (row.store_id !== null && !checkStoreOwnership(row.store_id, userStoreId)) return null;
  return row;
}
const fail = (res: Response, err: unknown) => {
  const status = (err as { statusCode?: number }).statusCode;
  if (!status) {
    if (err instanceof Error && /clôturée|barème/.test(err.message)) { res.status(400).json({ success: false, error: { message: err.message } }); return; }
    throw err;
  }
  res.status(status).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });
};
const notFound = (res: Response) => res.status(404).json({ success: false, error: { message: 'Employe non trouve' } });

async function loadSettlement(id: string, storeId?: string) {
  const s = (await db.query(
    `SELECT s.*, e.first_name, e.last_name, e.cin, e.cnss_number, e.hire_date, e.role, e.store_id
       FROM final_settlements s JOIN employees e ON e.id = s.employee_id WHERE s.id = $1`, [id]
  )).rows[0];
  if (!s || (s.store_id !== null && !checkStoreOwnership(s.store_id, storeId))) return null;
  return s;
}

export const finalSettlementController = {
  async preview(req: AuthRequest, res: Response) {
    if (!(await inScope(req.params.employeeId, req.user!.storeId))) return notFound(res);
    try { res.json({ success: true, data: await finalSettlementRepository.preview(req.params.employeeId, req.body) }); }
    catch (err) { fail(res, err); }
  },
  async list(req: AuthRequest, res: Response) {
    if (!(await inScope(req.params.employeeId, req.user!.storeId))) return notFound(res);
    res.json({ success: true, data: await finalSettlementRepository.list(req.params.employeeId) });
  },
  async validate(req: AuthRequest, res: Response) {
    if (!(await inScope(req.params.employeeId, req.user!.storeId))) return notFound(res);
    try { res.status(201).json({ success: true, data: await finalSettlementRepository.validate(req.params.employeeId, req.body, req.user!.userId) }); }
    catch (err) { fail(res, err); }
  },
  async cancel(req: AuthRequest, res: Response) {
    if (!(await loadSettlement(req.params.id, req.user!.storeId))) { res.status(404).json({ success: false, error: { message: 'Introuvable' } }); return; }
    try { await finalSettlementRepository.cancel(req.params.id, req.user!.userId); res.json({ success: true, data: null }); }
    catch (err) { fail(res, err); }
  },

  /** Recu pour solde de tout compte (PDF). */
  async receipt(req: AuthRequest, res: Response) {
    const s = await loadSettlement(req.params.id, req.user!.storeId);
    if (!s) { res.status(404).json({ success: false, error: { message: 'Introuvable' } }); return; }
    const comp = s.computation ?? {};
    const stc: Row[] = comp.lines ?? [];
    const lines: Array<{ label: string; detail?: string; gain?: number; retenue?: number }> = [];
    let net: number;
    if (s.payroll_id) {
      const p = (await db.query('SELECT * FROM payroll WHERE id = $1', [s.payroll_id])).rows[0];
      const stcGains = stc.filter(l => l.kind === 'gain').reduce((a, l) => a + num(l.amount), 0);
      const stcRet = stc.filter(l => l.kind === 'retenue').reduce((a, l) => a + num(l.amount), 0);
      lines.push({ label: `Salaire et accessoires du dernier mois (${String(p.month).padStart(2, '0')}/${p.year})`, detail: 'brut du bulletin', gain: Math.round((num(p.gross_salary) - stcGains) * 100) / 100 });
      for (const l of stc) lines.push({ label: l.label, detail: l.detail, ...(l.kind === 'gain' ? { gain: num(l.amount) } : { retenue: num(l.amount) }) });
      const social = num(p.cnss_employee) + num(p.amo_employee) + num(p.cimr_employee) + num(p.ir_net);
      if (social > 0) lines.push({ label: 'Cotisations sociales et IR', detail: 'CNSS, AMO, CIMR, IR', retenue: Math.round(social * 100) / 100 });
      const other = num(p.other_deductions) - stcRet;
      if (other > 0.004) lines.push({ label: 'Autres retenues du bulletin', retenue: Math.round(other * 100) / 100 });
      if (num(p.advance_deduction) > 0) lines.push({ label: 'Remboursement d\'avances sur salaire', retenue: num(p.advance_deduction) });
      net = Math.round((num(p.net_salary) - num(p.advance_deduction)) * 100) / 100;
    } else {
      for (const l of stc) lines.push({ label: l.label, detail: l.detail, ...(l.kind === 'gain' ? { gain: num(l.amount) } : { retenue: num(l.amount) }) });
      net = Math.round((num(comp.totalGains) - num(comp.totalDeductions)) * 100) / 100;
    }
    const [settings, legal] = await Promise.all([payrollSettingsRepository.get(), loadCompanyLegal()]);
    const buffer = await generateSettlementReceiptPdf({
      company: { ...legal, cnss: settings.employer_cnss_number },
      employee: { name: `${s.first_name} ${s.last_name}`, cin: s.cin, cnss: s.cnss_number },
      exitDate: fr(s.exit_date), reasonLabel: EXIT_REASON_LABELS[s.reason as ExitReason] ?? s.reason,
      lines, netAmount: Math.max(0, net), place: legal.city ?? null, issuedOn: fr(new Date()),
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="recu_solde_${String(s.last_name).replace(/[^\w-]/g, '_')}.pdf"`);
    res.send(buffer);
  },

  /** Certificat de travail (PDF) : dates et emplois occupes. */
  async certificate(req: AuthRequest, res: Response) {
    const s = await loadSettlement(req.params.id, req.user!.storeId);
    if (!s) { res.status(404).json({ success: false, error: { message: 'Introuvable' } }); return; }
    const [contracts, role] = await Promise.all([
      db.query(`SELECT job_title, start_date, end_date FROM employee_contracts WHERE employee_id = $1 AND start_date <= $2 ORDER BY start_date`, [s.employee_id, s.exit_date]),
      db.query(`SELECT label FROM ref_entries WHERE table_id = 'employee_roles' AND code = $1`, [s.role]),
    ]);
    // Emplois : regroupe les contrats consecutifs au meme intitule.
    const positions: Array<{ title: string; from: string; to: string }> = [];
    for (const c of contracts.rows) {
      const title = c.job_title || role.rows[0]?.label || s.role;
      const last = positions[positions.length - 1];
      const to = fr(c.end_date && String(c.end_date) < String(s.exit_date) ? c.end_date : s.exit_date);
      if (last && last.title === title) last.to = to;
      else positions.push({ title, from: fr(c.start_date), to });
    }
    const [settings, legal] = await Promise.all([payrollSettingsRepository.get(), loadCompanyLegal()]);
    const buffer = await generateWorkCertificatePdf({
      company: { ...legal, cnss: settings.employer_cnss_number },
      employee: { name: `${s.first_name} ${s.last_name}`, cin: s.cin, cnss: s.cnss_number },
      hireDate: fr(s.hire_date), exitDate: fr(s.exit_date), positions, place: legal.city ?? null, issuedOn: fr(new Date()),
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="certificat_travail_${String(s.last_name).replace(/[^\w-]/g, '_')}.pdf"`);
    res.send(buffer);
  },
};
