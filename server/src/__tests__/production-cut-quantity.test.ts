/**
 * M8-05 — quantité produite d'une coupe : une seule formule pour le serveur et l'aperçu
 * de la fenêtre de lancement (shared/constants/production-cut.ts).
 */
import { describe, it, expect } from 'vitest';
import { cutProducedQuantity } from '@ofauria/shared';

describe('Coupe : quantité produite (M8-05)', () => {
  it('pièces + équivalences, sous-produits exclus, arrondi au millième', () => {
    expect(cutProducedQuantity([
      { quantity: 2, equiv: 1, outputType: 'principal' },
      { quantity: 8, equiv: 0.125, outputType: 'co_produit' },
      { quantity: 3, equiv: 1, outputType: 'sous_produit' },
      { quantity: 1, equiv: 1, outputType: 'dechet_valorise' },
    ])).toBe(3);
    expect(cutProducedQuantity([{ quantity: 1, equiv: 1 / 3 }])).toBe(0.333);
    expect(cutProducedQuantity([])).toBe(0);
  });
});
