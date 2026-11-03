import { describe, it, expect } from 'vitest';
import { consolidate, transferEntries } from '../services/consolidation.rules.js';
import type { AccountBalance } from '../services/liasse.rules.js';

const B = (code: string, balance: number): AccountBalance => ({ code, label: code, balance });
/** Balances classes 1-5 équilibrées sur le résultat (Σ = résultat, convention débit − crédit). */
const store = (key: string, ges: AccountBalance[], bil: AccountBalance[]) => {
  const result = -ges.reduce((s, b) => s + b.balance, 0);
  const sum = bil.reduce((s, b) => s + b.balance, 0);
  return { key, label: key, ges, bil: [...bil, B('1111', result - sum)].filter(b => b.balance !== 0), prior: 0 };
};

describe('Consolidation multi-établissements (lot Bonus 17)', () => {
  it('écritures de transfert : liaison débitée chez le cédant, créditée chez le receveur', () => {
    const t = transferEntries({ amount: 300, accountCode: '5161', fromLabel: 'A', toLabel: 'B', label: 'Fonds de caisse' });
    expect(t.from.map(l => [l.code, l.debit, l.credit])).toEqual([['1811', 300, 0], ['5161', 0, 300]]);
    expect(t.to.map(l => [l.code, l.debit, l.credit])).toEqual([['5161', 300, 0], ['1811', 0, 300]]);
  });

  it('liaison éliminée, combiné = somme des établissements, contrôles verts', () => {
    // A vend 1 000 au comptant puis cède 300 de caisse à B ; B paie 400 de charges.
    const a = store('A', [B('7111', -1000)], [B('5161', 700), B('1811', 300)]);
    const b = store('B', [B('6131', 400)], [B('5161', -100), B('1811', -300)]);
    const r = consolidate([a, b]);
    expect(r.controls).toEqual([]);
    const [ca, cb] = r.columns;
    expect(ca).toMatchObject({ liaison: -300, result: 1000, ecart: 0 });
    expect(cb).toMatchObject({ liaison: 300, result: -400, ecart: 0 });
    expect(ca.total_actif).toBe(ca.total_passif);
    expect(r.eliminations.liaison).toBe(0);
    expect(r.combined).toMatchObject({ result: 600, liaison: 0, liaison_residual: 0 });
    expect(r.combined.total_actif).toBe(r.combined.total_passif);
    expect(r.combined.cpc.XIII).toBe(600);
    // Combinaison au niveau des comptes : la caisse créditrice de B (trésorerie passif chez lui)
    // se compense avec celle de A dans le combiné.
    expect(cb.passif.U3).toBe(100);
    expect(r.combined.actif.T3).toBe(600);
    expect(r.combined.passif.U3).toBe(0);
  });

  it('liaison passée d\'un seul côté : résidu signalé', () => {
    const a = store('A', [B('7111', -1000)], [B('5161', 700), B('1811', 300)]);
    const b = store('B', [], [B('5161', 50)]);
    const r = consolidate([a, b]);
    expect(r.combined.liaison_residual).toBe(-300);
    expect(r.controls.map(c => c.message).join(' ')).toMatch(/liaison non soldés/);
  });
});
