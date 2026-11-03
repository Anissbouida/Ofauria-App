import { describe, it, expect } from 'vitest';
import { remainingOf, deliverableOf, fulfilmentStatus } from '../services/order-fulfilment.js';

describe('Exécution des commandes (O2C L2)', () => {
  const l = (quantity: number, qty_delivered = 0, qty_cancelled = 0) => ({ quantity, qty_delivered, qty_cancelled });
  it('reste à livrer et plafond avec tolérance', () => {
    expect(remainingOf(l(10, 6))).toBe(4);
    expect(remainingOf(l(10, 6, 4))).toBe(0);
    expect(remainingOf(l(10, 12))).toBe(0);
    expect(deliverableOf(l(10, 6), 0)).toBe(4);
    expect(deliverableOf(l(10, 6), 10)).toBe(5);
    expect(deliverableOf(l(3, 0), 5)).toBe(3.15);
  });
  it('statut déduit des lignes', () => {
    expect(fulfilmentStatus([l(10), l(5)])).toBe('ready');
    expect(fulfilmentStatus([l(10, 6), l(5)])).toBe('partially_delivered');
    expect(fulfilmentStatus([l(10, 10), l(5, 2, 3)])).toBe('completed');
    expect(fulfilmentStatus([l(10, 11), l(5, 5)])).toBe('completed');
  });
});
