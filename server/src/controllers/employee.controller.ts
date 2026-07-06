import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { employeeRepository, scheduleRepository, attendanceRepository, leaveRepository, payrollRepository } from '../repositories/employee.repository.js';
import { shiftRepository } from '../repositories/shift.repository.js';
import { weeklyPayrollRepository } from '../repositories/weekly-payroll.repository.js';
import { salaryAdvanceRepository } from '../repositories/salary-advance.repository.js';

export const employeeController = {
  async list(req: AuthRequest, res: Response) {
    const employees = await employeeRepository.findAll(req.user!.storeId);
    res.json({ success: true, data: employees });
  },
  async getById(req: AuthRequest, res: Response) {
    const employee = await employeeRepository.findById(req.params.id);
    if (!employee) { res.status(404).json({ success: false, error: { message: 'Employe non trouve' } }); return; }
    res.json({ success: true, data: employee });
  },
  async create(req: AuthRequest, res: Response) {
    const employee = await employeeRepository.create({ ...req.body, storeId: req.user!.storeId });
    res.status(201).json({ success: true, data: employee });
  },
  async update(req: AuthRequest, res: Response) {
    const employee = await employeeRepository.update(req.params.id, req.body);
    res.json({ success: true, data: employee });
  },
  async remove(req: AuthRequest, res: Response) {
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
    const counts = await employeeRepository.countDependencies(req.params.id);
    res.json({ success: true, data: counts });
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
    const schedules = await scheduleRepository.findByDateRange(startDate, endDate, employeeId);
    res.json({ success: true, data: schedules });
  },
  async create(req: AuthRequest, res: Response) {
    const schedule = await scheduleRepository.create(req.body);
    res.status(201).json({ success: true, data: schedule });
  },
  async update(req: AuthRequest, res: Response) {
    const schedule = await scheduleRepository.update(req.params.id, req.body);
    res.json({ success: true, data: schedule });
  },
  async remove(req: AuthRequest, res: Response) {
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
    const row = await weeklyPayrollRepository.unmarkPaid(req.params.id);
    if (!row) { res.status(404).json({ success: false, error: { message: 'Ligne introuvable' } }); return; }
    res.json({ success: true, data: row });
  },

  async update(req: AuthRequest, res: Response) {
    const row = await weeklyPayrollRepository.update(req.params.id, req.body);
    res.json({ success: true, data: row });
  },

  async remove(req: AuthRequest, res: Response) {
    await weeklyPayrollRepository.delete(req.params.id);
    res.json({ success: true, data: null });
  },
};

export const attendanceController = {
  async list(req: AuthRequest, res: Response) {
    const { startDate, endDate, employeeId } = req.query as Record<string, string>;
    if (!startDate || !endDate) {
      res.status(400).json({ success: false, error: { message: 'startDate et endDate sont requis' } });
      return;
    }
    const records = await attendanceRepository.findByDateRange(startDate, endDate, employeeId);
    res.json({ success: true, data: records });
  },
  async upsert(req: AuthRequest, res: Response) {
    const record = await attendanceRepository.upsert(req.body);
    res.json({ success: true, data: record });
  },
  async bulkUpsert(req: AuthRequest, res: Response) {
    const records = await attendanceRepository.bulkUpsert(req.body.records);
    res.json({ success: true, data: records });
  },
  async monthlySummary(req: AuthRequest, res: Response) {
    const { employeeId, month, year } = req.query as Record<string, string>;
    const summary = await attendanceRepository.monthlySummary(employeeId, parseInt(month), parseInt(year));
    res.json({ success: true, data: summary });
  },
  async remove(req: AuthRequest, res: Response) {
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
    });
    res.json({ success: true, data: leaves });
  },
  async create(req: AuthRequest, res: Response) {
    const leave = await leaveRepository.create(req.body);
    res.status(201).json({ success: true, data: leave });
  },
  async approve(req: AuthRequest, res: Response) {
    const leave = await leaveRepository.updateStatus(req.params.id, 'approved', req.user!.userId);
    res.json({ success: true, data: leave });
  },
  async reject(req: AuthRequest, res: Response) {
    const leave = await leaveRepository.updateStatus(req.params.id, 'rejected', req.user!.userId);
    res.json({ success: true, data: leave });
  },
  async balance(req: AuthRequest, res: Response) {
    const { employeeId, year } = req.query as Record<string, string>;
    const balance = await leaveRepository.balanceByEmployee(employeeId, parseInt(year));
    res.json({ success: true, data: balance });
  },
  async remove(req: AuthRequest, res: Response) {
    await leaveRepository.delete(req.params.id);
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
    });
    res.json({ success: true, data: payrolls });
  },
  async generate(req: AuthRequest, res: Response) {
    const { month, year } = req.body;
    const payrolls = await payrollRepository.generate(month, year);
    res.json({ success: true, data: payrolls });
  },
  async update(req: AuthRequest, res: Response) {
    const payroll = await payrollRepository.update(req.params.id, req.body);
    res.json({ success: true, data: payroll });
  },
  async markPaid(req: AuthRequest, res: Response) {
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
      await salaryAdvanceRepository.remove(req.params.id);
      res.json({ success: true, data: null });
    } catch (err) {
      res.status(400).json({ success: false, error: { message: err instanceof Error ? err.message : 'Erreur' } });
    }
  },
};
