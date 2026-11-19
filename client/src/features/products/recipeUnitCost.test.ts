import { describe, it, expect } from 'vitest';
import { recipeUnitCost, recipeYieldPerBatch, recipeYieldLabel } from './recipeUnitCost';

// Fiche « Cornes de gazelle » du scénario 1 : plaque de 60 pièces, 155,10 DH, 2,10 kg.
const cornes = { total_cost: '155.10', total_weight_kg: '2.1', rendement: 60, yield_quantity: '1.000', compo_par_piece: false };

describe('recipeUnitCost', () => {
  it('ramène le coût de la fournée à la pièce avec le rendement du format', () => {
    expect(recipeYieldPerBatch(cornes)).toBe(60);
    expect(recipeUnitCost(cornes, 'unit')).toBeCloseTo(2.585, 3);
  });

  it('donne le coût au kilo pour une vente au poids', () => {
    expect(recipeUnitCost(cornes, 'weight')).toBeCloseTo(73.857, 3);
  });

  it('prend le poids du format par défaut quand le poids total vaut 0 (fiche par format)', () => {
    const parFormat = { ...cornes, total_weight_kg: '0', default_format_weight_kg: '2.165' };
    expect(recipeUnitCost(parFormat, 'weight')).toBeCloseTo(71.640, 3);
  });

  it('retombe sur la pièce si le poids de la fournée est inconnu', () => {
    expect(recipeUnitCost({ ...cornes, total_weight_kg: null }, 'weight')).toBeCloseTo(2.585, 3);
  });

  it('ne divise pas une fiche saisie par pièce', () => {
    expect(recipeUnitCost({ ...cornes, compo_par_piece: true }, 'unit')).toBeCloseTo(155.1, 3);
  });

  it('garde yield_quantity pour une fiche sans format', () => {
    expect(recipeUnitCost({ total_cost: 40, yield_quantity: 20 }, 'unit')).toBe(2);
    expect(recipeUnitCost({ total_cost: 40 }, 'unit')).toBe(40);
  });

  it('renvoie 0 sans coût', () => {
    expect(recipeUnitCost({ total_cost: null, rendement: 60 })).toBe(0);
  });
});

// Mig 613 : rendement du format déclaré en kilos (plaque de cornes = 2 kg vendables).
describe('rendement en kg', () => {
  const enKg = { ...cornes, rendement_unite: 'kg', rendement_kg: '2.000', default_format_weight_kg: '2.165' };

  it('prend le rendement en kg, prioritaire sur le poids brut, pour une vente au poids', () => {
    expect(recipeUnitCost(enKg, 'weight')).toBeCloseTo(77.55, 2);
  });

  it('accepte un rendement inférieur à 1 kg', () => {
    expect(recipeUnitCost({ total_cost: 30, rendement_unite: 'kg', rendement_kg: 0.5 }, 'weight')).toBe(60);
  });

  it('garde les pièces pour une vente à la pièce', () => {
    expect(recipeUnitCost(enKg, 'unit')).toBeCloseTo(2.585, 3);
  });

  it('ignore le kg d\'une fiche saisie par pièce', () => {
    expect(recipeUnitCost({ ...enKg, compo_par_piece: true }, 'weight')).toBeCloseTo(155.1 / 2.165, 3);
  });

  it('affiche le rendement dans son unité', () => {
    expect(recipeYieldLabel(enKg)).toBe('2 kg');
    expect(recipeYieldLabel({ ...enKg, rendement_kg: '2.1' })).toBe('2,1 kg');
    expect(recipeYieldLabel(cornes)).toBe('60 unites');
  });
});
