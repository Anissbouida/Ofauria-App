import type { ReactNode } from 'react';
import { PlanLinkedOrder } from './plan-sections';
import ConsumptionPanel from './ConsumptionPanel';
import CustomFieldsCard from '../../components/custom-fields/CustomFieldsCard';
import HistoryPanel from '../../components/audit/HistoryPanel';
import QualityPanel from '../controle/QualityPanel';
import RetroPlanningPanel from './RetroPlanningPanel';
import EtapesPanel from './EtapesPanel';
import RendementPanel from './RendementPanel';
import { visiblePanels, type PanelTab, type PlanPanelCtx } from './planPanelRules';

/**
 * Registre des panneaux de l'ordre de fabrication (M8-01) : rendu de chaque panneau ; la
 * condition d'affichage et l'ordre sont dans planPanelRules.ts. Ajouter un panneau = une
 * règle + un rendu.
 */
const RENDER: Record<string, (c: PlanPanelCtx) => ReactNode> = {
  'linked-order': c => <PlanLinkedOrder plan={c.plan} />,
  consumption: c => <ConsumptionPanel planId={c.id} mode={(c.plan.order_type_consumption_mode as string) ?? null} canEdit={c.isChef} />,
  'custom-fields': c => <div style={{ margin: '1rem' }}><CustomFieldsCard entity="production_order" id={c.id} /></div>,
  history: c => <HistoryPanel table="production_plans" id={c.id} />,
  quality: c => <QualityPanel filter={{ planId: c.id }} links={{ planId: c.id }} title={`Contrôle ${(c.plan.of_number as string) || 'ordre'}`} />,
  'retro-planning': c => <RetroPlanningPanel planId={c.id} planStatus={c.plan.status} isChef={c.isChef} workshop={c.plan.target_role as string | null} storeId={c.plan.store_id as string | null} />,
  steps: c => <EtapesPanel planId={c.id} planStatus={c.plan.status} isChef={c.isChef} />,
  yield: c => <div id="plan-rendement"><RendementPanel planId={c.id} planStatus={c.plan.status} items={c.items as never} isChef={c.isChef} workshop={c.plan.target_role as string | null} storeId={c.plan.store_id as string | null} /></div>,
};

export function PlanPanels({ tab, ctx }: { tab: PanelTab; ctx: PlanPanelCtx }) {
  return <>{visiblePanels(tab, ctx).map(id => <div key={id} data-panel={id}>{RENDER[id]?.(ctx)}</div>)}</>;
}
