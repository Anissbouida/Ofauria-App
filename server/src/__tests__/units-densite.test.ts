import { describe, it, expect } from 'vitest';
import { convertQuantity, toBaseUnit, isCrossTypeConversion } from '../utils/units.js';

// Conversions poids <-> volume par masse volumique (miroir TS de fn_unit_conv
// 3 args, migration 227). Densite en kg/L == g/ml.

describe('convertQuantity — même famille (comportement historique)', () => {
  it('g -> kg et ml -> l inchangés', () => {
    expect(convertQuantity(420, 'g', 'kg')).toEqual({ value: 0.42, uncertain: false });
    expect(convertQuantity(250, 'ml', 'l')).toEqual({ value: 0.25, uncertain: false });
  });

  it('unités comptables (pcs) : valeur telle quelle, sans incertitude', () => {
    expect(convertQuantity(3, 'pcs', 'kg')).toEqual({ value: 3, uncertain: false });
  });
});

describe('convertQuantity — poids <-> volume via densité', () => {
  it('kg de lait -> litres (densité 1.03)', () => {
    // 1.03 kg / 1.03 g/ml = 1000 ml = 1 l
    expect(convertQuantity(1.03, 'kg', 'l', 1.03).value).toBeCloseTo(1);
    expect(convertQuantity(1.03, 'kg', 'l', 1.03).uncertain).toBe(false);
  });

  it("g d'huile -> ml (densité 0.92)", () => {
    // 460 g / 0.92 g/ml = 500 ml
    expect(convertQuantity(460, 'g', 'ml', 0.92).value).toBeCloseTo(500);
  });

  it('litres de crème -> kg (densité 1.01)', () => {
    // 2 l = 2000 ml x 1.01 g/ml = 2020 g = 2.02 kg
    expect(convertQuantity(2, 'l', 'kg', 1.01).value).toBeCloseTo(2.02);
  });

  it("eau : densité 1 -> poids et volume équivalents", () => {
    expect(convertQuantity(1.5, 'kg', 'l', 1).value).toBeCloseTo(1.5);
  });

  it('sans densité : valeur telle quelle + uncertain', () => {
    expect(convertQuantity(1.2, 'kg', 'l')).toEqual({ value: 1.2, uncertain: true });
    expect(convertQuantity(1.2, 'kg', 'l', null)).toEqual({ value: 1.2, uncertain: true });
    expect(convertQuantity(1.2, 'kg', 'l', 0)).toEqual({ value: 1.2, uncertain: true });
  });
});

describe('toBaseUnit — compatibilité ascendante', () => {
  it('signature historique inchangée', () => {
    expect(toBaseUnit(420, 'g', 'kg')).toBeCloseTo(0.42);
    expect(toBaseUnit(1.2, 'kg', 'l')).toBeCloseTo(1.2); // cross sans densité : as-is
  });

  it('accepte la densité en 4e argument', () => {
    expect(toBaseUnit(1.03, 'kg', 'l', 1.03)).toBeCloseTo(1);
  });
});

describe('isCrossTypeConversion', () => {
  it('détecte poids <-> volume, pas le reste', () => {
    expect(isCrossTypeConversion('kg', 'l')).toBe(true);
    expect(isCrossTypeConversion('ml', 'g')).toBe(true);
    expect(isCrossTypeConversion('g', 'kg')).toBe(false);
    expect(isCrossTypeConversion('pcs', 'kg')).toBe(false);
  });
});
