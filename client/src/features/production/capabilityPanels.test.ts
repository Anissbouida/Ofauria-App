/**
 * Étape 10 multi-industries — panneaux par capacité (10c) et ordre des sections par
 * définition d'écran (10b).
 */
import { describe, it, expect } from 'vitest';
import { applyScreenDefinition } from '@ofauria/shared';
import { capabilityPanel, CAPABILITY_PANELS } from './capabilityPanels';
import { visiblePanels, type PlanPanelCtx } from './planPanelRules';

describe('Panneaux par capacité (10c)', () => {
  it('sans « saisie par fournée », aucun panneau de pâte n\'est chargé', () => {
    expect(capabilityPanel('launch.temperature-base', () => false)).toBeNull();
  });
  it('avec la capacité, le panneau (chargé à la demande) est rendu', () => {
    expect(capabilityPanel('launch.temperature-base', k => k === 'mode_fournee')).toBe(CAPABILITY_PANELS['launch.temperature-base'].component);
  });
});

describe('Sections de la fiche par définition d\'écran (10b)', () => {
  const ctx = (definition?: PlanPanelCtx['definition']): PlanPanelCtx => ({
    plan: { status: 'in_progress' }, id: 'p', isChef: true, items: [], hasFeature: () => false, definition,
  });
  it('sans définition : ordre du registre', () => {
    expect(visiblePanels('synthese', ctx())).toEqual(['consumption', 'custom-fields', 'history', 'quality']);
  });
  it('deux sections réordonnées et une masquée, sans code', () => {
    const def = { sections: [{ key: 'history', visible: true, order: 1 }, { key: 'consumption', visible: true, order: 2 }, { key: 'quality', visible: false, order: 3 }] };
    expect(visiblePanels('synthese', ctx(def))).toEqual(['history', 'consumption', 'custom-fields']);
  });
  it('un élément verrouillé ne se masque pas', () => {
    expect(applyScreenDefinition('production.plan', 'sections', ['subcontract', 'history'], { sections: [{ key: 'subcontract', visible: false, order: 1 }] }))
      .toEqual(['subcontract', 'history']);
  });
});
