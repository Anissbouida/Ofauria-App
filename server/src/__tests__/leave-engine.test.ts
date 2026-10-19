import { describe, it, expect } from 'vitest';
import { computeLeaveBalance, countLeaveDays, leaveDates, fullMonthsBetween, annualEntitlement } from '../services/leave-engine.js';

describe('droits annuels', () => {
  it('18 j de base, +1,5 j par tranche de 5 ans, plafond 30', () => {
    expect(annualEntitlement(1.5, 4).total).toBe(18);
    expect(annualEntitlement(1.5, 5).total).toBe(19.5);
    expect(annualEntitlement(1.5, 10).total).toBe(21);
    expect(annualEntitlement(1.5, 45).total).toBe(30);
  });
  it('mois entiers de service', () => {
    expect(fullMonthsBetween('2026-06-05', '2026-10-20')).toBe(4);
    expect(fullMonthsBetween('2026-01-01', '2027-01-01')).toBe(12);
  });
});

describe('computeLeaveBalance', () => {
  it('ancien salarie : reliquat N-1 reporte, N-2 expire, acquisition au prorata', () => {
    const b = computeLeaveBalance({ hireDate: '2020-01-01', asOf: '2026-10-19', takenByYear: {} });
    const y2026 = b.years.find(y => y.year === 2026)!;
    expect(b.seniorityBonus).toBe(1.5);
    expect(y2026.months).toBe(9);
    expect(y2026.acquired).toBe(14.63);       // 9 x 19,5 / 12
    expect(b.carriedOver).toBe(19.5);         // droits 2025 (5 ans revolus fin 2025)
    expect(b.expiringThisYear).toBe(19.5);
    expect(b.available).toBe(34.13);
    expect(b.years.find(y => y.year === 2024)!.expired).toBe(18); // 4 ans revolus fin 2024
  });

  it('nouvel embauche : prorata, solde negatif si conge anticipe', () => {
    const b = computeLeaveBalance({ hireDate: '2026-06-05', asOf: '2026-10-19', takenByYear: { 2026: 8 } });
    expect(b.acquiredThisYear).toBe(6);
    expect(b.available).toBe(-2);
  });

  it('consommation FIFO : le plus ancien droit d abord', () => {
    const b = computeLeaveBalance({ hireDate: '2024-01-01', asOf: '2025-12-31', takenByYear: { 2025: 20 } });
    // 2024 : 18 (reportes) ; 2025 : 18. 20 pris = 18 de 2024 + 2 de 2025.
    expect(b.available).toBe(16);
    expect(b.carriedOver).toBe(0);
  });

  it('decouvert rembourse par les droits de l annee suivante', () => {
    const b = computeLeaveBalance({ hireDate: '2025-07-01', asOf: '2026-12-31', takenByYear: { 2025: 12 } });
    // 2025 : 9 acquis, 12 pris -> -3 ; 2026 : 18 - 3 = 15.
    expect(b.available).toBe(15);
  });

  it('ajustement (reprise d un solde initial)', () => {
    const b = computeLeaveBalance({ hireDate: '2026-01-01', asOf: '2026-03-31', takenByYear: {}, adjustmentsByYear: { 2026: 5 } });
    expect(b.available).toBe(9.5);           // 3 mois x 1,5 + 5
  });

  it('salarie mineur : 2 j par mois', () => {
    const b = computeLeaveBalance({ hireDate: '2026-01-01', birthDate: '2010-05-01', asOf: '2026-06-30', takenByYear: {} });
    expect(b.acquiredThisYear).toBe(12);     // 6 mois x 2
  });
});

describe('decompte des jours', () => {
  const holidays = new Set(['2026-10-31', '2026-11-06']);
  it('jours ouvrables : hors dimanche et feries', () => {
    expect(countLeaveDays('2026-10-26', '2026-11-08', { unit: 'ouvrable', restWeekday: 0, holidays })).toBe(10);
    expect(countLeaveDays('2026-10-26', '2026-11-08', { unit: 'calendaire', restWeekday: 0, holidays })).toBe(14);
  });
  it('dates comptees dans la paie, bornees au mois', () => {
    expect(leaveDates('2026-10-29', '2026-11-03', '2026-10-01', '2026-10-31', { unit: 'ouvrable', restWeekday: 0, holidays }))
      .toEqual(['2026-10-29', '2026-10-30']);
  });
});
