import { describe, it, expect } from 'vitest';
import {
  computeMonthlyPayslip, provisionalWithholding, periodMonth, periodsPerMonth,
  type TaxScale, type PayslipInput,
} from '../services/payroll-engine.js';

// Bareme LF 2025 (mig 318).
const SCALE: TaxScale = {
  cnssPlafond: 6000, cnssRateEmployee: 0.0448, cnssRateEmployer: 0.0898,
  amoRateEmployee: 0.0226, amoRateEmployer: 0.0411,
  allocFamilialesRate: 0.064, taxeFpRate: 0.016,
  fraisProRateBas: 0.35, fraisProRateHaut: 0.25,
  fraisProSeuilAnnuel: 78000, fraisProPlafondAnnuel: 35000,
  deductionFamilleAnnuelle: 500, maxPersonnesCharge: 6,
  irBrackets: [
    { upTo: 40000, rate: 0, deduction: 0 },
    { upTo: 60000, rate: 0.10, deduction: 4000 },
    { upTo: 80000, rate: 0.20, deduction: 10000 },
    { upTo: 100000, rate: 0.30, deduction: 18000 },
    { upTo: 180000, rate: 0.34, deduction: 22000 },
    { upTo: null, rate: 0.37, deduction: 27400 },
  ],
};

const input = (o: Partial<PayslipInput>): PayslipInput => ({
  monthlySalary: 0, baseDays: 26, coveredDays: 26, doubleDays: 0, overtimeHours: 0,
  seniorityYears: 0, nbDependents: 0, cimrRate: 0, isDeclared: true, lines: [], ...o,
});

describe('bulletin mensuel d\'un salarie hebdo / quinzaine declare', () => {
  it('brut = paies periodiques du mois, sans retenue d\'absence', () => {
    const r = computeMonthlyPayslip(input({ periodic: { base: 3000, overtime: 120, holiday: 0, paidDays: 22 } }), SCALE);
    expect(r.grossSalary).toBe(3120);
    expect(r.absenceDeduction).toBe(0);
    expect(r.workedDays).toBe(22);
    expect(r.cnssEmployee).toBeCloseTo(3120 * 0.0448, 2);
    expect(r.amoEmployee).toBeCloseTo(3120 * 0.0226, 2);
  });

  it('anciennete sur la base periodique seulement (pas sur les HS)', () => {
    const r = computeMonthlyPayslip(input({ seniorityYears: 6, periodic: { base: 4000, overtime: 200, holiday: 50, paidDays: 26 } }), SCALE);
    expect(r.seniorityBonus).toBe(400);
    expect(r.grossSalary).toBe(4650);
  });

  it('jours declares plafonnes a la base de 26', () => {
    const r = computeMonthlyPayslip(input({ periodic: { base: 3500, overtime: 0, holiday: 0, paidDays: 30.33 } }), SCALE);
    expect(r.workedDays).toBe(26);
  });
});

describe('retenue provisoire des acomptes', () => {
  it('quinzaine sous le seuil d\'IR : CNSS + AMO seulement', () => {
    const w = provisionalWithholding(1500, 'biweekly', { nbDependents: 0, cimrRate: 0 }, SCALE);
    expect(w).toBeCloseTo(1500 * (0.0448 + 0.0226), 2);
  });

  it('la somme des acomptes approche le bulletin exact du mois', () => {
    const weekly = 2000;
    const w = provisionalWithholding(weekly, 'weekly', { nbDependents: 1, cimrRate: 0 }, SCALE);
    const k = periodsPerMonth('weekly');
    const exact = computeMonthlyPayslip(input({ nbDependents: 1, periodic: { base: weekly * k, overtime: 0, holiday: 0, paidDays: 26 } }), SCALE);
    const retenuesExactes = exact.cnssEmployee + exact.amoEmployee + exact.irNet;
    expect(w * k).toBeCloseTo(retenuesExactes, 1);
    expect(exact.irNet).toBeGreaterThan(0);
  });

  it('brut nul ou negatif : aucune retenue', () => {
    expect(provisionalWithholding(0, 'weekly', { nbDependents: 0, cimrRate: 0 }, SCALE)).toBe(0);
  });
});

describe('mois de rattachement d\'une periode', () => {
  it('semaine : mois de son jeudi', () => {
    expect(periodMonth('2026-09-28', 'weekly')).toEqual({ month: 10, year: 2026 }); // jeudi 1er octobre
    expect(periodMonth('2026-10-26', 'weekly')).toEqual({ month: 10, year: 2026 }); // jeudi 29 octobre
    expect(periodMonth('2026-12-28', 'weekly')).toEqual({ month: 12, year: 2026 }); // jeudi 31 decembre
    expect(periodMonth('2027-01-25', 'weekly')).toEqual({ month: 1, year: 2027 });
  });
  it('quinzaine : son propre mois', () => {
    expect(periodMonth('2026-10-16', 'biweekly')).toEqual({ month: 10, year: 2026 });
  });
});
