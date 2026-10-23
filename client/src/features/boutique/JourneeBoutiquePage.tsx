import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Check, ClipboardCheck, ArrowLeftRight, PackageX, ScrollText, Settings, Store } from 'lucide-react';
import { ROLE_GROUPS } from '@ofauria/shared';
import { useAuth } from '../../context/AuthContext';
import { reconciliationApi, type ReconDaySummary } from '../../api/reconciliation.api';
import { unsoldDecisionApi } from '../../api/unsold-decision.api';
import {
  FicheBesoinsView, DayView, CatalogView, ReportView, CarryOverSettingsView, SlotsSettingsView, DarijaSettingsView,
} from '../reconciliation/ReconciliationPage';
import OuvertureTab, { useOpeningToday, openingStatus } from './OuvertureTab';
import InvendusTab, { InvendusDashboard } from './InvendusTab';
import { SubSwitch } from './shared';
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
const TABS: Array<{ key: Tab; label: string; icon: typeof Store; manager?: boolean }> = [
  { key: 'ouverture', label: 'Ouverture', icon: ClipboardCheck },
  { key: 'ventes', label: 'Appro & ventes', icon: ArrowLeftRight, manager: true },
  { key: 'invendus', label: 'Invendus', icon: PackageX },
  { key: 'rapports', label: 'Rapports', icon: ScrollText, manager: true },
  { key: 'parametres', label: 'Paramètres', icon: Settings, manager: true },
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

  // ── Onglet : URL, sinon l'étape en cours ──
  const tabs = TABS.filter(t => !t.manager || isManager);
  const [searchParams, setSearchParams] = useSearchParams();
  const fromUrl = searchParams.get('tab') as Tab | null;
  const fallback = steps[currentIdx]?.tab ?? 'invendus';
  const tab: Tab = fromUrl && tabs.some(t => t.key === fromUrl) ? fromUrl : fallback;
  const setTab = (t: Tab) => {
    searchParams.set('tab', t);
    searchParams.delete('vue');
    setSearchParams(searchParams, { replace: true });
  };
  const vue = searchParams.get('vue');
  const setVue = (v: string) => { searchParams.set('tab', tab); searchParams.set('vue', v); setSearchParams(searchParams, { replace: true }); };
  const current = tabs.find(t => t.key === tab)!;

  return (
    <div className="odoo-scope" style={{ minHeight: '100%' }}>
      <div className="odoo-control-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div className="odoo-breadcrumb">
          <Store size={14} style={{ color: 'var(--theme-accent)' }} />
          <span>Journée boutique</span>
          <span className="odoo-breadcrumb-separator">/</span>
          <span className="odoo-breadcrumb-current">{current.label}</span>
        </div>
        <span style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)', textTransform: 'capitalize' }}>
          {format(new Date(), 'EEEE d MMMM yyyy', { locale: fr })}
        </span>
      </div>

      <ol className="ui-timeline" aria-label="Avancement de la journée">
        {steps.map((s, i) => (
          <li key={s.key} className={`ui-timeline-step ${s.done ? 'is-done' : ''} ${i === currentIdx ? 'is-current' : ''}`}>
            <button type="button" onClick={() => setTab(s.tab)} aria-current={i === currentIdx ? 'step' : undefined}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem', background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>
              <span className="ui-timeline-dot">{s.done ? <Check size={12} /> : i + 1}</span>
              <span className="ui-timeline-label">{s.label}</span>
              <span className="ui-timeline-detail">{s.detail}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="odoo-tabs">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`odoo-tab ${tab === t.key ? 'active' : ''}`}>
              <Icon size={13} style={{ marginRight: 4 }} /> {t.label}
            </button>
          );
        })}
      </div>

      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {isManager && tab !== 'parametres' && (
          <VentesIndicators onManquants={() => {
            searchParams.set('tab', 'rapports'); searchParams.set('vue', 'ventes'); setSearchParams(searchParams, { replace: true });
          }} />
        )}
        {tab === 'ouverture' && <OuvertureTab />}
        {tab === 'invendus' && <InvendusTab />}
        {tab === 'ventes' && <VentesTab vue={vue} setVue={setVue} />}
        {tab === 'rapports' && <RapportsTab vue={vue} setVue={setVue} />}
        {tab === 'parametres' && <ParametresTab vue={vue} setVue={setVue} />}
      </div>
    </div>
  );
}

type SubProps = { vue: string | null; setVue: (v: string) => void };

/** Fiche de besoin le matin, Journée (shifts, import Loyverse, clôture) ensuite. */
function VentesTab({ vue, setVue }: SubProps) {
  const v = vue === 'fiche' ? 'fiche' : 'journee';
  return (
    <>
      <SubSwitch ariaLabel="Appro & ventes" value={v} onChange={setVue}
        options={[{ key: 'fiche', label: 'Fiche de besoin' }, { key: 'journee', label: 'Journée (shifts)' }]} />
      {v === 'fiche' ? <FicheBesoinsView onValidated={() => setVue('journee')} /> : <DayView />}
    </>
  );
}

function RapportsTab({ vue, setVue }: SubProps) {
  const v = vue === 'invendus' ? 'invendus' : 'ventes';
  return (
    <>
      <SubSwitch ariaLabel="Rapports" value={v} onChange={setVue}
        options={[{ key: 'ventes', label: 'Écarts de ventes' }, { key: 'invendus', label: 'Invendus du mois' }]} />
      {v === 'ventes' ? <ReportView /> : <InvendusDashboard />}
    </>
  );
}

function ParametresTab({ vue, setVue }: SubProps) {
  const v = vue === 'regles' ? 'regles' : 'catalogue';
  return (
    <>
      <SubSwitch ariaLabel="Paramètres" value={v} onChange={setVue}
        options={[{ key: 'catalogue', label: 'Catalogue Loyverse' }, { key: 'regles', label: 'Report, créneaux et traductions' }]} />
      {v === 'catalogue' ? <CatalogView /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          <CarryOverSettingsView />
          <SlotsSettingsView />
          <DarijaSettingsView />
        </div>
      )}
    </>
  );
}
