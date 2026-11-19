import type { ReactNode } from 'react';
import { PlanLinkedOrder, PlanLotTraceability } from './plan-sections';
import { BonSortiePanel } from './BonSortiePanel';
import CoutReelPanel from './CoutReelPanel';
import ConsumptionPanel from './ConsumptionPanel';
import CustomFieldsCard from '../../components/custom-fields/CustomFieldsCard';
import HistoryPanel from '../../components/audit/HistoryPanel';
import QualityPanel from '../controle/QualityPanel';
import RetroPlanningPanel from './RetroPlanningPanel';
import EtapesPanel from './EtapesPanel';
import RendementPanel from './RendementPanel';
import SubcontractPanel from './SubcontractPanel';
import SerialsPanel from './SerialsPanel';
import PlanObservationsPanel, { type PlanObservation } from './PlanObservationsPanel';
import { AlertTriangle } from 'lucide-react';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { visiblePanels, type PanelTab, type PlanPanelCtx } from './planPanelRules';

/**
 * Registre des panneaux de l'ordre de fabrication (M8-01) : rendu de chaque panneau ; la
 * condition d'affichage et l'ordre sont dans planPanelRules.ts. Ajouter un panneau = une
 * règle + un rendu.
 */
const RENDER: Record<string, (c: PlanPanelCtx) => ReactNode> = {
  'bon-sortie': c => <div><BonSortiePanel planId={c.id} isChef={c.isChef} isMagasinier={!!c.isMagasinier} variant="inline" /></div>,
  'stock-warnings': c => (
    <div>
      <StatusBanner tone="warning" icon={AlertTriangle} title={`Alertes (${c.warnings!.length})`}>
        <ul className="status-banner-list">{[...new Set(c.warnings)].map((w, i) => <li key={i}>{w}</li>)}</ul>
      </StatusBanner>
    </div>
  ),
  'no-needs': c => (
    <div>
      <StatusBanner tone="warning" icon={AlertTriangle} title="Aucun besoin en ingrédients calculé — préparation bloquée">
        Les produits de ce plan n'ont pas de {c.recipeLc ?? 'recette'} (ou leur composition est vide) : aucun bon de sortie
        ne peut être généré et l'étape Production reste fermée.
        {c.isChef && ` Ajoutez une ${c.recipeLc ?? 'recette'} aux produits concernés, puis utilisez « Relancer » pour recalculer les besoins (ou revenez en brouillon pour retirer le produit).`}
      </StatusBanner>
    </div>
  ),
  'lot-traceability': c => <PlanLotTraceability usage={c.lotUsage ?? []} />,
  cost: c => <CoutReelPanel planId={c.id} planStatus={c.plan.status} isChef={c.isChef}
    totalQuantity={c.summary?.cost.unitBase} perUnit={c.summary?.cost.perUnit ?? null} />,
  subcontract: c => <SubcontractPanel planId={c.id} planStatus={c.plan.status as string} canEdit={c.isChef} />,
  'linked-order': c => <PlanLinkedOrder plan={c.plan} />,
  consumption: c => <ConsumptionPanel planId={c.id} mode={(c.plan.order_type_consumption_mode as string) ?? null} canEdit={c.isChef} />,
  'custom-fields': c => <div><CustomFieldsCard entity="production_order" id={c.id} /></div>,
  history: c => <HistoryPanel table="production_plans" id={c.id} />,
  quality: c => <QualityPanel filter={{ planId: c.id }} links={{ planId: c.id }} title={`Contrôle ${(c.plan.of_number as string) || 'ordre'}`} />,
  'retro-planning': c => <RetroPlanningPanel planId={c.id} planStatus={c.plan.status} isChef={c.isChef} workshop={c.plan.target_role as string | null} storeId={c.plan.store_id as string | null} />,
  serials: c => <SerialsPanel planId={c.id} />,
  steps: c => <EtapesPanel planId={c.id} planStatus={c.plan.status} isChef={c.isChef} />,
  yield: c => <div id="plan-rendement"><RendementPanel planId={c.id} planStatus={c.plan.status} items={c.items as never} isChef={c.isChef} workshop={c.plan.target_role as string | null} storeId={c.plan.store_id as string | null} /></div>,
  observations: c => <PlanObservationsPanel observations={c.plan.observations as PlanObservation[]} />,
};

/** `only` : sous-ensemble des panneaux de l'onglet, quand la page intercale d'autres blocs. */
export function PlanPanels({ tab, ctx, only }: { tab: PanelTab; ctx: PlanPanelCtx; only?: string[] }) {
  const ids = visiblePanels(tab, ctx).filter(id => !only || only.includes(id));
  return <>{ids.map(id => <div key={id} data-panel={id}>{RENDER[id]?.(ctx)}</div>)}</>;
}
