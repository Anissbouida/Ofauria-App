/**
 * G0-15 — plan d'amortissement dégressif : prorata en mois la première année,
 * exercice de complément à la fin. Cas chiffrés à la main (base 120 000, 5 ans,
 * coefficient 2, taux dégressif 40 %).
 */
import { describe, it, expect } from 'vitest';

process.env.JWT_SECRET ||= 'test-secret-0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL ||= 'postgres://localhost:5432/kalum_test';
const { computeSchedule } = await import('../services/depreciation.service.js');

type Line = { year: number; month: number; amount: number };
const r2 = (n: number) => Math.round(n * 100) / 100;
const byYear = (lines: Line[]) => {
  const out = new Map<number, number>();
  for (const l of lines) out.set(l.year, r2((out.get(l.year) ?? 0) + l.amount));
  return [...out.entries()];
};
const plan = (date: string, years = 5, cost = 120000, residual = 0) =>
  computeSchedule({ acquisition_date: date, acquisition_cost: cost, residual_value: residual, duration_years: years, method: 'degressive' }) as Line[];

describe('Amortissement dégressif (G0-15)', () => {
  it('acquisition en janvier : 5 exercices, bascule vers le linéaire', () => {
    expect(byYear(plan('2026-01-10'))).toEqual([[2026, 48000], [2027, 28800], [2028, 17280], [2029, 12960], [2030, 12960]]);
  });

  it('acquisition en juillet : première annuité sur 6 mois, sixième exercice de complément', () => {
    const lines = plan('2026-07-01');
    expect(byYear(lines)).toEqual([[2026, 24000], [2027, 38400], [2028, 23040], [2029, 13824], [2030, 13824], [2031, 6912]]);
    expect(lines).toHaveLength(60);                       // la durée reste de 5 ans
    expect(lines[0]).toMatchObject({ year: 2026, month: 7, amount: 4000 });
    expect(lines[lines.length - 1]).toMatchObject({ year: 2031, month: 6 });
  });

  it('acquisition en décembre : un seul mois la première année', () => {
    const lines = plan('2026-12-15');
    expect(byYear(lines)[0]).toEqual([2026, 4000]);       // 120 000 × 40 % × 1/12
    expect(byYear(lines)).toHaveLength(6);
    expect(lines[lines.length - 1]).toMatchObject({ year: 2031, month: 11 });
  });

  it.each([[3, '2026-01-05'], [3, '2026-07-05'], [5, '2026-03-20'], [10, '2026-01-01'], [10, '2026-09-30']])(
    'durée %i ans, acquisition le %s : somme = base amortissable, durée respectée', (years, date) => {
      const lines = plan(date, years, 87654.32, 4321);
      expect(r2(lines.reduce((s, l) => s + l.amount, 0))).toBe(r2(87654.32 - 4321));
      expect(lines).toHaveLength(years * 12);
      const exercises = byYear(lines).length;
      expect(exercises).toBe(date.slice(5, 7) === '01' ? years : years + 1);
      expect(lines.every(l => l.amount >= 0)).toBe(true);
    });
});
