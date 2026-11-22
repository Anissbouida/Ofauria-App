import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Download, ClipboardList, AlertTriangle, X, ShieldAlert, PackageX } from 'lucide-react';
import { purchasingReportsApi } from '../../api/purchasing-reports.api';
import { suppliersApi } from '../../api/accounting.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import SearchSelect from '../../components/ui/SearchSelect';
import {
  PeriodFilter, PAGE_SIZE, periodParams, periodLabel, type PeriodKey, type StageDef,
} from '../../components/purchasing/ProcessBoard';
import { ListToolbar, FilterChips } from '../sales/ListTemplate';
import { ChipsRow, PagerFoot, HeaderActions } from './StockUi';
import { DataPanel, EmptyState, LoadingState, NoResultState } from '../../components/ds';

const date = (v: string | null | undefined) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—');
const qty = (v: string | number) => Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 3 });

/** Critères du registre (cartes) : toutes, incomplètes, non conformes, hors BC. */
type Flag = '' | 'incomplete' | 'nonconform' | 'hors_bc';
const FLAGS: Array<StageDef & { key: 'all' | Exclude<Flag, ''> }> = [
  { key: 'all', label: 'Toutes les entrées', hint: 'sur la période', icon: ClipboardList },
  { key: 'incomplete', label: 'Incomplètes', hint: 'sans lot ou sans DLC', icon: AlertTriangle },
  { key: 'nonconform', label: 'Non conformes', hint: 'contrôle à réception', icon: ShieldAlert },
  { key: 'hors_bc', label: 'Hors BC', hint: 'entrées sans commande', icon: PackageX },
];

/**
 * Registre des entrées (mig 312, D9 G-D9-10) : traçabilité « un pas en arrière »
 * (loi 28-07) — date, fournisseur, article, quantité dans l'unité saisie, lots,
 * DLC, contrôle à réception, réceptionnaire. Même ergonomie que les listes des
 * Achats : cartes-critères, filtres, pagination côté serveur.
 */
export default function GoodsEntryRegisterTab({ bare = false }: {
  /**
   * Sans marge propre (design Ventes, 2026-11-18) : la page hôte pose déjà les marges
   * standard (Stock). Par défaut la marge historique (1rem) est conservée pour les hôtes
   * qui la compensent (Contrôle).
   */
  bare?: boolean;
} = {}) {
  const [flag, setFlag] = useState<Flag>('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => { setPage(1); }, [flag, search, supplierId, period, customFrom, customTo]);

  // L'API du registre attend from/to (et non dateFrom/dateTo).
  const range = useMemo(() => {
    const p = periodParams(period, customFrom, customTo);
    const r: Record<string, string> = {};
    if (p.dateFrom) r.from = p.dateFrom;
    if (p.dateTo) r.to = p.dateTo;
    return r;
  }, [period, customFrom, customTo]);
  const params = useMemo(() => {
    const p: Record<string, string> = { page: String(page), pageSize: String(PAGE_SIZE), ...range };
    if (flag) p.flag = flag;
    if (search) p.search = search;
    if (supplierId) p.supplierId = supplierId;
    return p;
  }, [page, range, flag, search, supplierId]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['goods-entry-register-board', params],
    queryFn: () => purchasingReportsApi.registerBoard(params),
    placeholderData: (prev) => prev,
  });
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const supplierOptions = useMemo(
    () => (suppliers as Record<string, any>[]).map(s => ({ id: s.id as string, label: s.name as string })).sort((a, b) => a.label.localeCompare(b.label)),
    [suppliers],
  );

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const counts = data?.counts ?? { all: 0, incomplete: 0, nonconform: 0, hors_bc: 0 };
  const hasFilters = !!(flag || search || supplierId || period !== 'month');
  const resetFilters = () => {
    setFlag(''); setSearchInput(''); setSearch(''); setSupplierId(''); setPeriod('month'); setCustomFrom(''); setCustomTo('');
  };
  const exportCsv = () => purchasingReportsApi.exportRegister({
    from: range.from, to: range.to, supplierId: supplierId || undefined, incompleteOnly: flag === 'incomplete',
  }).catch(() => notify.error('Export impossible'));

  return (
    <div className="stk-stack" style={bare ? undefined : { padding: '1rem' }}>
      <HeaderActions>
        <button type="button" className="odoo-btn-secondary" disabled={!total} onClick={exportCsv}
          title="Fichier complet de la période (pas seulement la page affichée)">
          <Download size={14} aria-hidden="true" /> Exporter
        </button>
      </HeaderActions>

      {counts.incomplete > 0 && (
        <StatusBanner tone="warning" icon={AlertTriangle}
          title={`${counts.incomplete} entrée${counts.incomplete > 1 ? 's' : ''} sans lot fournisseur ou sans DLC sur la période`}
          actions={flag !== 'incomplete' ? <button type="button" className="odoo-btn-secondary" onClick={() => setFlag('incomplete')}>Les afficher</button> : undefined}>
          Une entrée incomplète ne permet pas de retrouver un lot en cas de rappel. La saisie se fait à la réception (lot et DLC exigés selon la catégorie).
        </StatusBanner>
      )}

      <ChipsRow summary={`${counts.all} entrée${counts.all > 1 ? 's' : ''} · ${periodLabel(period, customFrom, customTo)}`}>
        <FilterChips label="Registre des entrées" value={flag || 'all'} onChange={k => setFlag(k === 'all' ? '' : (k as Flag))}
          chips={FLAGS.map(f => {
            const count = f.key === 'all' ? counts.all : counts[f.key];
            return {
              key: f.key, label: f.label, count, icon: f.icon,
              tone: (f.key === 'incomplete' || f.key === 'nonconform') && count > 0 ? 'late' as const : undefined,
            };
          })} />
      </ChipsRow>

      <ListToolbar search={searchInput} onSearch={setSearchInput} placeholder="Rechercher par article, fournisseur, N° de lot, bon ou BC…">
        {isFetching && !isLoading && <Loader2 className="animate-spin" size={13} style={{ color: 'var(--ds-muted)' }} />}
        <PeriodFilter label="Entrée" title="Filtre sur la date d'entrée en stock"
          period={period} onPeriod={setPeriod} from={customFrom} onFrom={setCustomFrom} to={customTo} onTo={setCustomTo} />
        <SearchSelect options={supplierOptions} value={supplierId} onChange={setSupplierId} placeholder="Tous les fournisseurs" />
        {hasFilters && (
          <button type="button" onClick={resetFilters} className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <X size={12} /> Effacer les filtres
          </button>
        )}
      </ListToolbar>

      {isLoading ? (
        <LoadingState label="Chargement du registre…" />
      ) : rows.length === 0 ? (
        hasFilters
          ? <NoResultState text="Aucune entrée ne correspond aux filtres." onReset={resetFilters} />
          : <EmptyState icon={ClipboardList} title="Aucune entrée sur la période" text="Chaque réception de matière s'inscrit ici avec son lot et sa date limite." />
      ) : (
        <div style={{ opacity: isFetching ? 0.7 : 1, transition: 'opacity 0.15s' }}>
        <DataPanel footer={<PagerFoot page={page} total={total} onPage={setPage}
            note={`${FLAGS.find(f => f.key === (flag || 'all'))?.label} · ${periodLabel(period, customFrom, customTo)}`} />}>
          <table className="odoo-table" style={{ margin: 0, minWidth: 1100 }}>
            <thead><tr>
              <th style={{ width: 90 }}>Date</th><th style={{ width: 130 }}>Bon</th><th>Fournisseur</th><th>Article</th>
              <th className="ds-num" style={{ width: 110 }}>Quantité</th><th style={{ width: 120 }}>Lot fournisseur</th><th style={{ width: 140 }}>Lot interne</th>
              <th style={{ width: 90 }}>DLC</th><th style={{ width: 90 }}>Contrôle</th><th style={{ width: 120 }}>BL / facture</th><th style={{ width: 120 }}>Réceptionné par</th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.voucher_number ?? 'hb'}-${r.internal_lot ?? ''}-${i}`}>
                  <td style={{ color: 'var(--ds-muted)' }}>{date(r.entry_date)}</td>
                  <td className="ds-ref">
                    {r.source === 'hors_bc' ? <span style={{ color: 'var(--ds-warning)', fontWeight: 600, fontFamily: 'inherit' }}>hors BC</span> : (
                      <>
                        <div>{r.voucher_number}</div>
                        {r.order_number && <div style={{ color: 'var(--ds-muted)', fontWeight: 400 }}>{r.order_number}</div>}
                      </>
                    )}
                  </td>
                  <td>{r.supplier_name ?? '—'}</td>
                  <td className="ds-strong">
                    {r.item_name ?? '—'}
                    {r.line_kind && r.line_kind !== 'receive' && r.source === 'bc' && <span style={{ color: 'var(--ds-muted)', fontSize: '12px', fontWeight: 400, marginLeft: 6 }}>{r.line_kind}</span>}
                  </td>
                  <td className="ds-num">
                    {qty(r.quantity)} <span style={{ color: 'var(--ds-muted)' }}>{r.unit ?? ''}</span>
                    {r.container_label ? <div style={{ fontSize: '12px', color: 'var(--ds-muted)' }}>{r.container_label}</div> : null}
                  </td>
                  <td>{r.supplier_lot ?? (r.incomplete ? <Missing label="manquant" /> : '—')}</td>
                  <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '12px', color: 'var(--ds-muted)' }}>{r.internal_lot ?? '—'}</td>
                  <td>{r.dlc ? date(r.dlc) : (r.incomplete ? <Missing label="manquante" /> : '—')}</td>
                  <td>
                    {r.overall_conformity == null ? <span style={{ color: 'var(--ds-muted)' }}>—</span>
                      : <Dot ok={r.overall_conformity} label={r.overall_conformity ? 'conforme' : 'non conforme'} />}
                  </td>
                  <td style={{ fontSize: '12px' }}>{r.supplier_invoice_number ?? '—'}</td>
                  <td style={{ fontSize: '12px', color: 'var(--ds-muted)' }}>{r.received_by ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>
        </div>
      )}
    </div>
  );
}

/** Donnée de traçabilité absente : texte orange discret plutôt qu'une pastille rouge par cellule. */
function Missing({ label }: { label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--ds-warning)', fontSize: '12px', fontWeight: 600 }}>
      <AlertTriangle size={11} /> {label}
    </span>
  );
}

function Dot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '12px', color: ok ? 'var(--ds-ink)' : 'var(--ds-danger)', fontWeight: ok ? 400 : 600 }}>
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: ok ? 'var(--ds-success)' : 'var(--ds-danger)' }} />
      {label}
    </span>
  );
}
