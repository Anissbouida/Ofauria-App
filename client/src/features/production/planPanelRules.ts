/**
 * Conditions d'affichage des panneaux de l'ordre de fabrication (M8-01), séparées du rendu
 * (planPanels.tsx) pour être testées sans navigateur. Ordre du tableau = ordre d'affichage.
 */
export type PlanPanelCtx = {
  plan: Record<string, any>; id: string; isChef: boolean; items: Record<string, any>[];
  productionSettings?: Record<string, any> | null; hasFeature: (k: string) => boolean;
  isMagasinier?: boolean; isSemiFini?: boolean; activeBon?: boolean; lotUsage?: Record<string, any>[];
  /** Onglet Ingrédients : alertes de disponibilité et besoins calculés. */
  warnings?: string[]; needsCount?: number; bonNotNeeded?: boolean; hasTabs?: boolean; recipeLc?: string;
  /** Synthèse chiffrée calculée au serveur (M8-05). */
  summary?: import('../../api/production.api').PlanSummary | null;
  /** Éléments masqués par Production › Paramétrage › Écrans (mig 591). */
  hidden?: Set<string>;
};
export type PanelTab = 'preparation' | 'synthese' | 'production' | 'couts';

const started = (c: PlanPanelCtx) => ['in_progress', 'completed', 'confirmed'].includes(c.plan.status as string);

export const PLAN_PANEL_RULES: { id: string; tab: PanelTab; when: (c: PlanPanelCtx) => boolean }[] = [
  // Bon de sortie : seulement quand l'ordre en a un (type d'ordre avec bon de sortie, M2-03).
  { id: 'bon-sortie', tab: 'preparation', when: c => !c.isSemiFini && !!c.activeBon },
  // Alertes de disponibilité : magasinier seulement (hors champ du chef).
  { id: 'stock-warnings', tab: 'preparation', when: c => !!c.isMagasinier && (c.warnings?.length ?? 0) > 0 },
  // Aucun besoin calculé (produits sans nomenclature) : préparation bloquée.
  { id: 'no-needs', tab: 'preparation', when: c => !!c.hasTabs && c.needsCount === 0 && !c.bonNotNeeded },
  { id: 'lot-traceability', tab: 'preparation', when: c => ['completed', 'in_progress'].includes(c.plan.status as string) },
  // M9 : sous-traitance, pour un ordre d'un type « sous-traité ».
  { id: 'subcontract', tab: 'synthese', when: c => !!c.plan.order_type_is_subcontracting },
  { id: 'linked-order', tab: 'synthese', when: c => !!c.plan.order_number },
  { id: 'consumption', tab: 'synthese', when: started },
  { id: 'custom-fields', tab: 'synthese', when: () => true },
  { id: 'history', tab: 'synthese', when: () => true },
  { id: 'quality', tab: 'synthese', when: started },
  // Rétro-planning calé sur l'heure de mise en vitrine : option « vitrine » (boulangerie).
  { id: 'retro-planning', tab: 'production', when: c => c.plan.status === 'in_progress' && c.hasFeature('vitrine') },
  // M9 : numéros de série, dès qu'une ligne suit un article par série.
  { id: 'serials', tab: 'production', when: c => c.items.some(it => it.tracking_mode === 'serial') },
  { id: 'steps', tab: 'production', when: c => c.productionSettings?.production_steps_enabled !== false },
  { id: 'yield', tab: 'production', when: c => c.productionSettings?.production_yield_enabled !== false },
  // G0-24 : observations et bases saisies au lancement, dès qu'une déclaration en porte.
  { id: 'observations', tab: 'production', when: c => Array.isArray(c.plan.observations) && c.plan.observations.length > 0 },
  { id: 'cost', tab: 'couts', when: c => c.productionSettings?.production_cost_enabled !== false },
];

/** Règle du registre, puis masquage éventuel (Écrans de fabrication). */
export const visiblePanels = (tab: PanelTab, c: PlanPanelCtx) =>
  PLAN_PANEL_RULES.filter(p => p.tab === tab && p.when(c) && !c.hidden?.has(p.id)).map(p => p.id);
