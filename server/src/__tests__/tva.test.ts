import { describe, it, expect } from 'vitest';
import { lineTvaAmount, headerTotalsFromLines } from '../utils/tva.js';

describe('lineTvaAmount', () => {
  it('renvoie null sans taux explicite', () => {
    expect(lineTvaAmount(100, null)).toBeNull();
    expect(lineTvaAmount(100, undefined)).toBeNull();
  });

  it('calcule et arrondit la TVA de la ligne', () => {
    expect(lineTvaAmount(100, 20)).toBe(20);
    expect(lineTvaAmount(100, 7)).toBe(7);
    expect(lineTvaAmount(33.33, 20)).toBe(6.67); // 6.666 -> 6.67
    expect(lineTvaAmount(100, 0)).toBe(0);
  });
});

describe('headerTotalsFromLines', () => {
  it('sans aucun taux : pas de TVA derivee (fallback en-tete)', () => {
    const r = headerTotalsFromLines([
      { subtotal: 100 },
      { subtotal: 50, tvaRate: null },
    ]);
    expect(r.amount).toBe(150);
    expect(r.hasPerLineTva).toBe(false);
    expect(r.taxAmount).toBeNull();
  });

  it('taux uniforme : TVA = HT * taux', () => {
    const r = headerTotalsFromLines([
      { subtotal: 200, tvaRate: 20 },
      { subtotal: 100, tvaRate: 20 },
    ]);
    expect(r.amount).toBe(300);
    expect(r.hasPerLineTva).toBe(true);
    expect(r.taxAmount).toBe(60);
  });

  it('taux mixtes : la TVA est la somme par ligne', () => {
    const r = headerTotalsFromLines([
      { subtotal: 100, tvaRate: 20 }, // 20
      { subtotal: 100, tvaRate: 10 }, // 10
      { subtotal: 100, tvaRate: 7 },  // 7
    ]);
    expect(r.amount).toBe(300);
    expect(r.hasPerLineTva).toBe(true);
    expect(r.taxAmount).toBe(37);
  });

  it('lignes partielles : une seule porte un taux, les autres comptent 0', () => {
    const r = headerTotalsFromLines([
      { subtotal: 100, tvaRate: 20 }, // 20
      { subtotal: 100, tvaRate: null }, // 0 (pas de taux)
    ]);
    expect(r.amount).toBe(200);
    expect(r.hasPerLineTva).toBe(true);
    expect(r.taxAmount).toBe(20);
  });

  it('arrondis : somme de TVA arrondies par ligne', () => {
    const r = headerTotalsFromLines([
      { subtotal: 33.33, tvaRate: 20 }, // 6.67
      { subtotal: 66.67, tvaRate: 20 }, // 13.33
    ]);
    expect(r.amount).toBe(100);
    expect(r.taxAmount).toBe(20); // 6.67 + 13.33
  });
});
