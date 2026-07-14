import { z } from 'zod';

// ─── Employees ────────────────────────────────────────────────────────────
// Salaires >= 0, dates optionnelles nullable, roles bornes.

const dateStrOrEmpty = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date YYYY-MM-DD requise'),
  z.literal(''),
  z.null(),
]).optional();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date YYYY-MM-DD requise');
const monthNum = z.number().int().min(1).max(12);
const yearNum = z.number().int().min(2000).max(2100);

export const createEmployeeSchema = z.object({
  userId: z.string().uuid().nullable().optional(),
  firstName: z.string().min(1, 'Prenom requis').max(100),
  lastName: z.string().min(1, 'Nom requis').max(100),
  role: z.string().min(1).max(50),
  phone: z.string().max(50).nullable().optional(),
  monthlySalary: z.number().nonnegative('Salaire mensuel >= 0').nullable().optional(),
  hireDate: isoDate,
  cin: z.string().max(50).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  birthDate: dateStrOrEmpty,
  cnssNumber: z.string().max(50).nullable().optional(),
  contractType: z.string().max(50).nullable().optional(),
  contractStart: dateStrOrEmpty,
  contractEnd: dateStrOrEmpty,
  emergencyContactName: z.string().max(200).nullable().optional(),
  emergencyContactPhone: z.string().max(50).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  defaultShiftCode: z.string().max(20).nullable().optional(),
  payFrequency: z.enum(['monthly', 'weekly']).default('monthly'),
  weeklySalary: z.number().nonnegative('Salaire hebdo >= 0').nullable().optional(),
  seniorityYears: z.number().int().nonnegative().nullable().optional(),
  nbDependents: z.number().int().min(0).max(20).nullable().optional(),
  cimrRate: z.number().nonnegative().max(100).nullable().optional(),
});

export const updateEmployeeSchema = createEmployeeSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// ─── Attendance ───────────────────────────────────────────────────────────
// Statuts alignes sur le CHECK db (mig 018/155/230).
export const attendanceStatusSchema = z.enum([
  'present', 'absent', 'late', 'half_day', 'repos', 'double',
]);

// Un enregistrement en TIME (mig 018) : "HH:MM" ou "HH:MM:SS".
const timeStr = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Heure HH:MM requise');
const optionalTime = z.union([timeStr, z.literal(''), z.null()]).optional().transform(v => v === '' ? null : v);

export const upsertAttendanceSchema = z.object({
  employeeId: z.string().uuid('employeeId invalide'),
  date: isoDate,
  status: attendanceStatusSchema,
  checkIn: optionalTime,
  checkOut: optionalTime,
  overtimeMinutes: z.number().int().min(0).max(24 * 60, 'H.Sup max 24h').optional(),
  notes: z.string().max(500).nullable().optional(),
  checkInMethod: z.string().max(50).nullable().optional(),
  checkInTerminal: z.string().max(100).nullable().optional(),
  checkOutMethod: z.string().max(50).nullable().optional(),
  checkOutTerminal: z.string().max(100).nullable().optional(),
}).refine(v => {
  // checkOut >= checkIn si les deux sont renseignes (les shifts de nuit
  // sont pointes sur deux dates distinctes, ce cas est OK pour la meme
  // date : cf. migration TIMESTAMPTZ P2.2).
  if (!v.checkIn || !v.checkOut) return true;
  return v.checkOut >= v.checkIn;
}, { message: 'checkOut doit etre >= checkIn', path: ['checkOut'] });

export const bulkAttendanceSchema = z.object({
  records: z.array(upsertAttendanceSchema).min(1).max(500, 'Batch max 500 lignes'),
});

// ─── Leaves ────────────────────────────────────────────────────────────────
// Types de conge : aligne sur le CHECK db (mig 018). `days` n'est pas
// requis cote client — recalcule serveur depuis start/end pour eviter
// fraude/fausse comptabilite.
export const leaveTypeSchema = z.enum([
  'paid', 'unpaid', 'sick', 'maternity', 'paternity', 'other',
]);

export const createLeaveSchema = z.object({
  employeeId: z.string().uuid('employeeId invalide'),
  type: leaveTypeSchema,
  startDate: isoDate,
  endDate: isoDate,
  reason: z.string().max(1000).nullable().optional(),
}).refine(v => v.endDate >= v.startDate, {
  message: 'endDate doit etre >= startDate', path: ['endDate'],
});

// ─── Payroll (mensuel) ────────────────────────────────────────────────────
export const generatePayrollSchema = z.object({
  month: monthNum,
  year: yearNum,
});

export const updatePayrollSchema = z.object({
  bonuses: z.number().nonnegative().optional(),
  deductions: z.number().nonnegative().optional(),
  notes: z.string().max(2000).nullable().optional(),
  // paid/paidAt/paymentMethod deliberement absents : passer par POST /pay.
}).strict('Champ non autorise (paid/paidAt/paymentMethod : utiliser POST /pay)');

export const markPaidSchema = z.object({
  paymentMethod: z.enum(['cash', 'bank_transfer', 'check', 'traite']).default('cash'),
  advanceDeduction: z.number().nonnegative().default(0),
});

// ─── Weekly payroll ──────────────────────────────────────────────────────
export const generateWeeklyPayrollSchema = z.object({
  weekStart: isoDate,
});

export const updateWeeklyPayrollSchema = z.object({
  baseAmount: z.number().nonnegative().optional(),
  workedDays: z.number().nonnegative().max(31).optional(),
  absentDays: z.number().int().min(0).max(31).optional(),
  overtimeHours: z.number().nonnegative().optional(),
  overtimeAmount: z.number().nonnegative().optional(),
  netAmount: z.number().nonnegative().optional(),
  notes: z.string().max(2000).nullable().optional(),
}).strict('Champ non autorise');

// ─── Salary advances ─────────────────────────────────────────────────────
export const createAdvanceSchema = z.object({
  employeeId: z.string().uuid('employeeId invalide'),
  amount: z.number().positive('Montant > 0 requis'),
  paymentMethod: z.enum(['cash', 'bank_transfer', 'check']).default('cash'),
  advanceDate: dateStrOrEmpty,
  notes: z.string().max(1000).nullable().optional(),
  monthlyDeduction: z.number().positive().nullable().optional(),
});

export const updateAdvanceSchema = z.object({
  amount: z.number().positive().optional(),
  paymentMethod: z.enum(['cash', 'bank_transfer', 'check']).optional(),
  advanceDate: isoDate.optional(),
  notes: z.string().max(1000).nullable().optional(),
  monthlyDeduction: z.number().nullable().optional(),
});

// ─── Schedules ────────────────────────────────────────────────────────────
export const createScheduleSchema = z.object({
  employeeId: z.string().uuid('employeeId invalide'),
  date: isoDate,
  startTime: timeStr,
  endTime: timeStr,
  breakMinutes: z.number().int().min(0).max(24 * 60).optional(),
  notes: z.string().max(500).nullable().optional(),
  shiftCode: z.string().max(20).nullable().optional(),
});

export const updateScheduleSchema = createScheduleSchema.partial();

export const bulkWeekScheduleSchema = z.object({
  weekStart: isoDate,
  assignments: z.array(z.object({
    employeeId: z.string().uuid(),
    date: isoDate,
    shiftCode: z.string().max(20).nullable(),
  })).max(2000, 'Batch max 2000 assignations'),
});
