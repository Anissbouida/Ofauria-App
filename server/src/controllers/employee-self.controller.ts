import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { db } from '../config/database.js';
import { checkStoreOwnership } from '../middleware/tenant.middleware.js';
import { leaveBalanceRepository, loadLeaveConfig, typeOf, leaveDayCount } from '../repositories/leave.repository.js';
import { salaryAdvanceRepository } from '../repositories/salary-advance.repository.js';
import { notificationRepository } from '../repositories/notification.repository.js';
import { loadPayrollForPdf, sendPayslipPdf } from './payroll-config.controller.js';
import { sendAttestation } from './payroll-compliance.controller.js';

/**
 * Espace employe (lot 8, mig 324) : un utilisateur lie a une fiche employe
 * (employees.user_id) ne voit et ne modifie QUE ses propres donnees.
 * Les bulletins visibles sont ceux payes ou d'un mois cloture (jamais un
 * brouillon en cours de calcul).
 */

type Row = Record<string, any>;
const iso = (d: unknown): string | null => {
  if (!d) return null;
  if (d instanceof Date) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return String(d).slice(0, 10);
};

async function me(req: AuthRequest): Promise<Row | null> {
  const r = await db.query('SELECT * FROM employees WHERE user_id = $1', [req.user!.userId]);
  return r.rows[0] ?? null;
}
const noProfile = (res: Response) =>
  res.status(404).json({ success: false, error: { message: 'Aucune fiche employé n\'est liée à votre compte : demandez au gérant de la lier.' } });

async function notifyManagers(emp: Row, title: string, message: string, type: string, referenceId: string, userId: string) {
  for (const role of ['manager', 'admin']) {
    await notificationRepository.create({
      targetRole: role, storeId: emp.store_id ?? undefined, type, title, message,
      referenceType: 'employee', referenceId, createdBy: userId,
    }).catch(() => undefined); // une notification ne bloque jamais la demande
  }
}

export const employeeSelfController = {
  /** Profil, contrat, solde de conges, avances en cours, demandes en attente. */
  async profile(req: AuthRequest, res: Response) {
    const emp = await me(req);
    if (!emp) return noProfile(res);
    const [contract, balance, outstanding, role] = await Promise.all([
      db.query(`SELECT contract_type, category, job_title, start_date::text AS start_date, end_date::text AS end_date,
                       trial_end_date::text AS trial_end_date, weekly_hours
                  FROM employee_contracts WHERE employee_id = $1 AND status = 'active'`, [emp.id]),
      emp.hire_date ? leaveBalanceRepository.forEmployee(emp.id) : Promise.resolve(null),
      salaryAdvanceRepository.outstandingByEmployee(emp.id),
      db.query(`SELECT label FROM ref_entries WHERE table_id = 'employee_roles' AND code = $1`, [emp.role]),
    ]);
    res.json({ success: true, data: {
      employee: {
        id: emp.id, firstName: emp.first_name, lastName: emp.last_name, role: role.rows[0]?.label ?? emp.role,
        hireDate: iso(emp.hire_date), payFrequency: emp.pay_frequency ?? 'monthly', isActive: emp.is_active,
        cnssNumber: emp.cnss_number,
      },
      contract: contract.rows[0] ?? null,
      leave: balance ? {
        available: balance.available, pending: balance.pending, acquiredThisYear: balance.acquiredThisYear,
        takenThisYear: balance.takenThisYear, carriedOver: balance.carriedOver, expiringThisYear: balance.expiringThisYear,
      } : null,
      advanceOutstanding: parseFloat(outstanding[0]?.outstanding ?? '0') || 0,
    } });
  },

  /** Bulletins payes ou d'un mois cloture ; paies hebdo / quinzaine payees. */
  async payslips(req: AuthRequest, res: Response) {
    const emp = await me(req);
    if (!emp) return noProfile(res);
    const [monthly, weekly, biweekly] = await Promise.all([
      db.query(
        `SELECT p.id, p.month, p.year, p.gross_salary, p.net_salary, p.advance_deduction, p.paid, p.paid_at
           FROM payroll p LEFT JOIN payroll_periods pp ON pp.year = p.year AND pp.month = p.month
          WHERE p.employee_id = $1 AND (p.paid OR pp.status = 'closed')
          ORDER BY p.year DESC, p.month DESC`, [emp.id]),
      db.query(`SELECT id, week_start::text AS start, week_end::text AS end_d, net_amount, advance_deduction, paid_at
                  FROM weekly_payroll WHERE employee_id = $1 AND paid ORDER BY week_start DESC LIMIT 60`, [emp.id]),
      db.query(`SELECT id, period_start::text AS start, period_end::text AS end_d, net_amount, advance_deduction, paid_at
                  FROM biweekly_payroll WHERE employee_id = $1 AND paid ORDER BY period_start DESC LIMIT 60`, [emp.id]),
    ]);
    res.json({ success: true, data: {
      monthly: monthly.rows,
      periodic: ([...weekly.rows.map((r: Row) => ({ ...r, kind: 'Semaine' })), ...biweekly.rows.map((r: Row) => ({ ...r, kind: 'Quinzaine' }))] as Row[])
        .sort((a, b) => String(b.start).localeCompare(String(a.start))),
    } });
  },

  async payslipPdf(req: AuthRequest, res: Response) {
    const emp = await me(req);
    if (!emp) return noProfile(res);
    const p = await loadPayrollForPdf(req.params.id);
    const period = p ? (await db.query('SELECT status FROM payroll_periods WHERE year = $1 AND month = $2', [p.year, p.month])).rows[0] : null;
    if (!p || p.employee_id !== emp.id || !(p.paid || period?.status === 'closed')) {
      res.status(404).json({ success: false, error: { message: 'Bulletin introuvable' } });
      return;
    }
    await sendPayslipPdf(res, p);
  },

  /** Attestation de travail ou de salaire (mig 325), sur sa propre fiche. */
  async attestation(req: AuthRequest, res: Response) {
    const emp = await me(req);
    if (!emp) return noProfile(res);
    await sendAttestation(res, emp, req.params.kind, parseInt(String(req.query.months ?? '3'), 10));
  },

  // ─── Conges ───
  /** Types de conge (le referentiel n'est pas lisible par tous les roles). */
  async leaveTypes(_req: AuthRequest, res: Response) {
    const cfg = await loadLeaveConfig();
    const r = await db.query(`SELECT code, label FROM ref_entries WHERE table_id = 'leave_types' AND is_active ORDER BY display_order, label`);
    res.json({ success: true, data: r.rows.map((t: Row) => ({ code: t.code, label: t.label, paid: typeOf(cfg, t.code).paid })) });
  },
  async leaves(req: AuthRequest, res: Response) {
    const emp = await me(req);
    if (!emp) return noProfile(res);
    const r = await db.query(
      `SELECT id, type, start_date::text AS start_date, end_date::text AS end_date, days, status, reason, created_at
         FROM leaves WHERE employee_id = $1 ORDER BY start_date DESC LIMIT 100`, [emp.id]);
    res.json({ success: true, data: r.rows });
  },

  async leavePreview(req: AuthRequest, res: Response) {
    const emp = await me(req);
    if (!emp) return noProfile(res);
    const { type, startDate, endDate } = req.query as Record<string, string>;
    if (!type || !/^\d{4}-\d{2}-\d{2}$/.test(startDate ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(endDate ?? '') || endDate < startDate) {
      res.status(400).json({ success: false, error: { message: 'type, startDate, endDate requis' } });
      return;
    }
    const cfg = await loadLeaveConfig();
    const t = typeOf(cfg, type);
    const b = t.deductsBalance ? await leaveBalanceRepository.forEmployee(emp.id, startDate, cfg) : null;
    res.json({ success: true, data: {
      days: leaveDayCount(cfg, type, startDate, endDate), unit: t.unit, paid: t.paid, deductsBalance: t.deductsBalance,
      available: b?.available ?? null, pending: b?.pending ?? null,
    } });
  },

  /** Demande de conge : toujours « en attente », validee par le gerant. */
  async requestLeave(req: AuthRequest, res: Response) {
    const emp = await me(req);
    if (!emp) return noProfile(res);
    if (!emp.is_active) { res.status(409).json({ success: false, error: { message: 'Fiche inactive.' } }); return; }
    const { type, startDate, endDate, reason } = req.body as Record<string, string>;
    const cfg = await loadLeaveConfig();
    const days = leaveDayCount(cfg, type, startDate, endDate);
    if (days <= 0) { res.status(400).json({ success: false, error: { message: 'Aucun jour décompté sur cette période (repos ou fériés).' } }); return; }
    if (typeOf(cfg, type).deductsBalance) {
      const b = await leaveBalanceRepository.forEmployee(emp.id, startDate, cfg);
      const free = b ? b.available - b.pending : 0;
      if (days > free + 0.001) {
        res.status(409).json({ success: false, error: { message: `Solde insuffisant : ${days} j demandés, ${Math.max(0, free).toFixed(2)} j disponibles.` } });
        return;
      }
    }
    const r = await db.query(
      `INSERT INTO leaves (employee_id, type, start_date, end_date, days, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, type, start_date::text AS start_date, end_date::text AS end_date, days, status`,
      [emp.id, type, startDate, endDate, days, reason || null, req.user!.userId]
    );
    await notifyManagers(emp, 'Demande de congé', `${emp.first_name} ${emp.last_name} demande ${days} j (${typeOf(cfg, type).label}) du ${startDate} au ${endDate}.`,
      'leave_request', emp.id, req.user!.userId);
    res.status(201).json({ success: true, data: r.rows[0] });
  },

  /** Annulation d'une demande de conge encore en attente. */
  async cancelLeave(req: AuthRequest, res: Response) {
    const emp = await me(req);
    if (!emp) return noProfile(res);
    const r = await db.query(`DELETE FROM leaves WHERE id = $1 AND employee_id = $2 AND status = 'pending' RETURNING id`, [req.params.id, emp.id]);
    if (!r.rowCount) { res.status(409).json({ success: false, error: { message: 'Seule une demande en attente peut être annulée.' } }); return; }
    res.json({ success: true, data: null });
  },

  // ─── Avances ───
  async advances(req: AuthRequest, res: Response) {
    const emp = await me(req);
    if (!emp) return noProfile(res);
    const [requests, advances] = await Promise.all([
      db.query(`SELECT id, amount, monthly_deduction, reason, status, decision_note, created_at, decided_at
                  FROM salary_advance_requests WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 50`, [emp.id]),
      db.query(`SELECT id, amount, remaining_amount, advance_date::text AS advance_date, status, monthly_deduction
                  FROM salary_advances WHERE employee_id = $1 ORDER BY advance_date DESC LIMIT 50`, [emp.id]),
    ]);
    res.json({ success: true, data: { requests: requests.rows, advances: advances.rows } });
  },

  /** Demande d'avance : plafonnee au salaire mensuel net des avances en cours. */
  async requestAdvance(req: AuthRequest, res: Response) {
    const emp = await me(req);
    if (!emp) return noProfile(res);
    if (!emp.is_active) { res.status(409).json({ success: false, error: { message: 'Fiche inactive.' } }); return; }
    const amount = parseFloat(String(req.body.amount));
    const monthlyDeduction = req.body.monthlyDeduction ? parseFloat(String(req.body.monthlyDeduction)) : null;
    const monthly = (emp.pay_frequency ?? 'monthly') === 'weekly'
      ? parseFloat(emp.weekly_salary ?? '0') * 52 / 12 : parseFloat(emp.monthly_salary ?? '0');
    const outstanding = parseFloat((await salaryAdvanceRepository.outstandingByEmployee(emp.id))[0]?.outstanding ?? '0') || 0;
    const cap = Math.max(0, Math.round((monthly - outstanding) * 100) / 100);
    if (amount > cap + 0.001) {
      res.status(409).json({ success: false, error: { message: `Montant trop élevé : ${cap.toFixed(2)} DH au plus (salaire mensuel moins avances en cours).` } });
      return;
    }
    try {
      const r = await db.query(
        `INSERT INTO salary_advance_requests (employee_id, amount, monthly_deduction, reason, requested_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [emp.id, amount, monthlyDeduction, req.body.reason || null, req.user!.userId]
      );
      await notifyManagers(emp, 'Demande d\'avance', `${emp.first_name} ${emp.last_name} demande une avance de ${amount.toFixed(2)} DH.`,
        'advance_request', emp.id, req.user!.userId);
      res.status(201).json({ success: true, data: r.rows[0] });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        res.status(409).json({ success: false, error: { message: 'Une demande d\'avance est déjà en attente.' } });
        return;
      }
      throw err;
    }
  },

  async cancelAdvanceRequest(req: AuthRequest, res: Response) {
    const emp = await me(req);
    if (!emp) return noProfile(res);
    const r = await db.query(
      `UPDATE salary_advance_requests SET status = 'cancelled' WHERE id = $1 AND employee_id = $2 AND status = 'pending' RETURNING id`,
      [req.params.id, emp.id]);
    if (!r.rowCount) { res.status(409).json({ success: false, error: { message: 'Seule une demande en attente peut être annulée.' } }); return; }
    res.json({ success: true, data: null });
  },
};

/** Cote gerant : demandes d'avance a traiter (droit Personnel). */
export const advanceRequestController = {
  async list(req: AuthRequest, res: Response) {
    const status = String(req.query.status ?? 'pending');
    const r = await db.query(
      `SELECT r.*, e.first_name, e.last_name, e.store_id, e.monthly_salary, e.weekly_salary, e.pay_frequency
         FROM salary_advance_requests r JOIN employees e ON e.id = r.employee_id
        WHERE ($1 = 'all' OR r.status = $1) ORDER BY r.created_at DESC LIMIT 200`, [status]);
    res.json({ success: true, data: r.rows.filter((x: Row) => x.store_id === null || checkStoreOwnership(x.store_id, req.user!.storeId)) });
  },

  /** Approuver = verser l'avance (circuit existant : paiement, 3431, retenue). */
  async approve(req: AuthRequest, res: Response) {
    const r = (await db.query(
      `SELECT r.*, e.store_id FROM salary_advance_requests r JOIN employees e ON e.id = r.employee_id WHERE r.id = $1`, [req.params.id]
    )).rows[0];
    if (!r || (r.store_id !== null && !checkStoreOwnership(r.store_id, req.user!.storeId))) { res.status(404).json({ success: false, error: { message: 'Demande introuvable' } }); return; }
    // Revendique la demande avant de verser (deux validations concurrentes ne versent qu'une fois).
    const claim = await db.query(
      `UPDATE salary_advance_requests SET status = 'approved', decided_by = $2, decided_at = NOW(), decision_note = $3
        WHERE id = $1 AND status = 'pending' RETURNING *`, [r.id, req.user!.userId, req.body?.note ?? null]);
    if (!claim.rowCount) { res.status(409).json({ success: false, error: { message: 'Demande déjà traitée.' } }); return; }
    try {
      const advance = await salaryAdvanceRepository.create({
        employeeId: r.employee_id, amount: parseFloat(r.amount), paymentMethod: req.body?.paymentMethod ?? 'cash',
        notes: `Demande en libre-service${r.reason ? ` : ${r.reason}` : ''}`, createdBy: req.user!.userId,
        storeId: req.user!.storeId, monthlyDeduction: req.body?.monthlyDeduction ?? (r.monthly_deduction ? parseFloat(r.monthly_deduction) : null),
      });
      await db.query('UPDATE salary_advance_requests SET advance_id = $2 WHERE id = $1', [r.id, (advance as Row).id]);
      res.json({ success: true, data: advance });
    } catch (err) {
      await db.query(`UPDATE salary_advance_requests SET status = 'pending', decided_by = NULL, decided_at = NULL, decision_note = NULL WHERE id = $1`, [r.id]);
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Versement impossible' } });
    }
  },

  async reject(req: AuthRequest, res: Response) {
    const r = (await db.query(
      `SELECT r.id, e.store_id FROM salary_advance_requests r JOIN employees e ON e.id = r.employee_id WHERE r.id = $1`, [req.params.id]
    )).rows[0];
    if (!r || (r.store_id !== null && !checkStoreOwnership(r.store_id, req.user!.storeId))) { res.status(404).json({ success: false, error: { message: 'Demande introuvable' } }); return; }
    const u = await db.query(
      `UPDATE salary_advance_requests SET status = 'rejected', decided_by = $2, decided_at = NOW(), decision_note = $3
        WHERE id = $1 AND status = 'pending' RETURNING *`, [r.id, req.user!.userId, req.body?.note ?? null]);
    if (!u.rowCount) { res.status(409).json({ success: false, error: { message: 'Demande déjà traitée.' } }); return; }
    res.json({ success: true, data: u.rows[0] });
  },
};
