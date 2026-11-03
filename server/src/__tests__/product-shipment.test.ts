import { describe, it, expect } from 'vitest';
import { allocateFefo } from '../services/product-shipment.js';

describe('Expédition FEFO (O2C L1)', () => {
  const lots = [
    { id: 'A', backroom_qty: 5, vitrine_qty: 1, dlc: '2026-11-04' },
    { id: 'B', backroom_qty: 10, vitrine_qty: 0, dlc: '2026-11-06' },
    { id: 'C', backroom_qty: 0, vitrine_qty: 4, dlc: '2026-11-05' },
  ];
  it('réserve d\'abord dans l\'ordre des DLC, vitrine ensuite', () => {
    expect(allocateFefo(lots, 12)).toEqual({
      steps: [{ lotId: 'A', qty: 5, source: 'backroom', dlc: '2026-11-04' }, { lotId: 'B', qty: 7, source: 'backroom', dlc: '2026-11-06' }],
      missing: 0,
    });
    expect(allocateFefo(lots, 17).steps.slice(2)).toEqual([
      { lotId: 'A', qty: 1, source: 'vitrine', dlc: '2026-11-04' }, { lotId: 'C', qty: 1, source: 'vitrine', dlc: '2026-11-05' },
    ]);
  });
  it('reliquat non couvert et quantités décimales', () => {
    expect(allocateFefo(lots, 25).missing).toBe(5);
    expect(allocateFefo([{ id: 'P', backroom_qty: 1.25, vitrine_qty: 0, dlc: null }], 1.5)).toEqual({
      steps: [{ lotId: 'P', qty: 1.25, source: 'backroom', dlc: null }], missing: 0.25,
    });
    expect(allocateFefo(lots, 0)).toEqual({ steps: [], missing: 0 });
  });
});
