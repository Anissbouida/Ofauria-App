import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Check, ClipboardCheck, ClipboardList, ArrowLeftRight, PackageX, ScrollText, Settings, Store, BarChart3 } from 'lucide-react';
import { ROLE_GROUPS } from '@ofauria/shared';
import { useAuth } from '../../context/AuthContext';
import { reconciliationApi, type ReconDaySummary } from '../../api/reconciliation.api';
import { unsoldDecisionApi } from '../../api/unsold-decision.api';
import {
  FicheBesoinsView, DayView, CatalogView, ReportView, CarryOverSettingsView, SlotsSettingsView, DarijaSettingsView,
} from '../reconciliation/ReconciliationPage';
import OuvertureTab, { useOpeningToday, openingStatus } from './OuvertureTab';
import InvendusTab, { InvendusDashboard } from './InvendusTab';
import { ModuleShell, type ModuleView } from '../../components/layout/ModuleShell';
import VentesIndicators from './VentesIndicators';

/**
 * Journée boutique : un seul module pour le cycle quotidien de la vitrine,
 * qui réunit trois anciens écrans (Contrôle ouverture, Contrôle des ventes,
 * Invendus). La frise suit la journée : ouverture → appro & ventes → invendus
 * → clôture ; chaque étape ouvre son onglet.
 * Droits : module 'unsold' (caissières, vendeuses) pour Ouverture et Invendus ;
 * Appro & ventes, Rapports et Paramètres restent réservés au gérant (routes
 * /reconciliation en ADMIN_MANAGER).
 */

type Tab = 'ouverture' | 'ventes' | 'invendus' | 'rapports' | 'parametres';
/**
 * Écrans de la barre latérale (ModuleShell) : clé « onglet:vue » pour les onglets qui
 * ont des sous-vues. L'URL garde ?tab=&vue= : liens et notifications déjà émis valables.
 * La première vue de chaque onglet est celle qu'il ouvre sans ?vue=.
 */
const VIEWS: Array<Omit<ModuleView, 'hidden'> & { tab: Tab; vue?: string; manager?: boolean }> = [
  { key: 'ouverture', tab: 'ouverture', label: 'Ouverture', icon: ClipboardCheck, section: 'operations' },
  { key: 'ventes:journee', tab: 'ventes', vue: 'journee', label: 'Journée (shifts)', icon: ArrowLeftRight, section: 'operations', manager: true },
  { key: 'ventes:fiche', tab: 'ventes', vue: 'fiche', label: 'Fiche de besoin', icon: ClipboardList, section: 'operations', manager: true },
  { key: 'invendus', tab: 'invendus', label: 'Invendus', icon: PackageX, section: 'operations' },
  { key: 'rapports:ventes', tab: 'rapports', vue: 'ventes', label: 'Écarts de ventes', icon: ScrollText, section: 'reports', manager: true },
  { key: 'rapports:invendus', tab: 'rapports', vue: 'invendus', label: 'Invendus du mois', icon: BarChart3, section: 'reports', manager: true },
  { key: 'parametres:catalogue', tab: 'parametres', vue: 'catalogue', label: 'Catalogue Loyverse', icon: Store, section: 'setup', manager: true },
  { key: 'parametres:regles', tab: 'parametres', vue: 'regles', label: 'Report, créneaux et traductions', icon: Settings, section: 'setup', manager: true },
];

type Step = { key: string; label: string; detail: string; done: boolean; tab: Tab };

export default function JourneeBoutiquePage() {
  const { user } = useAuth();
  const role = user?.role as string | undefined;
  const isManager = !!role && (ROLE_GROUPS.ADMIN_MANAGER as string[]).includes(role);
  const canCount = !!role && (ROLE_GROUPS.CASH as string[]).includes(role);
  const todayIso = format(new Date(), 'yyyy-MM-dd');

  // ── Situation du jour (alimente la frise) ──
  const { data: opening } = useOpeningToday(canCount);
  const { data: reconDays = [] } = useQuery<ReconDaySummary[]>({
    queryKey: ['boutique-recon-today', todayIso],
    queryFn: () => reconciliationApi.listDays({ from: todayIso, to: todayIso }),
    enabled: isManager,
  });
  const { data: unsoldToday } = useQuery({
    queryKey: ['boutique-unsold-today', todayIso],
    queryFn: () => unsoldDecisionApi.list({ dateFrom: todayIso, dateTo: todayIso, limit: '1' }),
  });
  const reconDay = reconDays[0];
  const decisions: number = unsoldToday?.total ?? 0;

  const steps: Step[] = [];
  if (canCount) {
    const st = openingStatus(opening?.existingCheck);
    steps.push({ key: 'ouverture', label: 'Ouverture', detail: st.label, done: opening?.existingCheck?.status === 'validated', tab: 'ouverture' });
  }
  if (isManager) {
    const lines = Number(reconDay?.line_count ?? 0);
    steps.push({ key: 'ventes', label: 'Appro & ventes', detail: reconDay ? `${lines} produit${lines > 1 ? 's' : ''} suivis` : 'Journée à ouvrir', done: !!reconDay && lines > 0, tab: 'ventes' });
  }
  steps.push({ key: 'invendus', label: 'Invendus', detail: decisions > 0 ? `${decisions} décision${decisions > 1 ? 's' : ''}` : 'À décider le soir', done: decisions > 0, tab: 'invendus' });
  if (isManager) {
    steps.push({ key: 'cloture', label: 'Clôture', detail: reconDay?.status === 'closed' ? 'Journée clôturée' : 'Journée ouverte', done: reconDay?.status === 'closed', tab: 'ventes' });
  }
  const currentIdx = steps.findIndex(s => !s.done);

  // ── Écran : URL, sinon l'étape en cours ──
  const views: ModuleView[] = VIEWS.map(({ tab: _t, vue: _v, manager, ...v }) => ({ ...v, hidden: manager && !isManager }));
  const visible = VIEWS.filter(v => !v.manager || isManager);
  const [searchParams, setSearchParams] = useSearchParams();
  const fromUrl = searchParams.get('tab') as Tab | null;
  const fallback = steps[currentIdx]?.tab ?? 'invendus';
  const tab: Tab = fromUrl && visible.some(v => v.tab === fromUrl) ? fromUrl : fallback;
  const tabViews = visible.filter(v => v.tab === tab);
  const vue = tabViews.find(v => v.vue === searchParams.get('vue')) ?? tabViews[0];
  const go = (t: Tab, v?: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', t);
    if (v) next.set('vue', v); else next.delete('vue');
    setSearchParams(next);
  };
  const select = (key: string) => {
    const v = VIEWS.find(x => x.key === key);
    if (v) go(v.tab, v.vue);
  };
  const current = views.find(v => v.key === vue?.key);

  return (
    <ModuleShell title="Journée boutique" views={views} current={current} onSelect={select} flush
      actions={
        <span style={{ marginLeft: 'auto', fontSize: '0.8125rem', color: 'var(--theme-text-muted)', textTransform: 'capitalize' }}>
          {format(new Date(), 'EEEE d MMMM yyyy', { locale: fr })}
        </span>
      }>
      <ol className="ui-timeline" aria-label="Avancement de la journée">
        {steps.map((s, i) => (
          <li key={s.key} className={`ui-timeline-step ${s.done ? 'is-done' : ''} ${i === currentIdx ? 'is-current' : ''}`}>
            <button type="button" onClick={() => go(s.tab)} aria-current={i === currentIdx ? 'step' : undefined}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem', background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>
              <span className="ui-timeline-dot">{s.done ? <Check size={12} /> : i + 1}</span>
              <span className="ui-timeline-label">{s.label}</span>
              <span className="ui-timeline-detail">{s.detail}</span>
            </button>
          </li>
        ))}
      </ol>

      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {isManager && tab !== 'parametres' && (
          <VentesIndicators onManquants={() => go('rapports', 'ventes')} />
        )}
        {tab === 'ouverture' && <OuvertureTab />}
        {tab === 'invendus' && <InvendusTab />}
        {vue?.key === 'ventes:fiche' && <FicheBesoinsView onValidated={() => go('ventes', 'journee')} />}
        {vue?.key === 'ventes:journee' && <DayView />}
        {vue?.key === 'rapports:ventes' && <ReportView />}
        {vue?.key === 'rapports:invendus' && <InvendusDashboard />}
        {vue?.key === 'parametres:catalogue' && <CatalogView />}
        {vue?.key === 'parametres:regles' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            <CarryOverSettingsView />
            <SlotsSettingsView />
            <DarijaSettingsView />
          </div>
        )}
      </div>
    </ModuleShell>
  );
}
