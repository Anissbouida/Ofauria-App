import { describe, it, expect } from 'vitest';
import { nightMinutes, nightOvertimeMinutes, classifyOvertime, overtimeAmount, holidayDays } from '../services/overtime-engine.js';
import { computeMonthlyPayslip, type TaxScale } from '../services/payroll-engine.js';

describe('heures de nuit (21h-6h)', () => {
  it('service de jour : pas de nuit', () => expect(nightMinutes('07:00', '15:00')).toBe(0));
  it('depart a 23h : 2 h de nuit', () => expect(nightMinutes('14:00', '23:00')).toBe(120));
  it('service de nuit qui passe minuit (boulangerie 2h-10h)', () => expect(nightMinutes('02:00', '10:00')).toBe(240));
  it('22h -> 4h (passe minuit)', () => expect(nightMinutes('22:00', '04:00')).toBe(360));
  it('part de nuit des heures sup plafonnee au total', () => {
    expect(nightOvertimeMinutes(60, '14:00', '23:00')).toBe(60);
    expect(nightOvertimeMinutes(180, '14:00', '23:00')).toBe(120);
    expect(nightOvertimeMinutes(60, null, '23:00')).toBe(0);
  });
});

describe('ventilation et montant', () => {
  // 2026-10-18 = dimanche (repos), 2026-10-19 = lundi.
  const rows = [
    { date: '2026-10-19', overtimeMinutes: 180, overtimeNightMinutes: 60, isRestDay: null },
    { date: '2026-10-18', overtimeMinutes: 120, overtimeNightMinutes: 0, isRestDay: null },
    { date: '2026-10-20', overtimeMinutes: 60, overtimeNightMinutes: 60, isRestDay: true },
  ];
  it('jour / nuit, ouvrable / repos', () => {
    expect(classifyOvertime(rows, 0)).toEqual({ day: 2, night: 1, restDay: 2, restNight: 1 });
  });
  it('majorations 25 / 50 / 50 / 100 %', () => {
    // taux horaire 20 : 2x25 + 1x30 + 2x30 + 1x40 = 180
    expect(overtimeAmount({ day: 2, night: 1, restDay: 2, restNight: 1 }, 20)).toBe(180);
  });
});

describe('jours feries', () => {
  const holidays = ['2026-10-31', '2026-11-06', '2026-11-18', '2026-11-01'];
  it('non travaille = paye ; travaille = indemnite ; repos et avant embauche exclus', () => {
    const att = new Map([['2026-11-06', 'present']]);
    // 01/11/2026 est un dimanche (jour de repos) ; 18/11 avant l'embauche fictive ? non : embauche 2026-10-01
    expect(holidayDays(holidays, '2026-10-01', '2026-11-30', att, { restWeekday: 0, hireDate: '2026-10-01' }))
      .toEqual({ paid: 2, worked: 1 });
    expect(holidayDays(holidays, '2026-10-01', '2026-11-30', att, { restWeekday: 0, hireDate: '2026-11-10' }))
      .toEqual({ paid: 1, worked: 0 });
  });
});

describe('paie mensuelle avec heures sup majorees et ferie travaille', () => {
  const scale: TaxScale = {
    cnssPlafond: 6000, cnssRateEmployee: 0.0448, cnssRateEmployer: 0.0898, amoRateEmployee: 0.0226, amoRateEmployer: 0.0411,
    allocFamilialesRate: 0.064, taxeFpRate: 0.016, fraisProRateBas: 0.35, fraisProRateHaut: 0.25,
    fraisProSeuilAnnuel: 78000, fraisProPlafondAnnuel: 35000, deductionFamilleAnnuelle: 500, maxPersonnesCharge: 6,
    irBrackets: [{ upTo: null, rate: 0, deduction: 0 }],
  };
  it('3 820 DH : taux horaire 20 (/191), ferie travaille = +1 jour', () => {
    const r = computeMonthlyPayslip({
      monthlySalary: 3820, baseDays: 26, coveredDays: 26, doubleDays: 0, overtimeHours: 4,
      seniorityYears: 0, nbDependents: 0, cimrRate: 0, isDeclared: false, lines: [],
      overtime: { day: 2, night: 1, restDay: 0, restNight: 1 }, holidayWorkedDays: 1,
    }, scale);
    expect(r.overtimeAmount).toBe(120);       // 2x25 + 1x30 + 1x40
    expect(r.holidayPremium).toBe(146.92);    // 3 820 / 26
    expect(r.grossSalary).toBe(4086.92);
  });
});
