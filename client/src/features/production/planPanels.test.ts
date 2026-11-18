/**
 * M8-01 — registre des panneaux de l'ordre : conditions d'affichage.
 *  - rétro-planning (heure de vitrine) : seulement avec l'option « vitrine » et un ordre en cours ;
 *  - consommation et qualité : ordre confirmé, en cours ou terminé ;
 *  - étapes / rendement : masqués quand la fonction est coupée dans le paramétrage.
 */
import { describe, it, expect } from 'vitest';
import { visiblePanels, type PlanPanelCtx } from './planPanelRules';

const visible = (ctx: Partial<PlanPanelCtx>, tab: 'synthese' | 'production') =>
  visiblePanels(tab, { plan: {}, id: 'x', isChef: true, items: [], hasFeature: () => false, ...ctx } as PlanPanelCtx);

describe('Registre des panneaux de l\'ordre (M8-01)', () => {
  it('rétro-planning : option vitrine et ordre en cours', () => {
    expect(visible({ plan: { status: 'in_progress' }, hasFeature: k => k === 'vitrine' }, 'production')).toContain('retro-planning');
    expect(visible({ plan: { status: 'in_progress' } }, 'production')).not.toContain('retro-planning');
    expect(visible({ plan: { status: 'completed' }, hasFeature: () => true }, 'production')).not.toContain('retro-planning');
  });
  it('synthèse selon le statut', () => {
    expect(visible({ plan: { status: 'draft' } }, 'synthese')).toEqual(['custom-fields', 'history']);
    expect(visible({ plan: { status: 'completed', order_number: 'C-1' } }, 'synthese')).toEqual(['linked-order', 'consumption', 'custom-fields', 'history', 'quality']);
  });
  it('préparation et coûts', () => {
    expect(visible({ plan: { status: 'in_progress' }, activeBon: true } as never, 'preparation' as never)).toEqual(['bon-sortie', 'lot-traceability']);
    expect(visible({ plan: { status: 'confirmed' }, activeBon: false } as never, 'preparation' as never)).toEqual([]);
    expect(visible({ plan: { status: 'completed' }, productionSettings: { production_cost_enabled: false } } as never, 'couts' as never)).toEqual([]);
  });
  it('sous-traitance : ordre d\'un type « sous-traité » seulement (M9)', () => {
    expect(visible({ plan: { status: 'draft', order_type_is_subcontracting: true } }, 'synthese')).toEqual(['subcontract', 'custom-fields', 'history']);
    expect(visible({ plan: { status: 'draft' } }, 'synthese')).not.toContain('subcontract');
  });
  it('numéros de série : ligne d\'un article suivi par série (M9)', () => {
    expect(visible({ plan: { status: 'completed' }, items: [{ tracking_mode: 'serial' }] }, 'production')).toEqual(['serials', 'steps', 'yield']);
    expect(visible({ plan: { status: 'completed' }, items: [{ tracking_mode: 'lot' }] }, 'production')).not.toContain('serials');
  });
  it('alertes de l\'onglet Ingrédients', () => {
    const prep = (c: Partial<PlanPanelCtx>) => visible({ plan: { status: 'confirmed' }, ...c } as never, 'preparation' as never);
    expect(prep({ isMagasinier: true, warnings: ['Farine insuffisante'] })).toEqual(['stock-warnings']);
    expect(prep({ isMagasinier: false, warnings: ['Farine insuffisante'] })).toEqual([]);
    expect(prep({ hasTabs: true, needsCount: 0, bonNotNeeded: false })).toEqual(['no-needs']);
    expect(prep({ hasTabs: true, needsCount: 0, bonNotNeeded: true })).toEqual([]);
  });
  it('étapes et rendement selon le paramétrage', () => {
    expect(visible({ plan: { status: 'completed' } }, 'production')).toEqual(['steps', 'yield']);
    expect(visible({ plan: { status: 'completed' }, productionSettings: { production_steps_enabled: false, production_yield_enabled: false } }, 'production')).toEqual([]);
  });
});
