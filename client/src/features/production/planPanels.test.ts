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
  it('étapes et rendement selon le paramétrage', () => {
    expect(visible({ plan: { status: 'completed' } }, 'production')).toEqual(['steps', 'yield']);
    expect(visible({ plan: { status: 'completed' }, productionSettings: { production_steps_enabled: false, production_yield_enabled: false } }, 'production')).toEqual([]);
  });
});
