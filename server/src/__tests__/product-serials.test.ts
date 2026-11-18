/**
 * M9 — numéros de série : saisis d'abord, puis « lot-0001… » ; quantité entière ; doublons refusés.
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('../config/database.js', () => ({ db: { query: vi.fn() } }));
import { planSerials } from '../repositories/product-serial.repository.js';

describe('Numéros de série (M9)', () => {
  it('numérotation d\'après le lot, après les numéros saisis', () => {
    expect(planSerials('LOT-261118-001', 3, [])).toEqual(['LOT-261118-001-0001', 'LOT-261118-001-0002', 'LOT-261118-001-0003']);
    expect(planSerials('L1', 3, [], ['SN-A'])).toEqual(['SN-A', 'L1-0001', 'L1-0002']);
  });
  it('complète un lot déjà en partie numéroté, sans réutiliser un numéro', () => {
    expect(planSerials('L1', 3, ['L1-0001'])).toEqual(['L1-0002', 'L1-0003']);
    expect(planSerials('L1', 2, ['L1-0001', 'L1-0002'])).toEqual([]);
  });
  it('refus : quantité décimale, doublon, trop de numéros', () => {
    expect(() => planSerials('L1', 2.5, [])).toThrow(/entière/);
    expect(() => planSerials('L1', 3, [], ['A', 'A'])).toThrow(/double/);
    expect(() => planSerials('L1', 1, [], ['A', 'B'])).toThrow(/2 numéros saisis pour 1/);
  });
});
