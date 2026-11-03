import { describe, it, expect } from 'vitest';
import { availability, controlRequest, type AccountPosition } from '../services/budget-control.rules.js';
import { discountLines, unpaidBankLines } from '../repositories/bill-portfolio.repository.js';

const pos = (over: Partial<AccountPosition> = {}): AccountPosition => ({
  account_id: 'a', code: '6131', label: 'Locations', budget: Array(12).fill(100), actual: [80, 120, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0], committed: 150, ...over,
});
const balance = (lines: { debit: number; credit: number }[]) => Math.round(lines.reduce((s, l) => s + l.debit - l.credit, 0) * 100) / 100;

describe('Contrôle budgétaire (lot Bonus 15)', () => {
  it('disponible annuel et cumulé à fin de mois', () => {
    expect(availability(pos(), 'annual', 3)).toEqual({ budget: 1200, actual: 300, committed: 150, available: 750 });
    expect(availability(pos(), 'cumulative', 3)).toEqual({ budget: 300, actual: 300, committed: 150, available: -150 });
    expect(availability(pos(), 'cumulative', 14).budget).toBe(1200);
  });

  it('verdict : action du budget seulement si un compte budgété est dépassé', () => {
    const positions = [pos(), pos({ account_id: 'b', code: '6142', budget: Array(12).fill(10), actual: Array(12).fill(0), committed: 0 })];
    const ok = controlRequest({ action: 'block', period: 'annual', month: 3, positions, request: new Map([['a', 750], ['b', 120]]) });
    expect(ok.outcome).toBe('ok');
    expect(ok.lines.map(l => l.exceeded)).toEqual([0, 0]);
    const warn = controlRequest({ action: 'warn', period: 'annual', month: 3, positions, request: new Map([['a', 800]]) });
    expect(warn.outcome).toBe('warn');
    expect(warn.lines).toEqual([expect.objectContaining({ code: '6131', available: 750, request: 800, exceeded: 50 })]);
    // Disponible déjà négatif : toute la demande dépasse.
    const block = controlRequest({ action: 'block', period: 'cumulative', month: 3, positions, request: new Map([['a', 40]]) });
    expect(block).toMatchObject({ outcome: 'block', lines: [{ available: -150, exceeded: 40 }] });
    // Compte hors budget : pas contrôlé ; action « aucune » : jamais bloquant.
    expect(controlRequest({ action: 'block', period: 'annual', month: 3, positions, request: new Map([['zz', 1e6]]) }).outcome).toBe('ok');
    expect(controlRequest({ action: 'none', period: 'annual', month: 3, positions, request: new Map([['a', 1e6]]) }).outcome).toBe('ok');
  });
});

describe('Portefeuille d\'effets (lot Bonus 15)', () => {
  it('escompte : banque nette + agios + commissions + TVA = crédit d\'escompte au nominal', () => {
    const lines = discountLines({ gross: 2200, interest: 30, commission: 10, commissionVat: 2, bankCode: '5141', number: 'BRE-2024-0001' });
    expect(lines.map(l => [l.code, l.debit, l.credit])).toEqual([
      ['5141', 2158, 0], ['6311', 30, 0], ['6147', 10, 0], ['34552', 2, 0], ['5520', 0, 2200],
    ]);
    expect(balance(lines)).toBe(0);
  });

  it('impayé : reprise du crédit d\'escompte et frais sur la banque', () => {
    const d = unpaidBankLines({ amount: 1200, discounted: true, fees: 15, bankCode: '5141', ref: 'LCR-2' });
    expect(d.map(l => [l.code, l.debit, l.credit])).toEqual([['5520', 1200, 0], ['6147', 15, 0], ['5141', 0, 1215]]);
    expect(balance(d)).toBe(0);
    expect(unpaidBankLines({ amount: 500, discounted: false, fees: 8, bankCode: '5146', ref: 'X' }).map(l => [l.code, l.debit, l.credit]))
      .toEqual([['6147', 8, 0], ['5146', 0, 8]]);
    expect(unpaidBankLines({ amount: 500, discounted: false, fees: 0, bankCode: '5141', ref: 'X' })).toEqual([]);
  });
});
