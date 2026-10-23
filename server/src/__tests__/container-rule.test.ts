import { describe, it, expect } from 'vitest';
import { roundUpToContainer, roundUpForLot, strictContainerQty } from '../services/container-rule.js';

describe('règle contenant entier', () => {
  it('arrondit au contenant supérieur (8 kg en sacs de 2,5 → 4 sacs = 10 kg)', () => {
    expect(roundUpToContainer(8, 2.5)).toEqual({ qty: 10, count: 4 });
  });
  it('un besoin inférieur à un contenant = un contenant complet', () => {
    expect(roundUpToContainer(1, 2.5)).toEqual({ qty: 2.5, count: 1 });
  });
  it('un multiple exact ne change pas', () => {
    expect(roundUpToContainer(7.5, 2.5)).toEqual({ qty: 7.5, count: 3 });
    expect(roundUpToContainer(0.1 + 0.2, 0.3).count).toBe(1);
  });
  it('sans contenant défini, la quantité est inchangée', () => {
    expect(roundUpToContainer(8, 0)).toEqual({ qty: 8, count: 0 });
  });
  it('transfert à l\'avance strict : N sacs = N × taille, refus si le lot n\'a pas assez, reste entamé seulement en entier', () => {
    expect(strictContainerQty(6, 2, 10)).toMatchObject({ qty: 6, count: 3, ok: true });
    expect(strictContainerQty(4, 2, 1)).toMatchObject({ ok: false });
    expect(strictContainerQty(1, 2, 1)).toMatchObject({ qty: 1, count: 1, ok: true });
  });
  it('ouverture pendant la pesée : jamais au-delà du dernier contenant entamé', () => {
    expect(roundUpForLot(1, 2.5, 7)).toEqual({ qty: 2.5, count: 1 });
    expect(roundUpForLot(6, 2.5, 7)).toEqual({ qty: 7, count: 3 });
    expect(roundUpForLot(1, 2.5, 1.3)).toEqual({ qty: 1.3, count: 1 });
  });
});
