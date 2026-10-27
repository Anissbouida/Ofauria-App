import { describe, expect, it } from 'vitest';
import { allocate } from '../repositories/landed-cost.repository.js';

/** Répartition des frais d'approche (mig 361) : prorata exact, arrondi absorbé par la dernière ligne. */
describe('frais d\'approche — allocate', () => {
  const lines = [
    { id: 'a', quantity: 200, value: 740 },   // farine 200 kg × 3,70
    { id: 'b', quantity: 50, value: 2900 },   // beurre 50 kg × 58
    { id: 'c', quantity: 10, value: 100 },
  ];

  it('répartit au prorata de la valeur et retombe exactement sur le total', () => {
    const out = allocate(lines, 300, 'value');
    expect(out.map(o => o.amount)).toEqual([59.36, 232.62, 8.02]);
    expect(out.reduce((s, o) => s + o.amount, 0)).toBeCloseTo(300, 2);
    expect(out[0].unitIncrement).toBeCloseTo(59.36 / 200, 6);
    expect(out[1].sharePct).toBeCloseTo((2900 / 3740) * 100, 3);
  });

  it('répartit au prorata de la quantité', () => {
    const out = allocate(lines, 260, 'quantity');
    expect(out.map(o => o.amount)).toEqual([200, 50, 10]);
    expect(out[2].unitIncrement).toBe(1);
  });

  it('absorbe l\'arrondi sur la dernière ligne', () => {
    const out = allocate([{ id: 'x', quantity: 3, value: 1 }, { id: 'y', quantity: 3, value: 1 }, { id: 'z', quantity: 3, value: 1 }], 100, 'value');
    expect(out.map(o => o.amount)).toEqual([33.33, 33.33, 33.34]);
  });

  it('ne répartit rien sans base', () => {
    expect(allocate([], 100, 'value')).toEqual([]);
    expect(allocate([{ id: 'a', quantity: 0, value: 0 }], 100, 'value')).toEqual([]);
  });

  it('accepte un montant négatif (correction)', () => {
    const out = allocate(lines, -74, 'quantity');
    expect(out.reduce((s, o) => s + o.amount, 0)).toBeCloseTo(-74, 2);
    expect(out[0].unitIncrement).toBeLessThan(0);
  });
});
