import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { employeeRepository, scheduleRepository, attendanceRepository, leaveRepository, payrollRepository } from '../repositories/employee.repository.js';

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
    const employee = await employeeRepository.create(req.body);
    res.status(201).json({ success: true, data: employee });
  },
  async update(req: AuthRequest, res: Response) {
    const employee = await employeeRepository.update(req.params.id, req.body);
    res.json({ success: true, data: employee });
  },
  async remove(req: AuthRequest, res: Response) {
    await employeeRepository.delete(req.params.id);
    res.json({ success: true, data: null });
  },
};

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
    const { employeeId, status, year } = req.query as Record<string, string>;
    const leaves = await leaveRepository.findAll({
      employeeId, status, year: year ? parseInt(year) : undefined,
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
    const { paymentMethod } = req.body;
    const payroll = await payrollRepository.markPaid(req.params.id, paymentMethod || 'cash', req.user!.userId, req.user!.storeId);
    res.json({ success: true, data: payroll });
  },
};
