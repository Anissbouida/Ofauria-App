/**
 * G0-10 — la paie ne se génère que sur une période terminée ; dérogation
 * réservée à l'administrateur, qui rend le bulletin provisoire.
 */
import { describe, it, expect } from 'vitest';

process.env.JWT_SECRET ||= 'test-secret-0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL ||= 'postgres://localhost:5432/kalum_test';
const { checkPayrollPeriod, monthEnd, payrollToday } = await import('../services/payroll-period.js');

describe('Période de paie (G0-10)', () => {
  it('refuse la veille de la fin de mois, accepte le dernier jour et le lendemain', () => {
    const end = monthEnd(11, 2026);
    expect(end).toBe('2026-11-30');
    const before = checkPayrollPeriod(end, { today: '2026-11-29', label: 'Le mois' });
    expect(before).toMatchObject({ ok: false, status: 409, availableFrom: '2026-11-30' });
    expect(before.ok === false && before.message).toMatch(/Le mois n'est pas terminée? .*30\/11\/2026/);
    expect(checkPayrollPeriod(end, { today: '2026-11-30' })).toEqual({ ok: true, provisional: false });
    expect(checkPayrollPeriod(end, { today: '2026-12-01' })).toEqual({ ok: true, provisional: false });
  });

  it('la dérogation est réservée à l\'administrateur et rend le bulletin provisoire', () => {
    const end = '2026-11-30';
    expect(checkPayrollPeriod(end, { today: '2026-11-10', allowOpenPeriod: true, role: 'admin' })).toEqual({ ok: true, provisional: true });
    expect(checkPayrollPeriod(end, { today: '2026-11-10', allowOpenPeriod: true, role: 'manager' })).toMatchObject({ ok: false, status: 403 });
    // Période terminée : la dérogation ne rend rien provisoire.
    expect(checkPayrollPeriod(end, { today: '2026-12-05', allowOpenPeriod: true, role: 'admin' })).toEqual({ ok: true, provisional: false });
  });

  it('février bissextile et date du jour au format attendu', () => {
    expect(monthEnd(2, 2028)).toBe('2028-02-29');
    expect(payrollToday(new Date('2026-06-15T23:30:00Z'))).toBe('2026-06-16'); // 00:30 au Maroc (UTC+1)
    expect(payrollToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
