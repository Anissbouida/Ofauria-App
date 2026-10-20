import { describe, it, expect, vi } from 'vitest';

// Le service importe la base et le generateur : seule la fonction pure est testee.
vi.mock('../config/database.js', () => ({ db: {} }));
vi.mock('../repositories/accounting.repository.js', () => ({ paymentRepository: {} }));
vi.mock('../services/journal-generator.service.js', () => ({ persistEntry: vi.fn(), reverseEntriesForSource: vi.fn() }));

import { buildAccrualEntry, ACCRUAL_DETAIL } from '../services/payroll-ledger.service.js';

// Bulletin 8 000 DH (cf. payroll-engine.test) + pret retenu 300 DH.
const payroll = {
  id: 'p1', month: 10, year: 2026, first_name: 'A', last_name: 'B', store_id: null,
  gross_salary: '8000.00', total_charges_patron: '1507.60',
  cnss_employee: '268.80', amo_employee: '180.80', cimr_employee: '0',
  cnss_employer: '538.80', amo_employer: '328.80', cimr_employer: '0',
  alloc_familiales: '512.00', taxe_fp: '128.00', ir_net: '276.75',
  net_salary: '6973.65',
};

describe('buildAccrualEntry', () => {
  const e = buildAccrualEntry(payroll, [{ amount: '300', account_code: null, label: 'Pret' }])!;
  const line = (code: string) => e.lines.find(l => l.account_code === code);

  it('OD datee du dernier jour du mois, source bulletin', () => {
    expect(e.journal_code).toBe('OD');
    expect(e.entry_date).toBe('2026-10-31');
    expect(e.source_id).toBe('p1');
    expect(e.source_detail).toBe(ACCRUAL_DETAIL);
  });

  it('charges au debit, dettes au credit, equilibree', () => {
    expect(line('6171')?.debit).toBe(8000);
    expect(line('6174')?.debit).toBe(1507.6);
    expect(line('4441')?.credit).toBe(1957.2);   // 268,8 + 180,8 + 538,8 + 328,8 + 512 + 128
    expect(line('44525')?.credit).toBe(276.75);
    expect(line('3431')?.credit).toBe(300);
    expect(line('4432')?.credit).toBe(6973.65);
    expect(line('4443')).toBeUndefined();         // pas de CIMR : pas de ligne a zero
    const d = e.lines.reduce((s, l) => s + l.debit, 0);
    const c = e.lines.reduce((s, l) => s + l.credit, 0);
    expect(Math.round(d * 100)).toBe(Math.round(c * 100));
  });

  it('refuse un bulletin incoherent au-dela de l arrondi', () => {
    expect(() => buildAccrualEntry({ ...payroll, net_salary: '7000' }, [])).toThrow(/desequilibree/);
  });

  it('salarie non declare : brut = net, pas de dettes sociales', () => {
    const nd = buildAccrualEntry({ ...payroll, total_charges_patron: 0, cnss_employee: 0, amo_employee: 0, cnss_employer: 0,
      amo_employer: 0, alloc_familiales: 0, taxe_fp: 0, ir_net: 0, net_salary: '8000' }, [])!;
    expect(nd.lines.map(l => l.account_code).sort()).toEqual(['4432', '6171']);
  });

  it('IR negatif (trop-percu restitue a la regularisation) : debit 44525, equilibree', () => {
    // IR du mois 276,75, regularisation -400 -> ir_net -123,25 ; net + 400.
    const reg = buildAccrualEntry({ ...payroll, ir_net: '-123.25', net_salary: '7373.65' }, [{ amount: '300', account_code: null, label: 'Pret' }])!;
    const l = reg.lines.find(x => x.account_code === '44525')!;
    expect(l.debit).toBe(123.25);
    expect(l.credit).toBe(0);
    const d = reg.lines.reduce((s, x) => s + x.debit, 0);
    const c = reg.lines.reduce((s, x) => s + x.credit, 0);
    expect(Math.round(d * 100)).toBe(Math.round(c * 100));
  });
});
