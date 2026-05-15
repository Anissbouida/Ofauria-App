import type { Request, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { employeeRepository, scheduleRepository, attendanceRepository, leaveRepository, payrollRepository } from '../repositories/employee.repository.js';

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Strip pin_code hash from API responses, expose has_pin boolean instead.
function publicEmployee<T extends { pin_code?: string | null }>(emp: T): Omit<T, 'pin_code'> & { has_pin: boolean } {
  const { pin_code, ...rest } = emp;
  return { ...rest, has_pin: !!pin_code };
}

export const employeeController = {
  async list(req: AuthRequest, res: Response) {
    const employees = await employeeRepository.findAll(req.user!.storeId);
    res.json({ success: true, data: employees.map(publicEmployee) });
  },
  async getById(req: AuthRequest, res: Response) {
    const employee = await employeeRepository.findById(req.params.id);
    if (!employee) { res.status(404).json({ success: false, error: { message: 'Employe non trouve' } }); return; }
    res.json({ success: true, data: publicEmployee(employee) });
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

// ═══════════════════════════════════════════════════════════════════════════
// Kiosque pointeuse self-service — routes publiques (PIN = seul credential)
// ═══════════════════════════════════════════════════════════════════════════

export const attendanceKioskController = {
  // POST /attendance/kiosk/clock — toggle clock-in/clock-out selon l'etat du jour
  async clock(req: Request, res: Response) {
    const { pin, terminal, storeId } = req.body as { pin?: string; terminal?: string; storeId?: string };
    if (!pin || pin.length < 4 || pin.length > 10) {
      res.status(400).json({ success: false, error: { message: 'PIN invalide' } });
      return;
    }

    // Recherche par PIN, optionnellement bornee au store du kiosque pour eviter
    // qu'un PIN reutilise sur un autre site ne reponde a la place du bon.
    const employee = await employeeRepository.findByPin(pin, storeId);
    if (!employee) {
      // Reponse generique pour ne pas reveler si le PIN existe.
      res.status(401).json({ success: false, error: { message: 'PIN inconnu' } });
      return;
    }

    const date = todayISO();
    const time = nowHHMM();
    const today = await attendanceRepository.findToday(employee.id);

    let action: 'check_in' | 'check_out';
    let record;

    if (!today || !today.check_in) {
      // Premiere arrivee du jour
      record = await attendanceRepository.upsert({
        employeeId: employee.id, date, checkIn: time, status: 'present',
        checkInMethod: 'pin', checkInTerminal: terminal || null as unknown as string,
      });
      action = 'check_in';
    } else if (!today.check_out) {
      // Depart du jour
      record = await attendanceRepository.upsert({
        employeeId: employee.id, date, checkOut: time, status: today.status || 'present',
        checkOutMethod: 'pin', checkOutTerminal: terminal || null as unknown as string,
      });
      action = 'check_out';
    } else {
      // Deja parti aujourd'hui — on refuse plutot que de re-pointer
      res.status(409).json({
        success: false,
        error: { message: 'Vous avez deja pointe votre depart aujourd\'hui' },
      });
      return;
    }

    res.json({
      success: true,
      data: {
        action,
        employee: {
          id: employee.id,
          firstName: employee.first_name,
          lastName: employee.last_name,
          role: employee.role,
        },
        record,
      },
    });
  },

  // GET /attendance/kiosk/active?storeId=...
  // Sert au POS pour savoir qui est en service et afficher un selecteur "vendu par".
  async listActive(req: Request, res: Response) {
    const { storeId } = req.query as Record<string, string>;
    if (!storeId) {
      res.status(400).json({ success: false, error: { message: 'storeId requis' } });
      return;
    }
    const active = await attendanceRepository.findActiveOnStore(storeId);
    res.json({
      success: true,
      data: active.map((a) => ({
        employeeId: a.employee_id,
        firstName: a.first_name,
        lastName: a.last_name,
        role: a.role,
        checkIn: a.check_in,
      })),
    });
  },
};

// PIN setter — protege admin uniquement
export const employeePinController = {
  async setPin(req: AuthRequest, res: Response) {
    const { pin } = req.body as { pin?: string };
    if (!pin || !/^\d{4,6}$/.test(pin)) {
      res.status(400).json({ success: false, error: { message: 'PIN doit etre 4 a 6 chiffres' } });
      return;
    }
    await employeeRepository.setPin(req.params.id, pin);
    res.json({ success: true, data: null });
  },

  async clearPin(req: AuthRequest, res: Response) {
    await employeeRepository.setPin(req.params.id, '');
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
