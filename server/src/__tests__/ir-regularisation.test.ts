import { describe, it, expect } from 'vitest';
import { computeMonthlyPayslip, irAnnuel, irRegularisation, r2, type TaxScale, type PayslipInput, type IrCumul } from '../services/payroll-engine.js';

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
const prime = (amount: number) => [{ rubriqueId: 'p', label: 'Prime', kind: 'gain' as const, amount, soumisCnss: true, soumisIr: true, plafondExonerationMensuel: null, source: 'manuel' as const }];

/** Cumule des bulletins mensuels successifs (comme le repository le fait en base). */
function cumul(slips: PayslipInput[]): IrCumul {
  return slips.reduce<IrCumul>((c, i) => {
    const r = computeMonthlyPayslip(i, SCALE);
    return {
      months: c.months + 1,
      brutImposable: r2(c.brutImposable + r.brutImposable),
      cotisations: r2(c.cotisations + r.cnssEmployee + r.amoEmployee + r.cimrEmployee),
      irWithheld: r2(c.irWithheld + r.irNet),
    };
  }, { months: 0, brutImposable: 0, cotisations: 0, irWithheld: 0 });
}

describe('regularisation annuelle de l IR', () => {
  it('salaire constant sur 12 mois : regularisation = ecart d arrondi seulement', () => {
    const prev = cumul(Array(11).fill(input({ monthlySalary: 8000 })));
    const dec = computeMonthlyPayslip(input({ monthlySalary: 8000, irRegularisation: prev }), SCALE);
    // Annuel : SBI 96 000, FP 24 000, cotisations 5 395,20, RNI 66 604,80 -> IR 3 320,96.
    expect(dec.irRegularisationDetail!.irDue).toBe(3320.96);
    expect(dec.irRegularisationDetail!.irWithheld).toBe(3321); // 12 x 276,75
    expect(dec.irRegularisation).toBe(-0.04);
    expect(dec.irNet).toBe(276.71);
    expect(dec.netSalary).toBe(7273.69);
  });

  it('prime en decembre : la retenue mensuelle surtaxe, la regularisation restitue', () => {
    const prev = cumul(Array(11).fill(input({ monthlySalary: 6000 })));
    const dec = computeMonthlyPayslip(input({ monthlySalary: 6000, lines: prime(12000), irRegularisation: prev }), SCALE);
    const d = dec.irRegularisationDetail!;
    // Recalcul annuel independant : SBI 84 000 > 78 000 -> frais pro 25 %.
    expect(d.brutImposable).toBe(84000);
    expect(d.fraisPro).toBe(21000);
    const cot = 11 * (268.8 + 135.6) + 268.8 + 18000 * 0.0226;
    expect(d.cotisations).toBeCloseTo(cot, 2);
    expect(d.irDue).toBeCloseTo(irAnnuel(84000 - 21000 - cot, SCALE.irBrackets), 2);
    // Le mois de decembre seul, annualise (216 000 DH/an), est taxe a 37 % :
    // l'annee entiere ne l'est pas -> trop-percu restitue.
    expect(dec.irRegularisation).toBeLessThan(0);
    expect(r2(d.irWithheld + dec.irRegularisation)).toBe(d.irDue);
  });

  it('charges de famille declarees en cours d annee : deduction annuelle complete', () => {
    const prev = cumul(Array(11).fill(input({ monthlySalary: 8000 })));
    const dec = computeMonthlyPayslip(input({ monthlySalary: 8000, nbDependents: 3, irRegularisation: prev }), SCALE);
    // 3 x 500 = 1 500 DH sur l'annee, dont 125 deja deduits en decembre.
    expect(dec.irRegularisationDetail!.familyDeduction).toBe(1500);
    expect(dec.irRegularisationDetail!.irDue).toBe(1820.96);
    expect(dec.irRegularisation).toBeCloseTo(1820.96 - 11 * 276.75 - 151.75, 2);
  });

  it('sortie apres 6 mois a salaire constant : base proratisee, pas de restitution artificielle', () => {
    const prev = cumul(Array(5).fill(input({ monthlySalary: 8000 })));
    const out = computeMonthlyPayslip(input({ monthlySalary: 8000, irRegularisation: prev }), SCALE);
    expect(out.irRegularisationDetail!.months).toBe(6);
    expect(out.irRegularisationDetail!.fraisPro).toBe(12000); // 25 %, plafond 17 500 sur 6 mois
    expect(Math.abs(out.irRegularisation)).toBeLessThanOrEqual(0.05);
  });

  it('frais pro : taux 35 % si le brut annualise reste sous 78 000 DH', () => {
    const d = irRegularisation({ months: 2, brutImposable: 10000, cotisations: 0, irWithheld: 0 }, { brutImposable: 5000, cotisations: 0, irNet: 0 }, 0, SCALE);
    expect(d.fraisPro).toBe(5250); // 15 000 x 35 % (60 000/an annualises)
    expect(d.irDue).toBe(0);       // RNI annualise 39 000 < 40 000
  });

  it('salarie non declare : aucune regularisation', () => {
    const r = computeMonthlyPayslip(input({ monthlySalary: 8000, isDeclared: false, irRegularisation: { months: 11, brutImposable: 88000, cotisations: 0, irWithheld: 0 } }), SCALE);
    expect(r.irRegularisation).toBe(0);
    expect(r.irRegularisationDetail).toBeNull();
    expect(r.irNet).toBe(0);
  });

  it('hors decembre / sortie : rien ne change', () => {
    const r = computeMonthlyPayslip(input({ monthlySalary: 8000 }), SCALE);
    expect(r.irRegularisation).toBe(0);
    expect(r.irNet).toBe(276.75);
  });
});
