import { describe, it, expect } from 'vitest';
import { computeMonthlyPayslip, irAnnuel, serviceYears, seniorityRate, type TaxScale, type PayslipInput } from '../services/payroll-engine.js';

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

const base = (o: Partial<PayslipInput>): PayslipInput => ({
  monthlySalary: 0, baseDays: 26, coveredDays: 26, doubleDays: 0, overtimeHours: 0,
  seniorityYears: 0, nbDependents: 0, cimrRate: 0, isDeclared: true, lines: [], ...o,
});

describe('irAnnuel (bareme LF 2025, somme a deduire)', () => {
  it('continuite aux bornes de tranches', () => {
    expect(irAnnuel(40000, SCALE.irBrackets)).toBe(0);
    expect(irAnnuel(60000, SCALE.irBrackets)).toBeCloseTo(2000, 6);
    expect(irAnnuel(80000, SCALE.irBrackets)).toBeCloseTo(6000, 6);
    expect(irAnnuel(100000, SCALE.irBrackets)).toBeCloseTo(12000, 6);
    expect(irAnnuel(180000, SCALE.irBrackets)).toBeCloseTo(39200, 6);
    expect(irAnnuel(200000, SCALE.irBrackets)).toBeCloseTo(46600, 6);
  });
});

describe('computeMonthlyPayslip', () => {
  it('8 000 DH declare, mois complet : CNSS plafonnee, frais pro 25 %, IR 20 %', () => {
    const r = computeMonthlyPayslip(base({ monthlySalary: 8000 }), SCALE);
    expect(r.grossSalary).toBe(8000);
    expect(r.cnssEmployee).toBe(268.8);      // 6 000 x 4,48 %
    expect(r.amoEmployee).toBe(180.8);       // 8 000 x 2,26 %
    expect(r.fraisPro).toBe(2000);           // 96 000/an > 78 000 -> 25 %
    expect(r.netImposable).toBe(5550.4);
    expect(r.irNet).toBe(276.75);            // (66 604,8 x 20 % - 10 000) / 12
    expect(r.netSalary).toBe(7273.65);
    expect(r.cnssEmployer).toBe(538.8);
    expect(r.amoEmployer).toBe(328.8);
    expect(r.allocFamiliales).toBe(512);
    expect(r.taxeFp).toBe(128);
    expect(r.totalChargesPatron).toBe(1507.6);
  });

  it('indemnite de transport exoneree jusqu a 500 DH : hors bases CNSS et IR', () => {
    const r = computeMonthlyPayslip(base({
      monthlySalary: 3500, nbDependents: 2,
      lines: [{ rubriqueId: 't', label: 'Transport', kind: 'gain', amount: 500, soumisCnss: true, soumisIr: true, plafondExonerationMensuel: 500, source: 'fixe' }],
    }), SCALE);
    expect(r.grossSalary).toBe(4000);
    expect(r.baseCnss).toBe(3500);
    expect(r.brutImposable).toBe(3500);
    expect(r.lines[0].exemptAmount).toBe(500);
    expect(r.fraisPro).toBe(1225);           // 42 000/an <= 78 000 -> 35 %
    expect(r.irNet).toBe(0);
    expect(r.netSalary).toBe(3764.1);        // 4 000 - 156,80 - 79,10
  });

  it('part au-dela du plafond d exoneration soumise', () => {
    const r = computeMonthlyPayslip(base({
      monthlySalary: 5000,
      lines: [{ rubriqueId: 't', label: 'Transport', kind: 'gain', amount: 700, soumisCnss: true, soumisIr: true, plafondExonerationMensuel: 500, source: 'manuel' }],
    }), SCALE);
    expect(r.baseCnss).toBe(5200);
    expect(r.brutImposable).toBe(5200);
  });

  it('salarie non declare : ni cotisations ni IR, retenues deduites', () => {
    const r = computeMonthlyPayslip(base({
      monthlySalary: 3000, isDeclared: false,
      lines: [{ rubriqueId: 'p', label: 'Pret', kind: 'retenue', amount: 200, soumisCnss: false, soumisIr: false, plafondExonerationMensuel: null, source: 'manuel' }],
    }), SCALE);
    expect(r.cnssEmployee + r.amoEmployee + r.irNet + r.totalChargesPatron).toBe(0);
    expect(r.netSalary).toBe(2800);
  });

  it('absences et anciennete 10 % sur le salaire gagne', () => {
    const r = computeMonthlyPayslip(base({ monthlySalary: 5200, coveredDays: 24, seniorityYears: 6, isDeclared: false }), SCALE);
    expect(r.absenceDeduction).toBe(400);
    expect(r.seniorityBonus).toBe(480);
    expect(r.grossSalary).toBe(5280);
    expect(r.workedDays).toBe(24);
  });

  it('charges de famille plafonnees a 6 personnes et a l IR brut', () => {
    const r = computeMonthlyPayslip(base({ monthlySalary: 20000, nbDependents: 9 }), SCALE);
    expect(r.familyDeduction).toBe(250);     // 6 x 500 / 12
    expect(r.irNet).toBe(r2(r.irGross - 250));
  });
});

describe('anciennete', () => {
  it('annees revolues depuis l embauche', () => {
    expect(serviceYears('2020-11-01', '2026-10-31')).toBe(5);
    expect(serviceYears('2020-10-31', '2026-10-31')).toBe(6);
    expect(serviceYears(null, '2026-10-31')).toBeNull();
    expect(seniorityRate(5)).toBe(0.10);
  });
});

function r2(v: number) { return Math.round((v + Number.EPSILON) * 100) / 100; }
