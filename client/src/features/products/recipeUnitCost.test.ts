import { describe, it, expect } from 'vitest';
import { recipeUnitCost, recipeYieldPerBatch, recipeYieldLabel, recipeSalePricing } from './recipeUnitCost';

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

// Mig 614 (constat 29) : le produit reprend le coût complet et le prix de sa fiche.
describe('recipeSalePricing', () => {
  // Baguette : fiche 0,877 DH de coût complet, 3,00 DH de prix arrondi ; 6,745 DH/kg, 23,50 DH/kg.
  const baguette = {
    total_cost: '91.5', rendement: 120, margin_multiplier: '3',
    sale_cout_piece: '0.876875', sale_prix_piece: '3.0', sale_cout_kg: '6.745', sale_prix_kg: '23.5',
  };

  it('à la pièce : coût complet et prix de la fiche, pas la matière seule', () => {
    expect(recipeSalePricing(baguette, 'unit')).toEqual({ cost: 0.876875, price: 3, fromFiche: true });
  });

  it('au poids : valeurs au kilo de la fiche', () => {
    expect(recipeSalePricing(baguette, 'weight')).toMatchObject({ cost: 6.745, price: 23.5, fromFiche: true });
  });

  it('porte le prix HT de la fiche en TTC quand la base est TTC', () => {
    expect(recipeSalePricing(baguette, 'unit', { ratePct: 20, priceIncludesTax: true }).price).toBeCloseTo(3.6, 6);
    expect(recipeSalePricing(baguette, 'unit', { ratePct: 20, priceIncludesTax: false }).price).toBe(3);
  });

  it('repli matière × multiplicateur pour une fiche sans format', () => {
    expect(recipeSalePricing({ total_cost: 40, yield_quantity: 20, margin_multiplier: 2.5 }, 'unit'))
      .toEqual({ cost: 2, price: 5, fromFiche: false });
  });

  it('repli quand le poids de la fournée est inconnu (prix au kilo absent)', () => {
    const r = recipeSalePricing({ ...baguette, sale_cout_kg: null, sale_prix_kg: null }, 'weight');
    expect(r.fromFiche).toBe(false);
  });
});
