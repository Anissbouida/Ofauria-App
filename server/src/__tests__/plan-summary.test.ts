/**
 * M8-05 — synthèse chiffrée de l'ordre calculée au serveur (auparavant dans le navigateur) :
 * quantités hors articles annulés, rendement moyen et seuil, pertes, coût par pièce.
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('../config/database.js', () => ({ db: { query: vi.fn() } }));
vi.mock('../services/policies.js', () => ({ policyNumber: vi.fn() }));
import { summarize } from '../repositories/plan-summary.repository.js';

const item = (status: string, planned: number, actual: number | null, has_yield = false) =>
  ({ status, planned_quantity: planned, actual_quantity: actual, has_yield });

describe('Synthèse de l\'ordre (M8-05)', () => {
  it('quantités, rendement, pertes et coût par pièce', () => {
    const s = summarize(
      [item('produced', 10, 9, true), item('produced', 20, 20, false), item('cancelled', 5, null)],
      [{ rendement_reel: '88.0', seuil_rendement: '90', pertes_total: '1.5', vers_frigo: '2' }],
      { cout_total: '145.00', ecart_pct: '3.2' }, 85);
    expect(s.quantities).toEqual({ planned: 30, done: 29, donePct: 97, activeItems: 2, producedItems: 2 });
    expect(s.yield).toMatchObject({ average: 88, recorded: 1, missing: 1, threshold: 90, belowThreshold: true, lossesTotal: 1.5, toFridgeTotal: 2 });
    expect(s.cost).toEqual({ total: 145, unitBase: 29, perUnit: 5, variancePct: 3.2 });
  });
  it('sans seuil sur les articles : politique « Rendement cible » ; sans coût : null', () => {
    const s = summarize([item('in_progress', 10, null)], [{ rendement_reel: 95, seuil_rendement: null, pertes_total: 0, vers_frigo: 0 }], null, 90);
    expect(s.yield).toMatchObject({ average: 95, threshold: 90, belowThreshold: false });
    expect(s.cost).toEqual({ total: null, unitBase: 10, perUnit: null, variancePct: null });
  });
  it('aucun rendement saisi', () => {
    const s = summarize([item('produced', 4, 4)], [], null, null);
    expect(s.yield).toMatchObject({ average: null, recorded: 0, missing: 1, threshold: null, belowThreshold: false });
  });
});
