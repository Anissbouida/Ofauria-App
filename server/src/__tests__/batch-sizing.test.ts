/**
 * Dimensionnement en fournées (mig 662, audit production pâtissière 2026-11 C-04).
 * Les scénarios chiffrés viennent du cahier des charges.
 */
import { describe, it, expect } from 'vitest';
import { sizeBatches, formatYieldPerBatch } from '@ofauria/shared';

describe('sizeBatches', () => {
  it('opéra : 130 tranches, cadre de 48, fournées entières → 3 cadres, 144, +14', () => {
    expect(sizeBatches({ requested: 130, yieldPerBatch: 48, rule: 'entier' }))
      .toEqual({ batches: 3, planned: 144, surplus: 14, adjusted: true, overMax: false });
  });

  it('opéra en fabrication partielle : 2,708 cadres, quantité inchangée', () => {
    const r = sizeBatches({ requested: 130, yieldPerBatch: 48, rule: 'partiel' });
    expect(r.batches).toBeCloseTo(2.708, 3);
    expect(r.planned).toBe(130);
    expect(r.surplus).toBe(0);
    expect(r.adjusted).toBe(false);
  });

  it('quantité déjà multiple de la fournée : rien à ajuster', () => {
    expect(sizeBatches({ requested: 96, yieldPerBatch: 48, rule: 'entier' }))
      .toEqual({ batches: 2, planned: 96, surplus: 0, adjusted: false, overMax: false });
  });

  it('cookies : 250 pièces, lot de 60 → 5 lots, 300, +50', () => {
    const r = sizeBatches({ requested: 250, yieldPerBatch: 60, rule: 'entier' });
    expect(r).toMatchObject({ batches: 5, planned: 300, surplus: 50 });
  });

  it('crème au kilo : 7,2 kg, fournée de 2,9 kg → 3 fournées, 8,7 kg (et non 8 kg)', () => {
    const r = sizeBatches({ requested: 7.2, yieldPerBatch: 2.9, rule: 'entier' });
    expect(r.batches).toBe(3);
    expect(r.planned).toBeCloseTo(8.7, 3);
    expect(r.surplus).toBeCloseTo(1.5, 3);
  });

  it('virgule flottante : 8,7 kg ÷ 2,9 kg font 3 fournées, pas 4', () => {
    expect(sizeBatches({ requested: 8.7, yieldPerBatch: 2.9, rule: 'entier' }).batches).toBe(3);
  });

  it('minimum de fournées : relève la quantité', () => {
    expect(sizeBatches({ requested: 20, yieldPerBatch: 48, rule: 'entier', min: 2 }))
      .toMatchObject({ batches: 2, planned: 96, surplus: 76, adjusted: true });
    // En partiel aussi : une demi-fournée minimum.
    expect(sizeBatches({ requested: 10, yieldPerBatch: 48, rule: 'partiel', min: 0.5 }))
      .toMatchObject({ batches: 0.5, planned: 24, surplus: 14 });
  });

  it('maximum de fournées : signalé, jamais écrêté', () => {
    const r = sizeBatches({ requested: 500, yieldPerBatch: 48, rule: 'entier', max: 6 });
    expect(r.batches).toBe(11);
    expect(r.planned).toBe(528);
    expect(r.overMax).toBe(true);
  });

  it('entrées dégénérées : aucune division par zéro, aucun NaN', () => {
    expect(sizeBatches({ requested: 0, yieldPerBatch: 48, rule: 'entier' }).planned).toBe(0);
    const r = sizeBatches({ requested: 10, yieldPerBatch: 0, rule: 'entier' });
    expect(r).toEqual({ batches: 0, planned: 10, surplus: 0, adjusted: false, overMax: false });
  });
});

describe('formatYieldPerBatch', () => {
  it('kilos pour un format au kilo, pièces sinon', () => {
    expect(formatYieldPerBatch({ rendement_unite: 'kg', rendement_kg: '2.900', nb_par_defaut: 5 })).toBe(2.9);
    expect(formatYieldPerBatch({ rendement_unite: 'unit', rendement_kg: null, nb_par_defaut: 48 })).toBe(48);
    expect(formatYieldPerBatch({ rendement_unite: 'unit', nb_par_defaut: null })).toBe(0);
  });
});
