import { describe, it, expect } from 'vitest';
import { noticePeriod, severanceHours, computeSettlement, seniority } from '../services/final-settlement.js';

describe('bareme legal', () => {
  it('preavis : cadre 1/2/3 mois, employe-ouvrier 8 j / 1 / 2 mois', () => {
    expect(noticePeriod('cadre', 0.5).months).toBe(1);
    expect(noticePeriod('cadre', 3).months).toBe(2);
    expect(noticePeriod('cadre', 8).months).toBe(3);
    expect(noticePeriod('ouvrier', 0.5)).toMatchObject({ months: 0, days: 8 });
    expect(noticePeriod('employe', 2).months).toBe(1);
    expect(noticePeriod('employe', 6).months).toBe(2);
  });
  it('indemnite de licenciement : 96 / 144 / 192 / 240 h par annee, tranche par tranche', () => {
    expect(severanceHours(3)).toBe(288);
    expect(severanceHours(7)).toBe(768);         // 5 x 96 + 2 x 144
    expect(severanceHours(20)).toBe(3360);       // 480 + 720 + 960 + 5 x 240
    expect(severanceHours(2.5)).toBe(240);       // fraction au prorata
  });
  it('anciennete affichee en annees et mois', () => {
    expect(seniority('2019-01-01', '2026-10-31').label).toBe('7 ans 9 mois');
  });
});

describe('solde de tout compte', () => {
  const base = {
    contractType: 'cdi', category: 'employe' as const, hireDate: '2019-01-01', exitDate: '2026-10-31',
    monthlySalary: 4000, averageMonthlyGross: 4200, leaveBalanceDays: 10, noticeWorked: false,
  };
  it('licenciement CDI, preavis non effectue : conges + preavis 2 mois + indemnite', () => {
    const r = computeSettlement({ ...base, reason: 'licenciement' });
    expect(r.leave.amount).toBe(1538.46);        // 10 x 4000/26
    expect(r.notice).toMatchObject({ months: 2, due: true, amount: 8000 });
    expect(r.severance.eligible).toBe(true);
    // 7,83 ans : 480 + 2,83 x 144 h, au taux 4200 / 191
    expect(r.severance.hours).toBeCloseTo(888, 0);
    expect(r.severance.amount).toBeCloseTo(888 * 4200 / 191, -1);
    expect(r.lines.map(l => l.code)).toEqual(['IND_CONGES', 'IND_PREAVIS', 'IND_LICENCIEMENT']);
  });
  it('faute grave : ni preavis ni indemnite, seulement les conges', () => {
    const r = computeSettlement({ ...base, reason: 'faute_grave' });
    expect(r.lines.map(l => l.code)).toEqual(['IND_CONGES']);
  });
  it('demission sans preavis : retenue d un mois', () => {
    const r = computeSettlement({ ...base, reason: 'demission', hireDate: '2023-06-01' });
    expect(r.lines.find(l => l.code === 'RET_PREAVIS')?.amount).toBe(4000);
    expect(r.totalDeductions).toBe(4000);
  });
  it('fin de CDD, conges anticipes : retenue', () => {
    const r = computeSettlement({ ...base, reason: 'fin_cdd', contractType: 'cdd', leaveBalanceDays: -2 });
    expect(r.lines).toEqual([expect.objectContaining({ code: 'RET_CONGES', amount: 307.69 })]);
  });
  it('dommages-interets plafonnes a 1,5 mois par annee', () => {
    const r = computeSettlement({ ...base, reason: 'licenciement', hireDate: '2024-10-31', damagesMonths: 10 });
    expect(r.damages.months).toBeCloseTo(3, 1);  // 2 ans x 1,5
  });
});

import { amountInWords, numberToFrench } from '../services/hr-documents-pdf.service.js';
describe('montant en lettres (recu)', () => {
  it('regles du francais', () => {
    expect(numberToFrench(21)).toBe('vingt-et-un');
    expect(numberToFrench(71)).toBe('soixante-et-onze');
    expect(numberToFrench(80)).toBe('quatre-vingts');
    expect(numberToFrench(91)).toBe('quatre-vingt-onze');
    expect(numberToFrench(200)).toBe('deux cents');
    expect(numberToFrench(1000)).toBe('mille');
    expect(numberToFrench(200000)).toBe('deux cent mille');
    expect(numberToFrench(2_500_000)).toBe('deux millions cinq cent mille');
  });
  it('dirhams et centimes', () => {
    expect(amountInWords(1234.5)).toBe('mille deux cent trente-quatre dirhams et cinquante centimes');
    expect(amountInWords(1)).toBe('un dirham');
  });
});
