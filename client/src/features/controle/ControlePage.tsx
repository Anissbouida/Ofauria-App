import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShoppingCart, Truck, Factory, Trash2, AlertTriangle, CheckCircle2, Loader2, Filter, Camera, Package, Recycle, Clock, Store, Boxes, Plus, ArrowRight, LayoutDashboard, Thermometer, Siren, ClipboardCheck, Settings, MessageSquareWarning, ListChecks } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { controleApi, type ControlIndicator, type LossFamily } from '../../api/controle.api';
import { serverUrl } from '../../api/client';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { ModuleShell, useCapabilityScreens, ModulePage, useModuleView, type ModuleView } from '../../components/layout/ModuleShell';
import { StatusTag } from '../../components/ui/StatusTag';
import { usePermissions } from '../../context/PermissionsContext';
import { useApprovalsCount } from '../../api/approvals.api';
import {
  PeriodFilter, SelectFilter, PAGE_SIZE, periodParams, periodLabel,
  type PeriodKey, type StageDef,
} from '../../components/purchasing/ProcessBoard';
import { ListToolbar, ListEmpty } from '../sales/ListTemplate';
import { StageChips, Segmented, Panel, PagerFoot, PageLoading } from './KlUi';
import { DataPanel, HeaderSlotContext, KpiCard, KpiGrid, Modal, NoResultState, SectionHeader } from '../../components/ds';
import GoodsEntryRegisterTab from '../stock/GoodsEntryRegisterTab';
import PurchasingPilotageTab from '../purchasing/PurchasingPilotageTab';
import ProductionControl from './ProductionControl';
import ReceptionChecks from './ReceptionChecks';
import { useLossReferentials } from '../accounting/LossesTab';
import { useReferentiel } from '../../hooks/useReferentiel';
import LossDeclare from './LossDeclare';
import HaccpManagerTab from '../haccp/HaccpManagerTab';
import TraceabilityTab from '../traceability/TraceabilityTab';
import ComplaintsTab from './ComplaintsTab';
import QualityTab from './QualityTab';
import { money, currencySymbol } from '../../utils/money';

/**
 * Contrôle & Qualité (décision du 2026-10-18) : un seul endroit pour tous les
 * contrôles — ventes, achats et réception, production, pertes — avec le même
 * squelette que les autres listes (cartes, prochaine action, filtres communs).
 * Conventions : un écart négatif est un manque ; les pertes sont valorisées au
 * coût de revient (mig 313), jamais au prix de vente.
 */

type Tab = 'overview' | 'achats' | 'production' | 'pertes' | 'haccp' | 'tracabilite' | 'sav' | 'qualite';

const n = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Ton d'un indicateur (tuile) et étiquette de statut d'un contrôle, selon sa gravité. */
const KPI_TONE = { danger: 'red', warning: 'orange', ok: 'green', unknown: undefined } as const;
const SEVERITY_TAG = {
  danger: { tone: 'blocked', label: 'Urgent' }, warning: { tone: 'todo', label: 'À traiter' },
  ok: { tone: 'done', label: 'Conforme' }, unknown: { tone: 'draft', label: 'Non mesuré' },
} as const;

/** Description d'une ligne sous le titre de chaque écran (gabarit de page du Design System). */
const PAGE_LEADS: Record<Tab, string> = {
  overview: 'Où en sont les contrôles de la période et ce qui demande une action.',
  achats: 'Contrôles à réception, registre des entrées et rapprochement commande, réception, facture.',
  production: 'Rendements, pesées et préparations contrôlés sur la période.',
  pertes: 'Registre des pertes de produits et de matières, valorisées au coût de revient.',
  haccp: 'Températures, nettoyage et actions correctives du plan de maîtrise sanitaire.',
  tracabilite: 'Recherche d\'un lot, de la matière au client, et suivi des rappels.',
  sav: 'Réclamations des clients, de la saisie à la clôture.',
  qualite: 'Non-conformités, plans de contrôle et libération des lots.',
};

function Dot({ color }: { color: string }) {
  return <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: color, flexShrink: 0, display: 'inline-block' }} />;
}

export default function ControlePage() {
  const { hasModule } = usePermissions();
  const approvalsCount = useApprovalsCount();
  // Rubriques standard (ModuleShell) : chaque domaine contrôlé est un écran de travail ;
  // la boîte d'approbation et ses circuits vivent ailleurs (renvois).
  const views: ModuleView<Tab | 'approvals' | 'approval_rules'>[] = useCapabilityScreens('controle', [
    { key: 'overview', label: 'Vue d\'ensemble', icon: LayoutDashboard, section: 'dashboard' },
    { key: 'achats', label: 'Achats & réception', icon: Truck, section: 'operations' },
    { key: 'production', label: 'Production', icon: Factory, section: 'operations' },
    { key: 'pertes', label: 'Pertes', icon: Trash2, section: 'operations' },
    // HACCP : registres d'hygiène alimentaire, seulement avec la capacité (secteurs alimentaires).
    { key: 'haccp', label: 'HACCP', icon: Thermometer, section: 'operations' },
    { key: 'tracabilite', label: 'Traçabilité & rappels', icon: Siren, section: 'operations' },
    // SAV (mig 357) : réclamations clients, saisies ici ou depuis la caisse.
    { key: 'sav', label: 'Réclamations clients', icon: MessageSquareWarning, section: 'operations' },
    { key: 'qualite', label: 'Qualité', icon: ListChecks, section: 'operations' },
    { key: 'approvals', label: 'À approuver', icon: ClipboardCheck, section: 'operations', href: '/approvals', external: true, badge: approvalsCount, hidden: !hasModule('purchasing') },
    { key: 'approval_rules', label: 'Circuits d\'approbation', icon: Settings, section: 'setup', href: '/settings?page=approvals', external: true, hidden: !hasModule('settings') },
  ]);
  const { current, select } = useModuleView(views);
  const tab = current?.key as Tab;
  // Période commune à la vue d'ensemble et aux pertes.
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const range = useMemo(() => periodParams(period, customFrom, customTo), [period, customFrom, customTo]);
  // Boutons de l'écran posés dans la barre (fil d'Ariane) : déclarer une perte, nouvelle réclamation.
  const [declaring, setDeclaring] = useState(false);
  const [creatingComplaint, setCreatingComplaint] = useState(false);
  // Emplacement commun des actions des sous-onglets (HeaderActions), à droite du fil d'Ariane.
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);
  const tabActions = tab === 'pertes' ? (
    <button type="button" onClick={() => setDeclaring(true)} className="odoo-btn-primary"
      title="Perte de produit fini ou de matière première"
      style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <Plus size={13} aria-hidden="true" /> Déclarer une perte
    </button>
  ) : tab === 'sav' ? (
    <button type="button" className="odoo-btn-primary" onClick={() => setCreatingComplaint(true)}
      style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <Plus size={14} /> Nouvelle réclamation
    </button>
  ) : tab === 'haccp' ? (
    <Link to="/haccp" className="odoo-btn-secondary" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <Thermometer size={13} /> Feuille du jour
    </Link>
  ) : undefined;
  const actions = (
    <div ref={setHeaderSlot} style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{tabActions}</div>
  );

  return (
    <ModuleShell title="Contrôle & Qualité" views={views} current={current} onSelect={select} flush actions={actions}>
      <HeaderSlotContext.Provider value={headerSlot}>
      <ModulePage title={current?.label} summary={tab ? PAGE_LEADS[tab] : undefined}>
        {(tab === 'overview' || tab === 'production' || tab === 'pertes' || tab === 'sav') && (
          <div className="prj-toolbar">
            <PeriodFilter label="Période" title="Période analysée"
              period={period} onPeriod={setPeriod} from={customFrom} onFrom={setCustomFrom} to={customTo} onTo={setCustomTo} />
            <span style={{ fontSize: 13, color: 'var(--ds-muted)' }}>
              <strong style={{ color: 'var(--ds-ink)' }}>{periodLabel(period, customFrom, customTo)}</strong>
            </span>
          </div>
        )}
        {tab === 'overview' && <Overview range={range} onTab={select} />}
        {tab === 'achats' && <AchatsTab />}
        {tab === 'production' && <ProductionTab range={range} periodText={periodLabel(period, customFrom, customTo)} />}
        {tab === 'pertes' && <LossRegister range={range} periodText={periodLabel(period, customFrom, customTo)} />}
        {tab === 'haccp' && <><DomainIndicators range={range} domain="haccp" /><HaccpManagerTab /></>}
        {tab === 'tracabilite' && <TraceabilityTab />}
        {tab === 'sav' && <ComplaintsTab range={range} periodText={periodLabel(period, customFrom, customTo)} creating={creatingComplaint} onCreatingChange={setCreatingComplaint} />}
        {tab === 'qualite' && <QualityTab />}
      </ModulePage>
      </HeaderSlotContext.Provider>
      {declaring && <LossDeclare onClose={() => setDeclaring(false)} />}
    </ModuleShell>
  );
}

/* ═══════════════════════ VUE D'ENSEMBLE ═══════════════════════ */

const DOMAINS: Array<StageDef & { key: ControlIndicator['domain'] }> = [
  { key: 'ventes', label: 'Ventes', hint: 'écarts de ventes et de caisse', icon: ShoppingCart },
  { key: 'achats', label: 'Achats & réception', hint: 'factures, réceptions, traçabilité', icon: Truck },
  { key: 'sav', label: 'Réclamations', hint: 'clients mécontents, délais de réponse', icon: MessageSquareWarning },
  { key: 'production', label: 'Production', hint: 'rendement, pesées, préparations', icon: Factory },
  { key: 'pertes', label: 'Pertes', hint: 'déclarées et à risque', icon: Trash2 },
  { key: 'haccp', label: 'HACCP', hint: 'températures, nettoyage, actions', icon: Thermometer },
];

/**
 * Audit des profils (L3) : un domaine de contrôle n'existe que si ses données existent — ventes
 * (caisse ou journée boutique), achats, réclamations (clients), production, HACCP (capacité).
 */
function useDomainOn() {
  const { moduleActive, hasFeature } = usePermissions();
  return (d: string): boolean => {
    switch (d) {
      case 'ventes': return moduleActive('pos') || moduleActive('unsold');
      case 'achats': return moduleActive('purchasing');
      case 'sav': return moduleActive('customers');
      case 'production': return moduleActive('production');
      case 'haccp': return hasFeature('haccp');
      default: return true;
    }
  };
}

/** Familles de pertes selon les modules et capacités (production, journée boutique, vitrine, dates limites). */
function useFamilyOn() {
  const { moduleActive, hasFeature } = usePermissions();
  return (k: string): boolean => {
    switch (k) {
      case 'production': return moduleActive('production');
      case 'invendu': return moduleActive('unsold');
      case 'vitrine': return hasFeature('vitrine');
      case 'perime': return hasFeature('dlc_ddm');
      case 'recyclage': return moduleActive('production');
      default: return true;
    }
  };
}

function useIndicators(range: Record<string, string>) {
  return useQuery({ queryKey: ['controle-overview', range], queryFn: () => controleApi.overview(range) });
}

function Overview({ range, onTab }: { range: Record<string, string>; onTab: (t: Tab) => void }) {
  const navigate = useNavigate();
  const domainOn = useDomainOn();
  const { data: raw = [], isLoading } = useIndicators(range);
  const data = raw.filter(i => domainOn(i.domain));
  const domains = DOMAINS.filter(d => domainOn(d.key));
  const alerts = data.filter(i => i.severity === 'danger' || i.severity === 'warning');
  const byDomain = (d: string) => data.filter(i => i.domain === d && (i.severity === 'danger' || i.severity === 'warning'));
  const go = (i: ControlIndicator) => {
    if (i.target === 'stock') navigate('/stock');
    else if (i.target === 'produits') navigate('/products');
    // Les ventes se traitent dans la Journée boutique (onglet Ventes retiré le 2026-10-20).
    else if (i.target === 'ventes') navigate(i.key === 'caisse_ecart' ? '/sales' : '/boutique?tab=rapports&vue=ventes');
    else onTab(i.target);
  };

  if (isLoading) return <PageLoading />;
  return (
    <>
      {/* Gabarit du tableau de bord : alerte, indicateurs par domaine, puis les contrôles à traiter en tableau. */}
      {alerts.length === 0 && (
        <StatusBanner tone="success" icon={CheckCircle2} title="Tous les contrôles sont au vert">
          Aucun écart, blocage ni perte sur la période choisie.
        </StatusBanner>
      )}
      <SectionHeader title="Où en sont mes contrôles"
        note={alerts.length ? `${alerts.length} contrôle${alerts.length > 1 ? 's' : ''} demande${alerts.length > 1 ? 'nt' : ''} une action` : 'Aucune anomalie sur la période'} />
      <KpiGrid label="Où en sont mes contrôles">
        {domains.map(d => {
          const items = byDomain(d.key);
          const value = items.reduce((s, i) => s + Math.abs(i.value ?? 0), 0);
          const danger = items.filter(i => i.severity === 'danger').length;
          return (
            <KpiCard key={d.key} label={d.label} value={items.length}
              tone={danger > 0 ? 'red' : items.length > 0 ? 'orange' : undefined}
              sub={`${danger > 0 ? `${danger} urgent${danger > 1 ? 's' : ''} · ` : ''}${value > 0 ? `${money(value)} · ` : ''}${d.hint}`}
              onClick={() => (d.key === 'ventes' ? navigate('/boutique') : onTab(d.key as Tab))} />
          );
        })}
      </KpiGrid>

      {alerts.length > 0 && domains.map(d => {
        const items = data.filter(i => i.domain === d.key);
        if (items.length === 0) return null;
        return (
          <section key={d.key} aria-label={`Contrôles : ${d.label}`} style={{ display: 'grid', gap: 12 }}>
            <SectionHeader title={d.label} note={d.hint} />
            <DataPanel label={`Contrôles : ${d.label}`}>
              <table className="odoo-table">
                <thead>
                  <tr>
                    <th>Contrôle</th>
                    <th>Statut</th>
                    <th className="ds-num">Nombre</th>
                    <th className="ds-num">Valeur ({currencySymbol()})</th>
                    <th className="ds-actions"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(i => (
                    <tr key={i.key}>
                      <td>
                        <span className={i.severity === 'ok' ? undefined : 'ds-strong'}>{i.label}</span>
                        <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>
                          {i.hint}
                          {i.key === 'recu_non_facture' && (i.aged ?? 0) > 0 && ` · ${i.aged} de plus de 30 j`}
                          {i.key === 'pertes' && (i.missing ?? 0) > 0 && ` · ${i.missing} sans coût de revient`}
                        </div>
                      </td>
                      <td><StatusTag tone={SEVERITY_TAG[i.severity].tone} label={SEVERITY_TAG[i.severity].label} /></td>
                      <td className="ds-num">{i.count === null ? '—' : i.count}</td>
                      <td className="ds-num" style={(i.value ?? 0) < 0 ? { color: 'var(--ds-danger)', fontWeight: 600 } : undefined}>
                        {i.value === null || i.value === 0 ? '—' : n(i.value)}
                      </td>
                      <td className="ds-actions">
                        {i.severity !== 'ok' && i.severity !== 'unknown' && (
                          <button type="button" onClick={() => go(i)} className="odoo-btn-secondary ds-btn-sm">
                            Traiter <ArrowRight size={12} aria-hidden="true" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataPanel>
          </section>
        );
      })}
      <p className="klc-note">
        Conventions : un écart négatif est un manque. Les manquants de ventes sont valorisés au prix de vente (manque à gagner) ; les pertes au coût de revient.
      </p>
    </>
  );
}

/* ═══════════════════════ INDICATEURS PAR DOMAINE ═══════════════════════ */

function DomainIndicators({ range, domain }: { range: Record<string, string>; domain: ControlIndicator['domain'] }) {
  const { data = [], isLoading } = useIndicators(range);
  if (isLoading) return <PageLoading />;
  const items = data.filter(i => i.domain === domain);
  if (!items.length) return null;
  return (
    <KpiGrid>
      {items.map(i => (
        <KpiCard key={i.key} label={i.label} value={i.count ?? '—'} tone={KPI_TONE[i.severity]}
          sub={`${i.value ? `${money(i.value)} · ` : ''}${i.hint}`} />
      ))}
    </KpiGrid>
  );
}

/* ═══════════════════════ ACHATS & RÉCEPTION ═══════════════════════ */

type AchatsView = 'controles' | 'registre' | 'rapprochement';
const ACHATS_VIEWS: Array<[AchatsView, string]> = [
  ['controles', 'Contrôles à réception'],
  ['registre', 'Registre des entrées : lots, DLC'],
  ['rapprochement', 'Rapprochement commande → réception → facture'],
];

function AchatsTab() {
  const navigate = useNavigate();
  const [view, setView] = useState<AchatsView>('controles');
  return (
    <>
      <Segmented label="Contrôle achats" value={view} onChange={setView} options={ACHATS_VIEWS} />
      {view === 'controles' && <ReceptionChecks />}
      {/* Registre sans sa marge historique (prop bare) : aligné sur la page. */}
      {view === 'registre' && <GoodsEntryRegisterTab bare />}
      {view === 'rapprochement' && <PurchasingPilotageTab onOpenInvoice={() => navigate('/purchasing?tab=invoices')} />}
    </>
  );
}

/* ═══════════════════════ PRODUCTION ═══════════════════════ */

function ProductionTab({ range, periodText }: { range: Record<string, string>; periodText: string }) {
  return (
    <>
      <DomainIndicators range={range} domain="production" />
      <ProductionControl range={range} periodText={periodText} />
    </>
  );
}

/* ═══════════════════════ REGISTRE DES PERTES ═══════════════════════ */

const FAMILIES: Array<StageDef & { key: 'all' | LossFamily }> = [
  { key: 'all', label: 'Toutes', hint: 'au coût de revient', icon: Trash2 },
  { key: 'production', label: 'Production', hint: 'ratés, brûlés, cassés', icon: Factory },
  { key: 'invendu', label: 'Invendus', hint: 'détruits en fin de journée', icon: Store },
  { key: 'vitrine', label: 'Vitrine', hint: 'abîmés en boutique', icon: Package },
  { key: 'perime', label: 'Produits périmés', hint: 'DLC dépassée', icon: Clock },
  { key: 'recyclage', label: 'Recyclage', hint: 'valorisés en matière', icon: Recycle },
  { key: 'matiere', label: 'Matières premières', hint: 'périmées, casse, fond', icon: Boxes },
];
const FAMILY_DOT: Record<LossFamily, string> = {
  production: 'var(--ds-warning)', invendu: 'var(--ds-cat-gold)', vitrine: 'var(--ds-accent)', perime: 'var(--ds-danger)', recyclage: 'var(--ds-success)', matiere: 'var(--ds-cat-purple)',
};

function LossRegister({ range, periodText }: { range: Record<string, string>; periodText: string }) {
  const queryClient = useQueryClient();
  const { REASON_LABELS } = useLossReferentials();
  const { getLabel: matiereReason } = useReferentiel('material_loss_reasons');
  const [family, setFamily] = useState<'all' | LossFamily>('all');
  const familyOn = useFamilyOn();
  const families = FAMILIES.filter(f => familyOn(f.key));
  const [source, setSource] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [photo, setPhoto] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => { setPage(1); }, [family, source, search, range]);

  const params = useMemo(() => {
    const p: Record<string, string> = { ...range, page: String(page), pageSize: String(PAGE_SIZE) };
    if (family !== 'all') p.family = family;
    if (source) p.source = source;
    if (search) p.search = search;
    return p;
  }, [range, family, source, search, page]);

  const { data: summary } = useQuery({ queryKey: ['controle-losses-summary', range], queryFn: () => controleApi.lossesSummary(range) });
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['controle-losses', params], queryFn: () => controleApi.losses(params), placeholderData: prev => prev,
  });

  const fam = useMemo(() => {
    const m: Record<string, { count: number; value: number; missing: number }> = {};
    for (const f of summary?.byFamily ?? []) m[f.family] = { count: f.count, value: Number(f.value), missing: f.missing };
    const all = Object.values(m).reduce((a, x) => ({ count: a.count + x.count, value: a.value + x.value, missing: a.missing + x.missing }), { count: 0, value: 0, missing: 0 });
    return { ...m, all };
  }, [summary]);
  const total = (fam as Record<string, { value: number }>).all.value;
  const prev = summary?.previousValue ?? null;
  const delta = prev && prev > 0 ? Math.round((total - prev) / prev * 100) : null;
  const rows = data?.rows ?? [];
  const reasonLabel = (r: { source: string; reason_code: string | null }) =>
    r.source === 'matiere' ? matiereReason(r.reason_code ?? 'autre') : (REASON_LABELS[r.reason_code ?? ''] ?? r.reason_code ?? '—');
  const hasFilters = !!(family !== 'all' || source || search);

  return (
    <>
      <StageChips
        title="Registre des pertes"
        summary={`${money(total)} au coût de revient${delta !== null ? ` · ${delta > 0 ? '+' : ''}${delta} % vs période précédente` : ''}`}
        stages={families}
        stats={Object.fromEntries(families.map(f => {
          const x = (fam as Record<string, { count: number; value: number; missing: number } | undefined>)[f.key];
          return [f.key, x ? { count: x.count, sub: `${money(x.value)}`, late: x.missing, alertLabel: 'sans coût' } : { count: 0, sub: '' }];
        }))}
        isActive={k => family === k}
        onPick={k => setFamily(family === k && k !== 'all' ? 'all' : (k as 'all' | LossFamily))}
      />

      {(fam as Record<string, { missing: number }>).all.missing > 0 && (
        <StatusBanner tone="warning" icon={AlertTriangle}
          title={`${(fam as Record<string, { missing: number }>).all.missing} perte${(fam as Record<string, { missing: number }>).all.missing > 1 ? 's' : ''} sans coût de revient`}>
          Leur valeur n'est pas comptée dans le total : renseignez le coût du produit (fiche technique) ou le prix d'achat du lot.
        </StatusBanner>
      )}

      {(summary?.top?.length ?? 0) > 0 && (
        <section className="ds-panel klc-body" aria-label="Ce qui coûte le plus">
          <h3 className="ds-subhead" style={{ marginBottom: 6 }}>Ce qui coûte le plus · {periodText}</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 20px', fontSize: 14 }}>
            {summary!.top.map(t => (
              <span key={`${t.item_name}-${t.source}`}>
                <strong>{t.item_name}</strong>
                <span style={{ color: 'var(--ds-muted)' }}> · {Number(t.quantity).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} {t.source === 'produit' ? 'u' : t.unit} · </span>
                <strong>{money(Number(t.value))}</strong>
              </span>
            ))}
          </div>
        </section>
      )}

      <ListToolbar search={searchInput} onSearch={setSearchInput} placeholder="Rechercher un article, un motif, un déclarant...">
        {isFetching && !isLoading && <Loader2 className="animate-spin" size={13} aria-hidden="true" style={{ color: 'var(--ds-muted)' }} />}
        <SelectFilter label="Origine" icon={Filter} value={source} onChange={setSource}
          options={[{ key: 'produit', label: 'Produits finis' }, { key: 'matiere', label: 'Matières premières' }]} allLabel="Toutes" />
      </ListToolbar>

      {isLoading ? <PageLoading /> : rows.length === 0 ? (
        hasFilters
          ? <NoResultState text="Aucune perte ne correspond aux filtres." onReset={() => { setFamily('all'); setSource(''); setSearchInput(''); setSearch(''); }} />
          : <ListEmpty icon={Trash2} title="Aucune perte enregistrée sur la période" text="Les pertes déclarées en production, en boutique et au stock s'affichent ici." />
      ) : (
        <Panel style={{ opacity: isFetching ? 0.7 : 1, transition: 'opacity 0.15s' }}
          footer={<PagerFoot page={page} total={data?.total ?? 0} onPage={setPage} note={`Pertes · ${periodText}`} />}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Article</th>
                <th>Famille</th>
                <th>Motif</th>
                <th className="ds-num">Quantité</th>
                <th className="ds-num">Coût unitaire ({currencySymbol()})</th>
                <th className="ds-num">Valeur ({currencySymbol()})</th>
                <th>Déclaré par</th>
                <th className="ds-actions"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={`${r.source}-${r.id}`}>
                  <td style={{ color: 'var(--ds-muted)', whiteSpace: 'nowrap' }}>{format(new Date(r.occurred_at), 'd MMM yyyy HH:mm', { locale: fr })}</td>
                  <td>
                    <span className="ds-strong">{r.item_name}</span>
                    <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>{r.source === 'produit' ? 'Produit fini' : 'Matière première'}</div>
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Dot color={FAMILY_DOT[r.family]} /> {FAMILIES.find(f => f.key === r.family)?.label}
                    </span>
                  </td>
                  <td>
                    {reasonLabel(r)}
                    {r.note && <div style={{ fontSize: 12, color: 'var(--ds-muted)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.note}>{r.note}</div>}
                  </td>
                  <td className="ds-num">{Number(r.quantity).toLocaleString('fr-FR', { maximumFractionDigits: 3 })} <span style={{ color: 'var(--ds-muted)', fontSize: 12 }}>{r.unit}</span></td>
                  <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>{r.unit_cost ? n(Number(r.unit_cost)) : '—'}</td>
                  <td className="ds-num">
                    {r.cost_missing
                      ? <StatusTag tone="todo" label="coût manquant" />
                      : <span className="ds-strong">{n(Number(r.value))}</span>}
                  </td>
                  <td style={{ color: 'var(--ds-muted)' }}>{r.declared_by_name ?? '—'}</td>
                  <td className="ds-actions">
                    {r.photo_url && (
                      <button type="button" className="ds-icon-btn" aria-label="Voir la photo" title="Voir la photo" onClick={() => setPhoto(serverUrl(r.photo_url!))}>
                        <Camera size={15} aria-hidden="true" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6}>Total du filtre — {data?.total ?? 0} perte{(data?.total ?? 0) > 1 ? 's' : ''}{(data?.missingCost ?? 0) > 0 ? ` (dont ${data!.missingCost} sans coût)` : ''}</td>
                <td className="ds-num">{n(data?.sumValue ?? 0)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </Panel>
      )}

      {photo && (
        <Modal title="Photo de la perte" onClose={() => setPhoto(null)} width={960}>
          <img src={photo} alt="Photo de la perte" style={{ maxWidth: '100%', maxHeight: '75vh', borderRadius: 4, margin: '0 auto', display: 'block' }} />
        </Modal>
      )}
    </>
  );
}
