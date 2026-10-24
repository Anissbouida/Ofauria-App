import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { db } from '../config/database.js';
import { employeeRepository, scheduleRepository, attendanceRepository, leaveRepository, payrollRepository } from '../repositories/employee.repository.js';
import { shiftRepository } from '../repositories/shift.repository.js';
import { weeklyPayrollRepository } from '../repositories/weekly-payroll.repository.js';
import { biweeklyPayrollRepository } from '../repositories/biweekly-payroll.repository.js';
import { overtimeYearSummary } from '../repositories/time-rules.repository.js';
import { contractRepository } from '../repositories/contract.repository.js';
import { leaveBalanceRepository, holidayRepository, leaveAdjustmentRepository, loadLeaveConfig, typeOf, leaveDayCount } from '../repositories/leave.repository.js';
import { salaryAdvanceRepository } from '../repositories/salary-advance.repository.js';
import { checkStoreOwnership } from '../middleware/tenant.middleware.js';
import { biweeklyBounds } from '../utils/payroll-periods.js';

/**
 * Verifie qu'un employe appartient au store du user connecte.
 * - Admin sans storeId (global) -> passe toujours
 * - Sinon : employees.store_id doit correspondre (ou etre NULL = employe global)
 * Retourne l'employe, ou null si introuvable / hors scope.
 */
async function loadEmployeeInScope(employeeId: string, userStoreId?: string) {
  const r = await db.query('SELECT id, store_id FROM employees WHERE id = $1', [employeeId]);
  const emp = r.rows[0];
  if (!emp) return null;
  // store_id NULL = employe global visible par tous les stores (cf. listing patterns)
  if (emp.store_id !== null && !checkStoreOwnership(emp.store_id, userStoreId)) return null;
  return emp;
}

async function loadPayrollInScope(payrollId: string, userStoreId?: string) {
  const r = await db.query(
    `SELECT p.id, p.employee_id, e.store_id
       FROM payroll p JOIN employees e ON e.id = p.employee_id
      WHERE p.id = $1`,
    [payrollId]
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.store_id !== null && !checkStoreOwnership(row.store_id, userStoreId)) return null;
  return row;
}

async function loadWeeklyPayrollInScope(id: string, userStoreId?: string) {
  const r = await db.query(
    `SELECT wp.id, wp.employee_id, e.store_id
       FROM weekly_payroll wp JOIN employees e ON e.id = wp.employee_id
      WHERE wp.id = $1`,
    [id]
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.store_id !== null && !checkStoreOwnership(row.store_id, userStoreId)) return null;
  return row;
}

async function loadBiweeklyPayrollInScope(id: string, userStoreId?: string) {
  const r = await db.query(
    `SELECT bp.id, bp.employee_id, e.store_id
       FROM biweekly_payroll bp JOIN employees e ON e.id = bp.employee_id
      WHERE bp.id = $1`,
    [id]
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.store_id !== null && !checkStoreOwnership(row.store_id, userStoreId)) return null;
  return row;
}

export const employeeController = {
  async list(req: AuthRequest, res: Response) {
    const employees = await employeeRepository.findAll(req.user!.storeId);
    res.json({ success: true, data: employees });
  },
  async getById(req: AuthRequest, res: Response) {
    // Scoping store : un manager du magasin A ne doit pas lire les employes
    // du magasin B (IDOR). Un employe sans store_id (global) reste visible.
    const scoped = await loadEmployeeInScope(req.params.id, req.user!.storeId);
    if (!scoped) { res.status(404).json({ success: false, error: { message: 'Employe non trouve' } }); return; }
    const employee = await employeeRepository.findById(req.params.id);
    if (!employee) { res.status(404).json({ success: false, error: { message: 'Employe non trouve' } }); return; }
    res.json({ success: true, data: employee });
  },
  async create(req: AuthRequest, res: Response) {
    const b = req.body;
    // Le contrat initial est cree avec l'employe (lot 4) : un CDD exige sa fin.
    if (b.contractType === 'cdd' && !b.contractEnd) {
      res.status(400).json({ success: false, error: { message: 'Un CDD exige une date de fin de contrat.' } });
      return;
    }
    let employee = await employeeRepository.create({
      ...b, storeId: req.user!.storeId, createdBy: req.user!.userId,
    });
    if (b.cinExpiresOn) employee = await employeeRepository.update(employee.id, { cinExpiresOn: b.cinExpiresOn }, req.user!.userId);
    await contractRepository.create(employee.id, {
      contractType: b.contractType || 'cdi', category: b.category, jobTitle: b.jobTitle ?? null,
      startDate: b.contractStart || b.hireDate, endDate: b.contractEnd || null, withTrial: b.withTrial,
      monthlySalary: b.monthlySalary ?? null, weeklySalary: b.weeklySalary ?? null,
    }, req.user!.userId);
    res.status(201).json({ success: true, data: await employeeRepository.findById(employee.id) });
  },
  async update(req: AuthRequest, res: Response) {
    const scoped = await loadEmployeeInScope(req.params.id, req.user!.storeId);
    if (!scoped) { res.status(404).json({ success: false, error: { message: 'Employe non trouve' } }); return; }
    const cur = await employeeRepository.findById(req.params.id);
    const nextType = req.body.contractType ?? cur?.contract_type;
    const nextEnd = req.body.contractEnd !== undefined ? req.body.contractEnd : cur?.contract_end;
    if (nextType === 'cdd' && !nextEnd) {
      res.status(400).json({ success: false, error: { message: 'Un CDD exige une date de fin de contrat.' } });
      return;
    }
    const employee = await employeeRepository.update(req.params.id, req.body, req.user!.userId);
    // Correction depuis la fiche : repercutee sur le contrat actif (meme source
    // de verite). Un vrai changement de conditions passe par un avenant.
    const b = req.body as Record<string, any>;
    await contractRepository.correctActive(req.params.id, {
      contractType: b.contractType ?? undefined,
      endDate: b.contractEnd !== undefined ? (b.contractEnd || null) : undefined,
      monthlySalary: b.monthlySalary !== undefined ? b.monthlySalary : undefined,
      weeklySalary: b.weeklySalary !== undefined ? b.weeklySalary : undefined,
    });
    res.json({ success: true, data: employee });
  },
  async remove(req: AuthRequest, res: Response) {
    const scoped = await loadEmployeeInScope(req.params.id, req.user!.storeId);
    if (!scoped) { res.status(404).json({ success: false, error: { message: 'Employe non trouve' } }); return; }
    const hard = String(req.query.hard || '').toLowerCase() === 'true';
    if (hard) {
      try {
        const result = await employeeRepository.hardDelete(req.params.id);
        res.json({ success: true, data: result });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erreur lors de la suppression';
        res.status(400).json({ success: false, error: { message: msg } });
      }
      return;
    }
    // Soft delete par defaut (UPDATE is_active = false) — preserve l'historique
    await employeeRepository.delete(req.params.id);
    res.json({ success: true, data: null });
  },
  async dependencies(req: AuthRequest, res: Response) {
    const scoped = await loadEmployeeInScope(req.params.id, req.user!.storeId);
    if (!scoped) { res.status(404).json({ success: false, error: { message: 'Employe non trouve' } }); return; }
    const counts = await employeeRepository.countDependencies(req.params.id);
    res.json({ success: true, data: counts });
  },
  async salaryHistory(req: AuthRequest, res: Response) {
    const scoped = await loadEmployeeInScope(req.params.id, req.user!.storeId);
    if (!scoped) { res.status(404).json({ success: false, error: { message: 'Employe non trouve' } }); return; }
    const rows = await employeeRepository.salaryHistory(req.params.id);
    res.json({ success: true, data: rows });
  },
};

function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const scheduleController = {
  async list(req: AuthRequest, res: Response) {
    const { startDate, endDate, employeeId } = req.query as Record<string, string>;
    if (!startDate || !endDate) {
      res.status(400).json({ success: false, error: { message: 'startDate et endDate sont requis' } });
      return;
    }
    const schedules = await scheduleRepository.findByDateRange(startDate, endDate, employeeId, req.user!.storeId);
    res.json({ success: true, data: schedules });
  },
  async create(req: AuthRequest, res: Response) {
    // Bloque la creation pour un employe d'un autre store.
    const scoped = await loadEmployeeInScope(req.body.employeeId, req.user!.storeId);
    if (!scoped) { res.status(404).json({ success: false, error: { message: 'Employe non trouve' } }); return; }
    const schedule = await scheduleRepository.create(req.body);
    res.status(201).json({ success: true, data: schedule });
  },
  async update(req: AuthRequest, res: Response) {
    // Verifie que le schedule cible un employe du store courant.
    const r = await db.query(
      `SELECT e.store_id FROM schedules s JOIN employees e ON e.id = s.employee_id WHERE s.id = $1`,
      [req.params.id]
    );
    if (!r.rows[0] || (r.rows[0].store_id !== null && !checkStoreOwnership(r.rows[0].store_id, req.user!.storeId))) {
      res.status(404).json({ success: false, error: { message: 'Planning non trouve' } });
      return;
    }
    const schedule = await scheduleRepository.update(req.params.id, req.body);
    res.json({ success: true, data: schedule });
  },
  async remove(req: AuthRequest, res: Response) {
    const r = await db.query(
      `SELECT e.store_id FROM schedules s JOIN employees e ON e.id = s.employee_id WHERE s.id = $1`,
      [req.params.id]
    );
    if (!r.rows[0] || (r.rows[0].store_id !== null && !checkStoreOwnership(r.rows[0].store_id, req.user!.storeId))) {
      res.status(404).json({ success: false, error: { message: 'Planning non trouve' } });
      return;
    }
    await scheduleRepository.delete(req.params.id);
    res.json({ success: true, data: null });
  },

  async week(req: AuthRequest, res: Response) {
    const weekStart = String(req.query.weekStart || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      res.status(400).json({ success: false, error: { message: 'weekStart YYYY-MM-DD requis' } });
      return;
    }
    const weekEnd = addDaysISO(weekStart, 6);
    const data = await scheduleRepository.getWeek(weekStart, weekEnd, req.user!.storeId);
    res.json({ success: true, data });
  },

  async bulkWeek(req: AuthRequest, res: Response) {
    const { weekStart, assignments } = req.body as {
      weekStart: string;
      assignments: Array<{ employeeId: string; date: string; shiftCode: string | null }>;
    };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart || '') || !Array.isArray(assignments)) {
      res.status(400).json({ success: false, error: { message: 'Payload invalide' } });
      return;
    }
    try {
      const result = await scheduleRepository.bulkUpsertWeek(assignments);
      res.json({ success: true, data: result });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'LEAVE_CONFLICT') {
        res.status(409).json({
          success: false,
          error: {
            message: (err as Error).message,
            conflicts: (err as Error & { conflicts?: string[] }).conflicts,
          },
        });
        return;
      }
      throw err;
    }
  },
};

export const shiftController = {
  async list(_req: AuthRequest, res: Response) {
    const shifts = await shiftRepository.list();
    res.json({ success: true, data: shifts });
  },
};

/**
 * Renvoie la semaine de reference Lundi -> Dimanche pour une date donnee
 * (YYYY-MM-DD). Si la date tombe un dimanche, on prend la semaine se
 * terminant ce dimanche.
 */
function weekBounds(iso: string): { start: string; end: string } {
  const d = new Date(`${iso}T00:00:00.000Z`);
  const wd = d.getUTCDay(); // 0=dim, 1=lun ... 6=sam
  const dayFromMon = wd === 0 ? 6 : wd - 1;
  const start = new Date(d.getTime() - dayFromMon * 86400_000);
  const end = new Date(start.getTime() + 6 * 86400_000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export const weeklyPayrollController = {
  async list(req: AuthRequest, res: Response) {
    const ref = String(req.query.weekStart || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ref)) {
      res.status(400).json({ success: false, error: { message: 'weekStart YYYY-MM-DD requis' } });
      return;
    }
    const { start, end } = weekBounds(ref);
    const rows = await weeklyPayrollRepository.list(start, end, req.user!.storeId);
    res.json({ success: true, data: { weekStart: start, weekEnd: end, rows } });
  },

  async generate(req: AuthRequest, res: Response) {
    const ref = String(req.body.weekStart || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ref)) {
      res.status(400).json({ success: false, error: { message: 'weekStart YYYY-MM-DD requis' } });
      return;
    }
    const { start, end } = weekBounds(ref);
    const generated = await weeklyPayrollRepository.generate(start, end, req.user!.storeId);
    res.json({ success: true, data: { weekStart: start, weekEnd: end, generated } });
  },

  async markPaid(req: AuthRequest, res: Response) {
    const scoped = await loadWeeklyPayrollInScope(req.params.id, req.user!.storeId);
    if (!scoped) { res.status(404).json({ success: false, error: { message: 'Ligne introuvable' } }); return; }
    const { paymentMethod, advanceDeduction } = req.body;
    try {
      const row = await weeklyPayrollRepository.markPaid(
        req.params.id, paymentMethod || 'cash', req.user!.userId, req.user!.storeId,
        parseFloat(String(advanceDeduction ?? 0)) || 0
      );
      if (!row) { res.status(404).json({ success: false, error: { message: 'Ligne introuvable' } }); return; }
      res.json({ success: true, data: row });
    } catch (err) {
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });
    }
  },

  async unmarkPaid(req: AuthRequest, res: Response) {
    const scoped = await loadWeeklyPayrollInScope(req.params.id, req.user!.storeId);
    if (!scoped) { res.status(404).json({ success: false, error: { message: 'Ligne introuvable' } }); return; }
    try {
      const row = await weeklyPayrollRepository.unmarkPaid(req.params.id, req.user!.userId);
      if (!row) { res.status(404).json({ success: false, error: { message: 'Ligne introuvable' } }); return; }
      res.json({ success: true, data: row });
    } catch (err) {
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur lors de l\'annulation' } });
    }
  },

  async update(req: AuthRequest, res: Response) {
    const scoped = await loadWeeklyPayrollInScope(req.params.id, req.user!.storeId);
    if (!scoped) { res.status(404).json({ success: false, error: { message: 'Ligne introuvable' } }); return; }
    try {
      const row = await weeklyPayrollRepository.update(req.params.id, req.body);
      if (!row) { res.status(404).json({ success: false, error: { message: 'Ligne introuvable' } }); return; }
      res.json({ success: true, data: row });
    } catch (err) {
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });
    }
  },

  async remove(req: AuthRequest, res: Response) {
    const scoped = await loadWeeklyPayrollInScope(req.params.id, req.user!.storeId);
    if (!scoped) { res.status(404).json({ success: false, error: { message: 'Ligne introuvable' } }); return; }
    try {
      await weeklyPayrollRepository.delete(req.params.id);
      res.json({ success: true, data: null });
    } catch (err) {
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });
    }
  },
};

export const biweeklyPayrollController = {
  async list(req: AuthRequest, res: Response) {
    const ref = String(req.query.periodStart || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ref)) {
      res.status(400).json({ success: false, error: { message: 'periodStart YYYY-MM-DD requis' } });
      return;
    }
    const { start, end } = biweeklyBounds(ref);
    const rows = await biweeklyPayrollRepository.list(start, end, req.user!.storeId);
    res.json({ success: true, data: { periodStart: start, periodEnd: end, rows } });
  },

  async generate(req: AuthRequest, res: Response) {
    const { start, end } = biweeklyBounds(String(req.body.periodStart));
    const generated = await biweeklyPayrollRepository.generate(start, end, req.user!.storeId);
    res.json({ success: true, data: { periodStart: start, periodEnd: end, generated } });
  },

  async markPaid(req: AuthRequest, res: Response) {
    const scoped = await loadBiweeklyPayrollInScope(req.params.id, req.user!.storeId);
    if (!scoped) { res.status(404).json({ success: false, error: { message: 'Ligne introuvable' } }); return; }
    const { paymentMethod, advanceDeduction } = req.body;
    try {
      const row = await biweeklyPayrollRepository.markPaid(
        req.params.id, paymentMethod || 'cash', req.user!.userId, req.user!.storeId,
        parseFloat(String(advanceDeduction ?? 0)) || 0
      );
      if (!row) { res.status(404).json({ success: false, error: { message: 'Ligne introuvable' } }); return; }
      res.json({ success: true, data: row });
    } catch (err) {
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });
    }
  },

  async unmarkPaid(req: AuthRequest, res: Response) {
    const scoped = await loadBiweeklyPayrollInScope(req.params.id, req.user!.storeId);
    if (!scoped) { res.status(404).json({ success: false, error: { message: 'Ligne introuvable' } }); return; }
    try {
      const row = await biweeklyPayrollRepository.unmarkPaid(req.params.id, req.user!.userId);
      if (!row) { res.status(404).json({ success: false, error: { message: 'Ligne introuvable' } }); return; }
      res.json({ success: true, data: row });
    } catch (err) {
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur lors de l\'annulation' } });
    }
  },

  async update(req: AuthRequest, res: Response) {
    const scoped = await loadBiweeklyPayrollInScope(req.params.id, req.user!.storeId);
    if (!scoped) { res.status(404).json({ success: false, error: { message: 'Ligne introuvable' } }); return; }
    const row = await biweeklyPayrollRepository.update(req.params.id, req.body);
    if (!row) { res.status(404).json({ success: false, error: { message: 'Ligne introuvable' } }); return; }
    res.json({ success: true, data: row });
  },

  async remove(req: AuthRequest, res: Response) {
    const scoped = await loadBiweeklyPayrollInScope(req.params.id, req.user!.storeId);
    if (!scoped) { res.status(404).json({ success: false, error: { message: 'Ligne introuvable' } }); return; }
    try {
      await biweeklyPayrollRepository.delete(req.params.id);
      res.json({ success: true, data: null });
    } catch (err) {
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });
    }
  },
};

export const attendanceController = {
  /** Cumul annuel des heures sup par employe face au contingent legal. */
  async overtimeSummary(req: AuthRequest, res: Response) {
    const year = parseInt(String(req.query.year || new Date().getFullYear()), 10);
    res.json({ success: true, data: await overtimeYearSummary(year, req.user!.storeId) });
  },
  async list(req: AuthRequest, res: Response) {
    const { startDate, endDate, employeeId } = req.query as Record<string, string>;
    if (!startDate || !endDate) {
      res.status(400).json({ success: false, error: { message: 'startDate et endDate sont requis' } });
      return;
    }
    const records = await attendanceRepository.findByDateRange(startDate, endDate, employeeId, req.user!.storeId);
    res.json({ success: true, data: records });
  },
  async upsert(req: AuthRequest, res: Response) {
    const scoped = await loadEmployeeInScope(req.body.employeeId, req.user!.storeId);
    if (!scoped) { res.status(404).json({ success: false, error: { message: 'Employe non trouve' } }); return; }
    const record = await attendanceRepository.upsert(req.body);
    res.json({ success: true, data: record });
  },
  async bulkUpsert(req: AuthRequest, res: Response) {
    // Verifie tous les employeeIds distincts avant d'attaquer le batch.
    const empIds = Array.from(new Set(
      (req.body.records as Array<{ employeeId: string }>).map(r => r.employeeId)
    ));
    for (const empId of empIds) {
      const scoped = await loadEmployeeInScope(empId, req.user!.storeId);
      if (!scoped) {
        res.status(404).json({ success: false, error: { message: `Employe ${empId} hors scope` } });
        return;
      }
    }
    const records = await attendanceRepository.bulkUpsert(req.body.records);
    res.json({ success: true, data: records });
  },
  async monthlySummary(req: AuthRequest, res: Response) {
    const { employeeId, month, year } = req.query as Record<string, string>;
    if (employeeId) {
      const scoped = await loadEmployeeInScope(employeeId, req.user!.storeId);
      if (!scoped) { res.status(404).json({ success: false, error: { message: 'Employe non trouve' } }); return; }
    }
    const summary = await attendanceRepository.monthlySummary(employeeId, parseInt(month), parseInt(year));
    res.json({ success: true, data: summary });
  },
  async remove(req: AuthRequest, res: Response) {
    const r = await db.query(
      `SELECT e.store_id FROM attendance a JOIN employees e ON e.id = a.employee_id WHERE a.id = $1`,
      [req.params.id]
    );
    if (!r.rows[0] || (r.rows[0].store_id !== null && !checkStoreOwnership(r.rows[0].store_id, req.user!.storeId))) {
      res.status(404).json({ success: false, error: { message: 'Pointage non trouve' } });
      return;
    }
    await attendanceRepository.delete(req.params.id);
    res.json({ success: true, data: null });
  },
};

export const leaveController = {
  async list(req: AuthRequest, res: Response) {
    const { employeeId, status, year, activeOn } = req.query as Record<string, string>;
    const leaves = await leaveRepository.findAll({
      employeeId, status, year: year ? parseInt(year) : undefined,
      activeOn: activeOn && /^\d{4}-\d{2}-\d{2}$/.test(activeOn) ? activeOn : undefined,
      storeId: req.user!.storeId,
    });
    res.json({ success: true, data: leaves });
  },

  /** Apercu d'une demande : jours decomptes (ouvrables ou calendaires) et solde. */
  async preview(req: AuthRequest, res: Response) {
    const { employeeId, type, startDate, endDate } = req.query as Record<string, string>;
    if (!employeeId || !type || !/^\d{4}-\d{2}-\d{2}$/.test(startDate ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(endDate ?? '') || endDate < startDate) {
      res.status(400).json({ success: false, error: { message: 'employeeId, type, startDate, endDate requis' } });
      return;
    }
    if (!(await loadEmployeeInScope(employeeId, req.user!.storeId))) { res.status(404).json({ success: false, error: { message: 'Employe non trouve' } }); return; }
    const cfg = await loadLeaveConfig();
    const t = typeOf(cfg, type);
    const days = leaveDayCount(cfg, type, startDate, endDate);
    const balance = t.deductsBalance ? await leaveBalanceRepository.forEmployee(employeeId, startDate, cfg) : null;
    res.json({ success: true, data: {
      days, unit: t.unit, paid: t.paid, deductsBalance: t.deductsBalance,
      available: balance ? balance.available : null, pending: balance ? balance.pending : null,
    } });
  },

  async create(req: AuthRequest, res: Response) {
    const scoped = await loadEmployeeInScope(req.body.employeeId, req.user!.storeId);
    if (!scoped) { res.status(404).json({ success: false, error: { message: 'Employe non trouve' } }); return; }
    // `days` recalcule cote SERVEUR : jours ouvrables (hors repos hebdomadaire
    // et feries, art. 232) ou calendaires selon le type de conge. Ne jamais
    // faire confiance au client (gonflement du solde).
    const { employeeId, type, startDate, endDate, allowNegative } = req.body as { employeeId: string; type: string; startDate: string; endDate: string; allowNegative?: boolean };
    const cfg = await loadLeaveConfig();
    const days = leaveDayCount(cfg, type, startDate, endDate);
    if (days <= 0) {
      res.status(400).json({ success: false, error: { message: 'Aucun jour décompté sur cette période (repos hebdomadaire ou jours fériés).' } });
      return;
    }
    if (typeOf(cfg, type).deductsBalance && !(allowNegative && req.user!.role === 'admin')) {
      const b = await leaveBalanceRepository.forEmployee(employeeId, startDate, cfg);
      const free = b ? b.available - b.pending : 0;
      if (days > free + 0.001) {
        res.status(409).json({ success: false, error: { message: `Solde insuffisant : ${days} j demandés, ${Math.max(0, free).toFixed(2)} j disponibles (demandes en attente déduites). Un administrateur peut autoriser un congé anticipé.` } });
        return;
      }
    }
    const leave = await leaveRepository.create({ ...req.body, days });
    res.status(201).json({ success: true, data: leave });
  },

  async approve(req: AuthRequest, res: Response) {
    const r = await db.query(
      `SELECT l.*, e.store_id FROM leaves l JOIN employees e ON e.id = l.employee_id WHERE l.id = $1`,
      [req.params.id]
    );
    const l = r.rows[0];
    if (!l || (l.store_id !== null && !checkStoreOwnership(l.store_id, req.user!.storeId))) {
      res.status(404).json({ success: false, error: { message: 'Conge non trouve' } });
      return;
    }
    if (l.status === 'approved') { res.json({ success: true, data: l }); return; }
    // Re-controle du solde a la validation (d'autres conges ont pu etre approuves entre-temps).
    const cfg = await loadLeaveConfig();
    if (typeOf(cfg, l.type).deductsBalance && !(req.body?.allowNegative && req.user!.role === 'admin')) {
      const startIso = l.start_date instanceof Date
        ? `${l.start_date.getFullYear()}-${String(l.start_date.getMonth() + 1).padStart(2, '0')}-${String(l.start_date.getDate()).padStart(2, '0')}`
        : String(l.start_date).slice(0, 10);
      const b = await leaveBalanceRepository.forEmployee(l.employee_id, startIso, cfg);
      // La demande elle-meme est comptee dans « pending » : on la retire.
      const free = b ? b.available - (b.pending - parseFloat(l.days)) : 0;
      if (parseFloat(l.days) > free + 0.001) {
        res.status(409).json({ success: false, error: { message: `Solde insuffisant pour approuver : ${parseFloat(l.days)} j, ${Math.max(0, free).toFixed(2)} j disponibles.` } });
        return;
      }
    }
    try {
      const leave = await leaveRepository.updateStatus(req.params.id, 'approved', req.user!.userId);
      res.json({ success: true, data: leave });
    } catch (err) {
      // Contrainte d'exclusion leaves_no_overlap : chevauchement avec un conge approuve.
      if ((err as { code?: string }).code === '23P01') {
        res.status(409).json({ success: false, error: { message: 'Chevauche un congé déjà approuvé pour cet employé.' } });
        return;
      }
      throw err;
    }
  },
  async reject(req: AuthRequest, res: Response) {
    const r = await db.query(
      `SELECT e.store_id FROM leaves l JOIN employees e ON e.id = l.employee_id WHERE l.id = $1`,
      [req.params.id]
    );
    if (!r.rows[0] || (r.rows[0].store_id !== null && !checkStoreOwnership(r.rows[0].store_id, req.user!.storeId))) {
      res.status(404).json({ success: false, error: { message: 'Conge non trouve' } });
      return;
    }
    const leave = await leaveRepository.updateStatus(req.params.id, 'rejected', req.user!.userId);
    res.json({ success: true, data: leave });
  },

  /** Solde detaille d'un employe (par annee) a une date. */
  async balance(req: AuthRequest, res: Response) {
    const { employeeId, asOf } = req.query as Record<string, string>;
    if (!employeeId) { res.status(400).json({ success: false, error: { message: 'employeeId requis' } }); return; }
    if (!(await loadEmployeeInScope(employeeId, req.user!.storeId))) { res.status(404).json({ success: false, error: { message: 'Employe non trouve' } }); return; }
    const b = await leaveBalanceRepository.forEmployee(employeeId, /^\d{4}-\d{2}-\d{2}$/.test(asOf ?? '') ? asOf : undefined);
    res.json({ success: true, data: b });
  },

  /** Soldes de tous les employes actifs. */
  async balances(req: AuthRequest, res: Response) {
    const { asOf } = req.query as Record<string, string>;
    res.json({ success: true, data: await leaveBalanceRepository.all(req.user!.storeId, /^\d{4}-\d{2}-\d{2}$/.test(asOf ?? '') ? asOf : undefined) });
  },

  async remove(req: AuthRequest, res: Response) {
    const r = await db.query(
      `SELECT e.store_id FROM leaves l JOIN employees e ON e.id = l.employee_id WHERE l.id = $1`,
      [req.params.id]
    );
    if (!r.rows[0] || (r.rows[0].store_id !== null && !checkStoreOwnership(r.rows[0].store_id, req.user!.storeId))) {
      res.status(404).json({ success: false, error: { message: 'Conge non trouve' } });
      return;
    }
    await leaveRepository.delete(req.params.id);
    res.json({ success: true, data: null });
  },

  // ─── Jours feries ───
  async holidays(req: AuthRequest, res: Response) {
    const year = req.query.year ? parseInt(String(req.query.year), 10) : undefined;
    res.json({ success: true, data: await holidayRepository.list(year) });
  },
  async upsertHoliday(req: AuthRequest, res: Response) {
    const { date, label, isConfirmed } = req.body as { date: string; label: string; isConfirmed?: boolean };
    res.json({ success: true, data: await holidayRepository.upsert(date, label, isConfirmed ?? true, req.user?.userId) });
  },
  async removeHoliday(req: AuthRequest, res: Response) {
    await holidayRepository.remove(req.params.date, req.user?.userId);
    res.json({ success: true, data: null });
  },

  // ─── Ajustements de solde ───
  async adjustments(req: AuthRequest, res: Response) {
    if (!(await loadEmployeeInScope(req.params.employeeId, req.user!.storeId))) { res.status(404).json({ success: false, error: { message: 'Employe non trouve' } }); return; }
    res.json({ success: true, data: await leaveAdjustmentRepository.list(req.params.employeeId) });
  },
  async createAdjustment(req: AuthRequest, res: Response) {
    if (!(await loadEmployeeInScope(req.params.employeeId, req.user!.storeId))) { res.status(404).json({ success: false, error: { message: 'Employe non trouve' } }); return; }
    const row = await leaveAdjustmentRepository.create({ ...req.body, employeeId: req.params.employeeId }, req.user!.userId);
    res.status(201).json({ success: true, data: row });
  },
  async removeAdjustment(req: AuthRequest, res: Response) {
    const adj = await leaveAdjustmentRepository.findById(req.params.id);
    if (!adj || !(await loadEmployeeInScope(adj.employee_id, req.user!.storeId))) { res.status(404).json({ success: false, error: { message: 'Ajustement introuvable' } }); return; }
    await leaveAdjustmentRepository.remove(req.params.id);
    res.json({ success: true, data: null });
  },
};

export const payrollController = {
  async list(req: AuthRequest, res: Response) {
    const { month, year, employeeId } = req.query as Record<string, string>;
    const payrolls = await payrollRepository.findAll({
      month: month ? parseInt(month) : undefined,
      year: year ? parseInt(year) : undefined,
      employeeId,
      storeId: req.user!.storeId,
    });
    res.json({ success: true, data: payrolls });
  },
  async generate(req: AuthRequest, res: Response) {
    const { month, year } = req.body;
    try {
      const { payrolls, removed } = await payrollRepository.generate(month, year, req.user!.storeId);
      // `removed` : bulletins non payes retires (employe passe en hebdo/quinzaine),
      // affiches par le client au lieu d'une suppression silencieuse.
      res.json({ success: true, data: payrolls, removed });
    } catch (err) {
      // Mois cloture, bareme absent : erreur metier lisible, pas un 500.
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });
    }
  },
  /** Annule un paiement mensuel : supprime la sortie de caisse + reverse les retenues. */
  async unmarkPaid(req: AuthRequest, res: Response) {
    const scoped = await loadPayrollInScope(req.params.id, req.user!.storeId);
    if (!scoped) { res.status(404).json({ success: false, error: { message: 'Bulletin introuvable' } }); return; }
    try {
      const row = await payrollRepository.unmarkPaid(req.params.id, req.user!.userId);
      if (!row) { res.status(404).json({ success: false, error: { message: 'Bulletin introuvable' } }); return; }
      res.json({ success: true, data: row });
    } catch (err) {
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur lors de l\'annulation' } });
    }
  },
  async markPaid(req: AuthRequest, res: Response) {
    const scoped = await loadPayrollInScope(req.params.id, req.user!.storeId);
    if (!scoped) { res.status(404).json({ success: false, error: { message: 'Bulletin introuvable' } }); return; }
    const { paymentMethod, advanceDeduction } = req.body;
    try {
      const payroll = await payrollRepository.markPaid(
        req.params.id, paymentMethod || 'cash', req.user!.userId, req.user!.storeId,
        parseFloat(String(advanceDeduction ?? 0)) || 0
      );
      res.json({ success: true, data: payroll });
    } catch (err) {
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });
    }
  },
  async update(req: AuthRequest, res: Response) {
    const scoped = await loadPayrollInScope(req.params.id, req.user!.storeId);
    if (!scoped) { res.status(404).json({ success: false, error: { message: 'Bulletin introuvable' } }); return; }
    try {
      const payroll = await payrollRepository.update(req.params.id, req.body);
      if (!payroll) { res.status(404).json({ success: false, error: { message: 'Bulletin introuvable' } }); return; }
      res.json({ success: true, data: payroll });
    } catch (err) {
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });
    }
  },
};

export const salaryAdvanceController = {
  async list(req: AuthRequest, res: Response) {
    const { employeeId, status } = req.query as Record<string, string>;
    const advances = await salaryAdvanceRepository.list({
      employeeId, status, storeId: req.user!.storeId,
    });
    res.json({ success: true, data: advances });
  },
  /** Solde d'avances en cours par employe (tous, ou un seul via ?employeeId=). */
  async outstanding(req: AuthRequest, res: Response) {
    const { employeeId } = req.query as Record<string, string>;
    const rows = await salaryAdvanceRepository.outstandingByEmployee(employeeId);
    res.json({ success: true, data: rows });
  },
  async create(req: AuthRequest, res: Response) {
    const { employeeId, amount, paymentMethod, advanceDate, notes, monthlyDeduction } = req.body;
    const parsed = parseFloat(String(amount));
    if (!employeeId || !parsed || parsed <= 0) {
      res.status(400).json({ success: false, error: { message: 'employeeId et montant positif requis' } });
      return;
    }
    // F-048 : plafond serveur — une avance ne peut pas depasser le salaire mensuel
    // (equivalent pour les payes a la semaine) diminue des avances deja en cours.
    // La demande self-service appliquait deja cette regle ; le chemin gerant ne la
    // controlait pas, laissant passer un montant aberrant (ex. 50 000 DH).
    const emp = await employeeRepository.findById(employeeId);
    if (!emp) {
      res.status(404).json({ success: false, error: { message: 'Employé non trouvé' } });
      return;
    }
    const monthlyEq = (emp.pay_frequency ?? 'monthly') === 'weekly'
      ? parseFloat(emp.weekly_salary ?? '0') * 52 / 12
      : parseFloat(emp.monthly_salary ?? '0');
    const outstanding = parseFloat((await salaryAdvanceRepository.outstandingByEmployee(employeeId))[0]?.outstanding ?? '0') || 0;
    const cap = Math.max(0, Math.round((monthlyEq - outstanding) * 100) / 100);
    if (parsed > cap + 0.001) {
      res.status(409).json({ success: false, error: { message: `Montant trop élevé : ${cap.toFixed(2)} DH au plus (salaire mensuel moins avances en cours).` } });
      return;
    }
    // Plan d'etalement optionnel : retenue par paie, entre 0 exclu et le
    // montant de l'avance (au-dela, autant ne pas definir de plan).
    let monthly: number | null = null;
    if (monthlyDeduction !== undefined && monthlyDeduction !== null && monthlyDeduction !== '') {
      monthly = Math.round((parseFloat(String(monthlyDeduction)) || 0) * 100) / 100;
      if (monthly <= 0 || monthly > parsed) {
        res.status(400).json({ success: false, error: { message: 'La retenue mensuelle doit être comprise entre 0 et le montant de l\'avance' } });
        return;
      }
    }
    try {
      const advance = await salaryAdvanceRepository.create({
        employeeId, amount: Math.round(parsed * 100) / 100,
        paymentMethod: paymentMethod || 'cash',
        advanceDate, notes, monthlyDeduction: monthly,
        createdBy: req.user!.userId, storeId: req.user!.storeId,
      });
      res.status(201).json({ success: true, data: advance });
    } catch (err) {
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });
    }
  },
  /**
   * Modification d'une avance (admin) : plan de retenue et notes toujours
   * modifiables ; montant/mode/date uniquement tant qu'aucune retenue n'a
   * ete imputee (le decaissement lie est alors mis a jour).
   */
  async update(req: AuthRequest, res: Response) {
    const { amount, paymentMethod, advanceDate, notes, monthlyDeduction } = req.body;
    const data: {
      amount?: number; paymentMethod?: string; advanceDate?: string;
      monthlyDeduction?: number | null; notes?: string;
    } = {};
    if (amount !== undefined) {
      const parsed = parseFloat(String(amount));
      if (!parsed || parsed <= 0) {
        res.status(400).json({ success: false, error: { message: 'Montant invalide' } });
        return;
      }
      data.amount = Math.round(parsed * 100) / 100;
    }
    if (paymentMethod !== undefined) data.paymentMethod = String(paymentMethod);
    if (advanceDate !== undefined && advanceDate) data.advanceDate = String(advanceDate);
    if (notes !== undefined) data.notes = String(notes ?? '');
    if (monthlyDeduction !== undefined) {
      // null / '' / 0 = suppression du plan (tout a la prochaine paie)
      const parsed = parseFloat(String(monthlyDeduction ?? ''));
      data.monthlyDeduction = parsed > 0 ? Math.round(parsed * 100) / 100 : null;
    }
    try {
      const advance = await salaryAdvanceRepository.update(req.params.id, data);
      res.json({ success: true, data: advance });
    } catch (err) {
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });
    }
  },
  async remove(req: AuthRequest, res: Response) {
    try {
      await salaryAdvanceRepository.remove(req.params.id, req.user!.userId);
      res.json({ success: true, data: null });
    } catch (err) {
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });
    }
  },
};
