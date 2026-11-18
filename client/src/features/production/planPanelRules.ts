/**
 * Conditions d'affichage des panneaux de l'ordre de fabrication (M8-01), séparées du rendu
 * (planPanels.tsx) pour être testées sans navigateur. Ordre du tableau = ordre d'affichage.
 */
export type PlanPanelCtx = {
  plan: Record<string, any>; id: string; isChef: boolean; items: Record<string, any>[];
  productionSettings?: Record<string, any> | null; hasFeature: (k: string) => boolean;
};
export type PanelTab = 'synthese' | 'production';

const started = (c: PlanPanelCtx) => ['in_progress', 'completed', 'confirmed'].includes(c.plan.status as string);

export const PLAN_PANEL_RULES: { id: string; tab: PanelTab; when: (c: PlanPanelCtx) => boolean }[] = [
  { id: 'linked-order', tab: 'synthese', when: c => !!c.plan.order_number },
  { id: 'consumption', tab: 'synthese', when: started },
  { id: 'custom-fields', tab: 'synthese', when: () => true },
  { id: 'history', tab: 'synthese', when: () => true },
  { id: 'quality', tab: 'synthese', when: started },
  // Rétro-planning calé sur l'heure de mise en vitrine : option « vitrine » (boulangerie).
  { id: 'retro-planning', tab: 'production', when: c => c.plan.status === 'in_progress' && c.hasFeature('vitrine') },
  { id: 'steps', tab: 'production', when: c => c.productionSettings?.production_steps_enabled !== false },
  { id: 'yield', tab: 'production', when: c => c.productionSettings?.production_yield_enabled !== false },
];

export const visiblePanels = (tab: PanelTab, c: PlanPanelCtx) => PLAN_PANEL_RULES.filter(p => p.tab === tab && p.when(c)).map(p => p.id);
