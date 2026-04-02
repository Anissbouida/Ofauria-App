import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { employeeRepository, scheduleRepository } from '../repositories/employee.repository.js';

export const employeeController = {
  async list(_req: AuthRequest, res: Response) {
    const employees = await employeeRepository.findAll();
    res.json({ success: true, data: employees });
  },
  async getById(req: AuthRequest, res: Response) {
    const employee = await employeeRepository.findById(req.params.id);
    if (!employee) { res.status(404).json({ success: false, error: { message: 'Employé non trouvé' } }); return; }
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
