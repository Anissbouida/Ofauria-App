import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ShieldCheck, ShoppingCart, Truck, Factory, Trash2, AlertTriangle, CheckCircle2, Loader2, Search, X, Filter,
  Camera, Package, Recycle, Clock, Store, Boxes, Plus, ArrowRight, LayoutDashboard, Thermometer, Siren,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { controleApi, type ControlIndicator, type LossFamily } from '../../api/controle.api';
import { serverUrl } from '../../api/client';
import { StatusBanner } from '../../components/ui/StatusBanner';
import {
  StagePipeline, PeriodFilter, SelectFilter, Pager, PAGE_SIZE, periodParams, periodLabel,
  type PeriodKey, type StageDef,
} from '../../components/purchasing/ProcessBoard';
import GoodsEntryRegisterTab from '../stock/GoodsEntryRegisterTab';
import PurchasingPilotageTab from '../purchasing/PurchasingPilotageTab';
import ProductionControl from './ProductionControl';
import ReceptionChecks from './ReceptionChecks';
import { useLossReferentials } from '../accounting/LossesTab';
import { useReferentiel } from '../../hooks/useReferentiel';
import LossDeclare from './LossDeclare';
import HaccpManagerTab from '../haccp/HaccpManagerTab';
import TraceabilityTab from '../traceability/TraceabilityTab';

/**
 * Contrôle & Qualité (décision du 2026-10-18) : un seul endroit pour tous les
 * contrôles — ventes, achats et réception, production, pertes — avec le même
 * squelette que les autres listes (cartes, prochaine action, filtres communs).
 * Conventions : un écart négatif est un manque ; les pertes sont valorisées au
 * coût de revient (mig 313), jamais au prix de vente.
 */

type Tab = 'overview' | 'achats' | 'production' | 'pertes' | 'haccp' | 'tracabilite';
const TABS: Array<{ key: Tab; label: string; icon: typeof ShieldCheck }> = [
  { key: 'overview', label: 'Vue d\'ensemble', icon: LayoutDashboard },
  { key: 'achats', label: 'Achats & réception', icon: Truck },
  { key: 'production', label: 'Production', icon: Factory },
  { key: 'pertes', label: 'Pertes', icon: Trash2 },
  { key: 'haccp', label: 'HACCP', icon: Thermometer },
  { key: 'tracabilite', label: 'Traçabilité & rappels', icon: Siren },
];

const n = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DOT = { danger: '#dc3545', warning: '#d9822b', ok: '#28a745', unknown: '#adb5bd' } as const;

function Dot({ color }: { color: string }) {
  return <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: color, flexShrink: 0, display: 'inline-block' }} />;
}

export default function ControlePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (TABS.some(t => t.key === searchParams.get('tab')) ? searchParams.get('tab') : 'overview') as Tab;
  const setTab = (t: Tab) => {
    if (t === 'overview') searchParams.delete('tab'); else searchParams.set('tab', t);
    setSearchParams(searchParams, { replace: true });
  };
  // Période commune à la vue d'ensemble et aux pertes.
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const range = useMemo(() => periodParams(period, customFrom, customTo), [period, customFrom, customTo]);
  const current = TABS.find(t => t.key === tab)!;

  return (
    <div className="odoo-scope" style={{ minHeight: '100%' }}>
      <div className="odoo-control-bar">
        <div className="odoo-breadcrumb">
          <ShieldCheck size={14} style={{ color: 'var(--theme-accent)' }} />
          <span>Contrôle & Qualité</span>
          <span className="odoo-breadcrumb-separator">/</span>
          <span className="odoo-breadcrumb-current">{current.label}</span>
        </div>
      </div>
      <div className="odoo-tabs">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`odoo-tab ${tab === t.key ? 'active' : ''}`}>
              <Icon size={13} style={{ marginRight: 4 }} /> {t.label}
            </button>
          );
        })}
      </div>

      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {(tab === 'overview' || tab === 'production' || tab === 'pertes') && (
          <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8, margin: 0 }}>
            <PeriodFilter label="Période" title="Période analysée"
              period={period} onPeriod={setPeriod} from={customFrom} onFrom={setCustomFrom} to={customTo} onTo={setCustomTo} />
            <span style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>
              <strong style={{ color: 'var(--odoo-text)' }}>{periodLabel(period, customFrom, customTo)}</strong>
            </span>
          </div>
        )}
        {tab === 'overview' && <Overview range={range} onTab={setTab} />}
        {tab === 'achats' && <AchatsTab />}
        {tab === 'production' && <ProductionTab range={range} periodText={periodLabel(period, customFrom, customTo)} />}
        {tab === 'pertes' && <LossRegister range={range} periodText={periodLabel(period, customFrom, customTo)} />}
        {tab === 'haccp' && <><DomainIndicators range={range} domain="haccp" /><HaccpManagerTab /></>}
        {tab === 'tracabilite' && <TraceabilityTab />}
      </div>
    </div>
  );
}

/* ═══════════════════════ VUE D'ENSEMBLE ═══════════════════════ */

const DOMAINS: Array<StageDef & { key: ControlIndicator['domain'] }> = [
  { key: 'ventes', label: 'Ventes', hint: 'écarts de ventes et de caisse', icon: ShoppingCart },
  { key: 'achats', label: 'Achats & réception', hint: 'factures, réceptions, traçabilité', icon: Truck },
  { key: 'production', label: 'Production', hint: 'rendement, pesées, préparations', icon: Factory },
  { key: 'pertes', label: 'Pertes', hint: 'déclarées et à risque', icon: Trash2 },
  { key: 'haccp', label: 'HACCP', hint: 'températures, nettoyage, actions', icon: Thermometer },
];

function useIndicators(range: Record<string, string>) {
  return useQuery({ queryKey: ['controle-overview', range], queryFn: () => controleApi.overview(range) });
}

function Overview({ range, onTab }: { range: Record<string, string>; onTab: (t: Tab) => void }) {
  const navigate = useNavigate();
  const { data = [], isLoading } = useIndicators(range);
  const alerts = data.filter(i => i.severity === 'danger' || i.severity === 'warning');
  const byDomain = (d: string) => data.filter(i => i.domain === d && (i.severity === 'danger' || i.severity === 'warning'));
  const go = (i: ControlIndicator) => {
    if (i.target === 'stock') navigate('/stock');
    else if (i.target === 'produits') navigate('/products');
    // Les ventes se traitent dans la Journée boutique (onglet Ventes retiré le 2026-10-20).
    else if (i.target === 'ventes') navigate(i.key === 'caisse_ecart' ? '/sales' : '/boutique?tab=rapports&vue=ventes');
    else onTab(i.target);
  };

  if (isLoading) return <Loading />;
  return (
    <>
      <StagePipeline
        title="Où en sont mes contrôles"
        summary={alerts.length ? `${alerts.length} contrôle${alerts.length > 1 ? 's' : ''} demandent une action` : 'Aucune anomalie sur la période'}
        stages={DOMAINS}
        stats={Object.fromEntries(DOMAINS.map(d => {
          const items = byDomain(d.key);
          const value = items.reduce((s, i) => s + Math.abs(i.value ?? 0), 0);
          const danger = items.filter(i => i.severity === 'danger').length;
          return [d.key, { count: items.length, sub: value > 0 ? `${n(value)} DH` : '', late: danger, alertLabel: 'urgent' }];
        }))}
        isActive={() => false}
        onPick={k => (k === 'ventes' ? navigate('/boutique') : onTab(k as Tab))}
      />

      {alerts.length === 0 ? (
        <StatusBanner tone="success" icon={CheckCircle2} title="Tous les contrôles sont au vert">
          Aucun écart, blocage ni perte sur la période choisie.
        </StatusBanner>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--odoo-border)', borderRadius: 4 }}>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th>Contrôle</th>
                <th style={{ textAlign: 'right' }}>Nombre</th>
                <th style={{ textAlign: 'right' }}>Valeur</th>
                <th style={{ textAlign: 'right' }}>Prochaine action</th>
              </tr>
            </thead>
            <tbody>
              {DOMAINS.map(d => {
                const items = data.filter(i => i.domain === d.key);
                if (items.length === 0) return null;
                return [
                  <tr key={`h-${d.key}`}>
                    <td colSpan={4} style={{ background: 'var(--odoo-bg-hover)', fontWeight: 600, fontSize: '0.75rem', color: 'var(--odoo-text)' }}>{d.label}</td>
                  </tr>,
                  ...items.map(i => (
                    <tr key={i.key} style={{ opacity: i.severity === 'ok' ? 0.7 : 1 }}>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <Dot color={DOT[i.severity]} />
                          <span style={{ fontWeight: i.severity === 'ok' ? 400 : 600 }}>{i.label}</span>
                        </span>
                        <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', marginLeft: 16 }}>
                          {i.hint}
                          {i.key === 'recu_non_facture' && (i.aged ?? 0) > 0 && ` · ${i.aged} de plus de 30 j`}
                          {i.key === 'pertes' && (i.missing ?? 0) > 0 && ` · ${i.missing} sans coût de revient`}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{i.count === null ? '—' : i.count}</td>
                      <td style={{ textAlign: 'right', color: (i.value ?? 0) < 0 ? '#dc3545' : 'var(--odoo-text)' }}>
                        {i.value === null || i.value === 0 ? <span style={{ color: 'var(--theme-text-muted)' }}>—</span> : <>{n(i.value)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>DH</span></>}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {i.severity !== 'ok' && i.severity !== 'unknown' && (
                          <button type="button" onClick={() => go(i)} className={i.severity === 'danger' ? 'odoo-btn-danger' : 'odoo-btn-secondary'}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            Traiter <ArrowRight size={12} />
                          </button>
                        )}
                      </td>
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
        Conventions : un écart négatif est un manque. Les manquants de ventes sont valorisés au prix de vente (manque à gagner) ; les pertes au coût de revient.
      </p>
    </>
  );
}

/* ═══════════════════════ INDICATEURS PAR DOMAINE ═══════════════════════ */

function DomainIndicators({ range, domain }: { range: Record<string, string>; domain: ControlIndicator['domain'] }) {
  const { data = [], isLoading } = useIndicators(range);
  if (isLoading) return <Loading />;
  const items = data.filter(i => i.domain === domain);
  return (
    <div className="odoo-stat-grid" style={{ border: '1px solid var(--odoo-border)', borderRadius: 4 }}>
      {items.map(i => (
        <div key={i.key} className="odoo-stat-card" style={{ cursor: 'default' }}>
          <div className="odoo-stat-card-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Dot color={DOT[i.severity]} /> {i.label}
          </div>
          <div className="odoo-stat-card-value">{i.count ?? '—'}</div>
          <div className="odoo-stat-card-sub">{i.value ? `${n(i.value)} DH · ` : ''}{i.hint}</div>
        </div>
      ))}
    </div>
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
      <div className="odoo-search-panel" style={{ margin: 0 }}>
        <div className="odoo-view-switcher" role="tablist" aria-label="Contrôle achats">
          {ACHATS_VIEWS.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)}
              style={{
                padding: '0.3rem 0.75rem', fontSize: '0.8125rem',
                background: view === key ? 'var(--odoo-purple-light)' : 'transparent',
                color: view === key ? 'var(--odoo-purple)' : 'var(--odoo-text-muted)',
                fontWeight: view === key ? 600 : 400,
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {view === 'controles' && <ReceptionChecks />}
      {view === 'registre' && <div style={{ margin: '0 -1rem' }}><GoodsEntryRegisterTab /></div>}
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
  production: '#d9822b', invendu: '#c99a06', vitrine: '#3b82f6', perime: '#dc3545', recyclage: '#28a745', matiere: '#6f42c1',
};

function LossRegister({ range, periodText }: { range: Record<string, string>; periodText: string }) {
  const queryClient = useQueryClient();
  const { REASON_LABELS } = useLossReferentials();
  const { getLabel: matiereReason } = useReferentiel('material_loss_reasons');
  const [family, setFamily] = useState<'all' | LossFamily>('all');
  const [source, setSource] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [declaring, setDeclaring] = useState(false);
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
      <StagePipeline
        title="Registre des pertes"
        summary={`${n(total)} DH au coût de revient${delta !== null ? ` · ${delta > 0 ? '+' : ''}${delta} % vs période précédente` : ''}`}
        stages={FAMILIES}
        stats={Object.fromEntries(FAMILIES.map(f => {
          const x = (fam as Record<string, { count: number; value: number; missing: number } | undefined>)[f.key];
          return [f.key, x ? { count: x.count, sub: `${n(x.value)} DH`, late: x.missing, alertLabel: 'sans coût' } : { count: 0, sub: '' }];
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
        <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, padding: '10px 14px', background: 'var(--odoo-bg)' }}>
          <div style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--odoo-text-muted)', marginBottom: 6 }}>
            Ce qui coûte le plus · {periodText}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 20px', fontSize: '0.8125rem' }}>
            {summary!.top.map(t => (
              <span key={`${t.item_name}-${t.source}`}>
                <strong>{t.item_name}</strong>
                <span style={{ color: 'var(--theme-text-muted)' }}> · {Number(t.quantity).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} {t.source === 'produit' ? 'u' : t.unit} · </span>
                <strong>{n(Number(t.value))} DH</strong>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8, margin: 0 }}>
        <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        <input type="text" value={searchInput} onChange={e => setSearchInput(e.target.value)} aria-label="Rechercher une perte"
          placeholder="Rechercher un article, un motif, un déclarant..." className="odoo-search-input" style={{ flex: '1 1 220px', minWidth: 0 }} />
        {isFetching && !isLoading && <Loader2 className="animate-spin" size={13} style={{ color: 'var(--theme-text-muted)' }} />}
        <SelectFilter label="Origine" icon={Filter} value={source} onChange={setSource}
          options={[{ key: 'produit', label: 'Produits finis' }, { key: 'matiere', label: 'Matières premières' }]} allLabel="Toutes" />
        {hasFilters && (
          <button type="button" onClick={() => { setFamily('all'); setSource(''); setSearchInput(''); setSearch(''); }}
            className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <X size={12} /> Effacer les filtres
          </button>
        )}
        <button type="button" onClick={() => setDeclaring(true)} className="odoo-btn-primary"
          title="Perte de produit fini ou de matière première"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} /> Déclarer une perte
        </button>
      </div>

      {isLoading ? <Loading /> : rows.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Trash2 size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{hasFilters ? 'Aucune perte pour ces filtres.' : 'Aucune perte enregistrée sur la période.'}</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', opacity: isFetching ? 0.7 : 1, transition: 'opacity 0.15s' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Article</th>
                <th>Famille</th>
                <th>Motif</th>
                <th style={{ textAlign: 'right' }}>Quantité</th>
                <th style={{ textAlign: 'right' }}>Coût unitaire</th>
                <th style={{ textAlign: 'right' }}>Valeur</th>
                <th>Déclaré par</th>
                <th style={{ width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={`${r.source}-${r.id}`}>
                  <td style={{ color: 'var(--theme-text-muted)', whiteSpace: 'nowrap' }}>{format(new Date(r.occurred_at), 'dd/MM/yyyy HH:mm', { locale: fr })}</td>
                  <td>
                    <span style={{ fontWeight: 500 }}>{r.item_name}</span>
                    <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>{r.source === 'produit' ? 'Produit fini' : 'Matière première'}</div>
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.75rem' }}>
                      <Dot color={FAMILY_DOT[r.family]} /> {FAMILIES.find(f => f.key === r.family)?.label}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.75rem' }}>
                    {reasonLabel(r)}
                    {r.note && <div style={{ color: 'var(--theme-text-muted)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.note}>{r.note}</div>}
                  </td>
                  <td style={{ textAlign: 'right' }}>{Number(r.quantity).toLocaleString('fr-FR', { maximumFractionDigits: 3 })} <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem' }}>{r.unit}</span></td>
                  <td style={{ textAlign: 'right', color: 'var(--theme-text-muted)' }}>{r.unit_cost ? n(Number(r.unit_cost)) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    {r.cost_missing
                      ? <span style={{ color: '#b85d1a', fontSize: '0.75rem', fontWeight: 600 }}>coût manquant</span>
                      : <strong>{n(Number(r.value))} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span></strong>}
                  </td>
                  <td style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{r.declared_by_name ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    {r.photo_url && (
                      <button type="button" className="odoo-pager-btn" aria-label="Voir la photo" title="Voir la photo" onClick={() => setPhoto(serverUrl(r.photo_url!))}>
                        <Camera size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700, borderTop: '2px solid var(--theme-bg-separator)' }}>
                <td colSpan={6} style={{ color: 'var(--theme-text-muted)' }}>Total du filtre — {data?.total ?? 0} perte{(data?.total ?? 0) > 1 ? 's' : ''}{(data?.missingCost ?? 0) > 0 ? ` (dont ${data!.missingCost} sans coût)` : ''}</td>
                <td style={{ textAlign: 'right' }}>{n(data?.sumValue ?? 0)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span></td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
          <Pager page={page} total={data?.total ?? 0} onPage={setPage} note={`Pertes · ${periodText}`} />
        </div>
      )}

      {declaring && <LossDeclare onClose={() => setDeclaring(false)} />}
      {photo && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setPhoto(null)}>
          <img src={photo} alt="Photo de la perte" style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 4 }} />
        </div>
      )}
    </>
  );
}

function Loading() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <Loader2 size={22} className="animate-spin" style={{ color: 'var(--theme-accent)' }} />
    </div>
  );
}
