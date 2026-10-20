import { describe, it, expect } from 'vitest';
import { computeHrAnalytics, attendanceHours } from '../services/hr-analytics.js';

const money = (gross: number, charges: number, otherNet = 0) => ({ gross, charges, net: gross * 0.9, overtime: 0, otherNet });

describe('pilotage RH', () => {
  // Mars 2026 : 31 jours, 5 dimanches (1, 8, 15, 22, 29) -> 26 jours ouvrables (aucun ferie fourni).
  const base = {
    year: 2026, today: '2026-03-31', restWeekday: 0, holidays: new Set<string>(), weeklyLegalHours: 44,
    employees: [
      { id: 'a', name: 'A', role: 'Boulanger', contractType: 'cdi', start: '2020-01-01', end: null, exitReason: null },
      { id: 'b', name: 'B', role: 'Vendeuse', contractType: 'cdd', start: '2026-02-01', end: '2026-03-15', exitReason: 'fin_cdd' },
      { id: 'c', name: 'C', role: 'Vendeuse', contractType: 'cdi', start: '2026-03-16', end: null, exitReason: null },
    ],
    attendance: [
      { employeeId: 'a', date: '2026-03-02', status: 'absent', checkIn: null, checkOut: null, overtimeMinutes: 0 },
      { employeeId: 'a', date: '2026-03-03', status: 'present', checkIn: '06:00', checkOut: '14:00', overtimeMinutes: 0 },
      { employeeId: 'a', date: '2026-03-04', status: 'half_day', checkIn: null, checkOut: null, overtimeMinutes: 0 },
    ],
    leaves: [
      { employeeId: 'c', start: '2026-03-23', end: '2026-03-24', paid: false, unit: 'ouvrable' as const },
      { employeeId: 'a', start: '2026-03-25', end: '2026-03-26', paid: true, unit: 'ouvrable' as const },
    ],
    payroll: { 1: money(10000, 2000), 2: money(12000, 2400), 3: money(12000, 2400, 1000) },
    revenue: { 1: 50000, 2: 60000, 3: 61000 },
  };
  const r = computeHrAnalytics(base);
  const mar = r.months[2];

  it('effectif, entrees et sorties par mois', () => {
    expect(r.months.length).toBe(3);                  // pas de mois futurs
    expect(r.months[1]).toMatchObject({ headcount: 2, entries: 1, exits: 0 });
    expect(mar).toMatchObject({ headcount: 2, entries: 1, exits: 1 });
    expect(r.totals.turnoverRate).toBe(Math.round(1 / ((1 + 2 + 2) / 3) * 1000) / 10);  // 1 / 1,67 = 60 %
  });

  it('absenteisme : absence pointee + demi-journee + conge non paye, pas le conge paye', () => {
    // A : 1 + 0,5 ; C : 2 jours de conge non paye.
    expect(mar.absenceDays).toBe(3.5);
    // Jours theoriques : A 26 + B 13 (1-15 mars hors 1er et 8) + C 13 (16-31 hors 22 et 29)
    expect(mar.theoreticalDays).toBe(26 + 13 + 13);
    expect(mar.absenteeismRate).toBe(Math.round(3.5 / 52 * 1000) / 10);
  });

  it('cout de main-d oeuvre et ratio au chiffre d affaires', () => {
    expect(mar.laborCost).toBe(15400);               // 12 000 + 2 400 + 1 000
    expect(mar.laborCostRatio).toBe(25.2);           // 15 400 / 61 000
    expect(mar.hoursWorked).toBeCloseTo(8 + 44 / 12, 1);
  });

  it('repartitions sur l effectif en fin de periode', () => {
    expect(r.breakdowns.byRole).toEqual([{ label: 'Boulanger', value: 1 }, { label: 'Vendeuse', value: 1 }].sort((a, b) => b.value - a.value));
    expect(r.breakdowns.exitReasons).toEqual([{ label: 'fin_cdd', value: 1 }]);
    expect(r.topAbsentees[0]).toMatchObject({ employeeId: 'c', days: 2 });
  });

  it('heures d une journee : pointage sinon journee standard', () => {
    expect(attendanceHours({ employeeId: 'x', date: '', status: 'present', checkIn: '22:00', checkOut: '06:00', overtimeMinutes: 0 }, 44)).toBe(8);
    expect(attendanceHours({ employeeId: 'x', date: '', status: 'present', checkIn: null, checkOut: null, overtimeMinutes: 60 }, 44)).toBeCloseTo(44 / 6 + 1, 5);
  });
});
