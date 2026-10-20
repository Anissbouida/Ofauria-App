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
  contractType: z.enum(['cdi', 'cdd', 'stage', 'interim', 'saisonnier']).nullable().optional(),
  // Contrat initial cree avec l'employe (lot 4).
  category: z.enum(['cadre', 'employe', 'ouvrier']).optional(),
  jobTitle: z.string().max(120).nullable().optional(),
  withTrial: z.boolean().optional(),
  cinExpiresOn: dateStrOrEmpty,
  contractStart: dateStrOrEmpty,
  contractEnd: dateStrOrEmpty,
  emergencyContactName: z.string().max(200).nullable().optional(),
  emergencyContactPhone: z.string().max(50).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  defaultShiftCode: z.string().max(20).nullable().optional(),
  payFrequency: z.enum(['monthly', 'weekly', 'biweekly']).default('monthly'),
  weeklySalary: nullableNumber((n) => n.nonnegative('Salaire hebdo >= 0')),
  seniorityYears: nullableNumber((n) => n.int().nonnegative()),
  nbDependents: nullableNumber((n) => n.int().min(0).max(20)),
  cimrRate: nullableNumber((n) => n.nonnegative().max(100)),
  // Salarie declare : soumis CNSS/AMO/CIMR et IR (mig 318).
  isDeclared: z.boolean().optional(),
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
  // Part de nuit (21h-6h) des heures sup ; absente = calculee depuis les heures.
  overtimeNightMinutes: nullableNumber((n) => n.int().min(0).max(24 * 60)),
  // Jour de repos hebdomadaire travaille (null = jour de repos des reglages).
  isRestDay: z.boolean().nullable().optional(),
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
// 'annual' est le code du referentiel (conge paye) : absent de l'ancien enum,
// toute demande de conge annuel etait refusee (400). 'paid' = ancien alias.
export const leaveTypeSchema = z.enum([
  'annual', 'paid', 'unpaid', 'sick', 'maternity', 'paternity', 'exceptional', 'other',
]);

export const createLeaveSchema = z.object({
  employeeId: z.string().uuid('employeeId invalide'),
  type: leaveTypeSchema,
  startDate: isoDate,
  endDate: isoDate,
  reason: z.string().max(1000).nullable().optional(),
  // Admin : autorise un conge anticipe (solde negatif).
  allowNegative: z.boolean().optional(),
}).refine(v => v.endDate >= v.startDate, {
  message: 'endDate doit etre >= startDate', path: ['endDate'],
});

// ─── Payroll (mensuel) ────────────────────────────────────────────────────
// month/year peuvent arriver en string depuis certains handlers -> coerce.
export const generatePayrollSchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
});

// Les montants passent par les lignes de rubriques (PUT /payroll/:id/lines) :
// le net est toujours recalcule par le moteur. paid/paidAt/paymentMethod :
// passer par POST /pay.
export const updatePayrollSchema = z.object({
  notes: z.string().max(2000).nullable().optional(),
}).strict('Champ non autorise (montants : lignes de rubriques ; paiement : POST /pay)');

// ─── Paie : rubriques, lignes, parametres (mig 318) ──────────────────────
const money = z.coerce.number().positive('Montant > 0').max(10_000_000);

export const setPayrollLinesSchema = z.object({
  lines: z.array(z.object({
    rubriqueId: z.string().uuid('rubriqueId invalide'),
    amount: money,
    label: z.string().max(120).nullable().optional(),
  })).max(50),
});

export const payrollPeriodSchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
});

export const createRubriqueSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_]{2,30}$/, 'Code : lettres, chiffres, _ (2-30)'),
  label: z.string().min(1).max(120),
  kind: z.enum(['gain', 'retenue']),
  soumisCnss: z.boolean().default(true),
  soumisIr: z.boolean().default(true),
  plafondExonerationMensuel: nullableNumber((n) => n.nonnegative()),
  sortOrder: nullableNumber((n) => n.int().min(0).max(999)),
  notes: z.string().max(1000).nullable().optional(),
});

export const updateRubriqueSchema = createRubriqueSchema.omit({ code: true, kind: true }).partial().extend({
  isActive: z.boolean().optional(),
});

export const employeePayrollItemSchema = z.object({
  rubriqueId: z.string().uuid('rubriqueId invalide'),
  amount: money,
  startDate: dateStrOrEmpty,
  endDate: dateStrOrEmpty,
  notes: z.string().max(500).nullable().optional(),
}).refine(v => !v.startDate || !v.endDate || v.endDate >= v.startDate, { message: 'Fin >= début', path: ['endDate'] });

export const updateEmployeePayrollItemSchema = z.object({
  amount: money.optional(),
  startDate: dateStrOrEmpty,
  endDate: dateStrOrEmpty,
  notes: z.string().max(500).nullable().optional(),
});

const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'Heure HH:MM');
const pctRate = z.coerce.number().min(0).max(3);
export const payrollSettingsSchema = z.object({
  employerCnssNumber: z.string().max(30).nullable().optional(),
  monthlyBaseDays: z.coerce.number().int().min(20).max(31).optional(),
  // Conges (lot 2)
  leaveRestWeekday: z.coerce.number().int().min(0).max(6).optional(),
  leaveDaysPerMonth: z.coerce.number().positive().max(5).optional(),
  leaveCarryoverYears: z.coerce.number().int().min(0).max(5).optional(),
  // Temps de travail (lot 3)
  otRateDay: pctRate.optional(), otRateNight: pctRate.optional(),
  otRateRestDay: pctRate.optional(), otRateRestNight: pctRate.optional(),
  nightStart: hhmm.optional(), nightEnd: hhmm.optional(),
  monthlyLegalHours: z.coerce.number().positive().max(400).optional(),
  weeklyLegalHours: z.coerce.number().positive().max(80).optional(),
  holidayWorkedRate: pctRate.optional(),
  otAnnualQuotaHours: z.coerce.number().positive().max(2000).optional(),
});

const rate = z.coerce.number().min(0).max(1);
export const updateTaxScaleSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  cnssPlafond: z.coerce.number().positive().optional(),
  cnssRateEmployee: rate.optional(), cnssRateEmployer: rate.optional(),
  amoRateEmployee: rate.optional(), amoRateEmployer: rate.optional(),
  allocFamilialesRate: rate.optional(), taxeFpRate: rate.optional(),
  fraisProRateBas: rate.optional(), fraisProRateHaut: rate.optional(),
  fraisProSeuilAnnuel: z.coerce.number().nonnegative().optional(),
  fraisProPlafondAnnuel: z.coerce.number().nonnegative().optional(),
  deductionFamilleAnnuelle: z.coerce.number().nonnegative().optional(),
  maxPersonnesCharge: z.coerce.number().int().min(0).max(20).optional(),
  irBrackets: z.array(z.object({
    upTo: z.number().positive().nullable(),
    rate: rate,
    deduction: z.number().nonnegative(),
  })).min(1).max(12).refine(b => b[b.length - 1].upTo === null, 'La dernière tranche doit être ouverte (upTo = null)')
    .refine(b => b.every((x, i) => i === 0 || x.upTo === null || (b[i - 1].upTo !== null && x.upTo > (b[i - 1].upTo as number))), 'Tranches croissantes')
    .optional(),
  notes: z.string().max(2000).nullable().optional(),
});

// Modes acceptes par les CHECK des tables de paie (payroll / weekly_payroll /
// biweekly_payroll : cash|bank|check) ET reconnus par le generateur d'ecritures
// ('bank' -> 5141 BQ). L'ancien enum (bank_transfer|traite) rejetait le
// « Virement » du client ('bank') et aurait viole le CHECK en base :
// seul le paiement en especes passait. 'bank_transfer'/'transfer' restent
// acceptes en entree et normalises en 'bank'.
const payrollPaymentMethod = z.preprocess(
  (v) => (v === 'bank_transfer' || v === 'transfer' ? 'bank' : v),
  z.enum(['cash', 'bank', 'check']),
);

export const markPaidSchema = z.object({
  paymentMethod: payrollPaymentMethod.default('cash'),
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

// ─── Biweekly payroll (quinzaine 1-15 / 16-fin) ──────────────────────────
// periodStart = n'importe quelle date de la quinzaine : bornes recalculees serveur.
export const generateBiweeklyPayrollSchema = z.object({
  periodStart: isoDate,
});

export const updateBiweeklyPayrollSchema = updateWeeklyPayrollSchema;

// ─── Salary advances ─────────────────────────────────────────────────────
// Note : amount est REQUIS et > 0. Le helper nullableNumber accepte null mais
// on ajoute un refine pour rejeter null explicitement (une avance sans montant
// n'a pas de sens).
export const createAdvanceSchema = z.object({
  employeeId: z.string().uuid('employeeId invalide'),
  amount: nullableNumber((n) => n.positive('Montant > 0 requis'))
    .refine((v) => v !== null && v !== undefined, 'Montant requis'),
  paymentMethod: payrollPaymentMethod.default('cash'),
  advanceDate: dateStrOrEmpty,
  notes: z.string().max(1000).nullable().optional(),
  monthlyDeduction: nullableNumber((n) => n.positive()),
});

export const updateAdvanceSchema = z.object({
  amount: nullableNumber((n) => n.positive()),
  paymentMethod: payrollPaymentMethod.optional(),
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

// Declarations (mig 319)
export const declarePayrollSchema = z.object({
  kind: z.enum(['cnss', 'ir', 'cimr']),
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
  reference: z.string().max(40).nullable().optional(),
});
export const settlePayrollDeclarationSchema = z.object({
  kind: z.enum(['cnss', 'ir', 'cimr']),
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
  paymentMethod: payrollPaymentMethod.default('bank'),
  paymentDate: isoDate,
});

// Conges legaux (mig 320)
export const holidaySchema = z.object({
  date: isoDate,
  label: z.string().min(1).max(120),
  isConfirmed: z.boolean().optional(),
});
export const leaveAdjustmentSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  days: z.coerce.number().min(-60).max(60).refine(v => v !== 0, 'Nombre de jours non nul'),
  reason: z.string().min(3, 'Motif requis').max(300),
});

// Contrats (lot 4, mig 322)
const contractType = z.enum(['cdi', 'cdd', 'stage', 'interim', 'saisonnier']);
const contractCategory = z.enum(['cadre', 'employe', 'ouvrier']);
const contractChanges = {
  contractType: contractType.optional(),
  category: contractCategory.optional(),
  jobTitle: z.string().max(120).nullable().optional(),
  weeklyHours: z.coerce.number().positive().max(60).optional(),
  monthlySalary: nullableNumber((n) => n.nonnegative()),
  weeklySalary: nullableNumber((n) => n.nonnegative()),
  endDate: z.union([isoDate, z.null()]).optional(),
  notes: z.string().max(1000).nullable().optional(),
};
export const createContractSchema = z.object({
  ...contractChanges,
  startDate: isoDate,
  trialEndDate: z.union([isoDate, z.null()]).optional(),
  withTrial: z.boolean().optional(),
});
export const contractAvenantSchema = z.object({ ...contractChanges, effectiveDate: isoDate });
export const renewContractSchema = z.object({ endDate: isoDate, notes: z.string().max(1000).nullable().optional() });
export const endContractSchema = z.object({ endDate: isoDate, reason: z.string().min(3, 'Motif requis').max(200) });

// Solde de tout compte (lot 6, mig 323)
export const finalSettlementSchema = z.object({
  exitDate: isoDate,
  reason: z.enum(['demission', 'licenciement', 'faute_grave', 'fin_cdd', 'rupture_essai',
    'depart_negocie', 'retraite', 'deces', 'abandon_poste']),
  noticeWorked: z.boolean().default(true),
  damagesMonths: z.coerce.number().min(0).max(36).optional(),
  notes: z.string().max(1000).nullable().optional(),
  paymentMethod: payrollPaymentMethod.optional(),
});
