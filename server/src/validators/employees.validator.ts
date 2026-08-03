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

/**
 * Wrappe un schema z.number() pour tolerer :
 *   - '' (champ formulaire vide) -> null
 *   - null / undefined -> passe
 *   - string convertible en number -> convertit
 *   - number -> passe
 * Le formulaire HTML envoie systematiquement '' pour un input vide ;
 * z.number() strict refuse ces valeurs -> UX cassee sur toute edition.
 */
function nullableNumber(check: (n: z.ZodNumber) => z.ZodNumber = (n) => n) {
  return z.preprocess((v) => {
    if (v === '' || v === null || v === undefined) return null;
    if (typeof v === 'string') {
      const parsed = Number(v);
      return Number.isFinite(parsed) ? parsed : v; // laisse zod rejeter les NaN
    }
    return v;
  }, check(z.number()).nullable().optional());
}

export const createEmployeeSchema = z.object({
  userId: z.string().uuid().nullable().optional(),
  firstName: z.string().min(1, 'Prenom requis').max(100),
  lastName: z.string().min(1, 'Nom requis').max(100),
  role: z.string().min(1).max(50),
  phone: z.string().max(50).nullable().optional(),
  monthlySalary: nullableNumber((n) => n.nonnegative('Salaire mensuel >= 0')),
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
  weeklySalary: nullableNumber((n) => n.nonnegative('Salaire hebdo >= 0')),
  seniorityYears: nullableNumber((n) => n.int().nonnegative()),
  nbDependents: nullableNumber((n) => n.int().min(0).max(20)),
  cimrRate: nullableNumber((n) => n.nonnegative().max(100)),
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
  overtimeMinutes: nullableNumber((n) => n.int().min(0).max(24 * 60, 'H.Sup max 24h')),
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
// month/year peuvent arriver en string depuis certains handlers -> coerce.
export const generatePayrollSchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
});

export const updatePayrollSchema = z.object({
  bonuses: nullableNumber((n) => n.nonnegative()),
  deductions: nullableNumber((n) => n.nonnegative()),
  notes: z.string().max(2000).nullable().optional(),
  // paid/paidAt/paymentMethod deliberement absents : passer par POST /pay.
}).strict('Champ non autorise (paid/paidAt/paymentMethod : utiliser POST /pay)');

export const markPaidSchema = z.object({
  paymentMethod: z.enum(['cash', 'bank_transfer', 'check', 'traite']).default('cash'),
  advanceDeduction: nullableNumber((n) => n.nonnegative()).default(0),
});

// ─── Weekly payroll ──────────────────────────────────────────────────────
export const generateWeeklyPayrollSchema = z.object({
  weekStart: isoDate,
});

export const updateWeeklyPayrollSchema = z.object({
  baseAmount: nullableNumber((n) => n.nonnegative()),
  workedDays: nullableNumber((n) => n.nonnegative().max(31)),
  absentDays: nullableNumber((n) => n.int().min(0).max(31)),
  overtimeHours: nullableNumber((n) => n.nonnegative()),
  overtimeAmount: nullableNumber((n) => n.nonnegative()),
  netAmount: nullableNumber((n) => n.nonnegative()),
  notes: z.string().max(2000).nullable().optional(),
}).strict('Champ non autorise');

// ─── Salary advances ─────────────────────────────────────────────────────
// Note : amount est REQUIS et > 0. Le helper nullableNumber accepte null mais
// on ajoute un refine pour rejeter null explicitement (une avance sans montant
// n'a pas de sens).
export const createAdvanceSchema = z.object({
  employeeId: z.string().uuid('employeeId invalide'),
  amount: nullableNumber((n) => n.positive('Montant > 0 requis'))
    .refine((v) => v !== null && v !== undefined, 'Montant requis'),
  paymentMethod: z.enum(['cash', 'bank_transfer', 'check']).default('cash'),
  advanceDate: dateStrOrEmpty,
  notes: z.string().max(1000).nullable().optional(),
  monthlyDeduction: nullableNumber((n) => n.positive()),
});

export const updateAdvanceSchema = z.object({
  amount: nullableNumber((n) => n.positive()),
  paymentMethod: z.enum(['cash', 'bank_transfer', 'check']).optional(),
  advanceDate: isoDate.optional(),
  notes: z.string().max(1000).nullable().optional(),
  monthlyDeduction: nullableNumber(),
});

// ─── Schedules ────────────────────────────────────────────────────────────
export const createScheduleSchema = z.object({
  employeeId: z.string().uuid('employeeId invalide'),
  date: isoDate,
  startTime: timeStr,
  endTime: timeStr,
  breakMinutes: nullableNumber((n) => n.int().min(0).max(24 * 60)),
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
