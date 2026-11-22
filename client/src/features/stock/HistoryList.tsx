import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertTriangle, Archive, ChevronRight, Filter, X } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { bonSortieApi } from '../../api/bon-sortie.api';
import { bonStatusTag } from '../production/status';
import { StatusTag } from '../../components/ui/StatusTag';
import {
  PeriodFilter, SelectFilter, PAGE_SIZE, periodParams, periodLabel, type PeriodKey,
} from '../../components/purchasing/ProcessBoard';
import { ListToolbar } from '../sales/ListTemplate';
import { PagerFoot } from './StockUi';
import { DataPanel, EmptyState, LoadingState, NoResultState } from '../../components/ds';

const HISTORY_STATUSES = [
  { key: 'prelevement', label: 'Remis au chef' },
  { key: 'verifie', label: 'Vérifié' },
  { key: 'cloture', label: 'Clôturé' },
  { key: 'annule', label: 'Annulé' },
];

/**
 * Historique des bons de sortie (remis, vérifiés, clôturés, annulés) : recherche,
 * statut, période sur la date de fin, pagination côté serveur. Même ergonomie que
 * l'historique des Achats.
 */
export function HistoryList({ onOpen }: { onOpen: (planId: string) => void }) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [period, setPeriod] = useState<PeriodKey>('3m');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => { setPage(1); }, [search, status, period, customFrom, customTo]);

  const params = useMemo(() => {
    const p: Record<string, string | number> = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
    if (status) p.status = status;
    if (search) p.search = search;
    return { ...p, ...periodParams(period, customFrom, customTo) };
  }, [page, status, search, period, customFrom, customTo]);

  const { data, isLoading, isFetching } = useQuery<{ data: Record<string, any>[]; total: number }>({
    queryKey: ['warehouse-history', params],
    queryFn: () => bonSortieApi.warehouseHistory(params),
    placeholderData: (prev) => prev,
  });
  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const hasFilters = !!(search || status || period !== '3m');
  const resetFilters = () => {
    setSearchInput(''); setSearch(''); setStatus(''); setPeriod('3m'); setCustomFrom(''); setCustomTo('');
  };

  return (
    <div className="stk-stack">
      <ListToolbar search={searchInput} onSearch={setSearchInput} placeholder="Rechercher par N° de bon, demandeur, préparateur…">
        {isFetching && !isLoading && <Loader2 className="animate-spin" size={13} style={{ color: 'var(--theme-text-muted)' }} />}
        <SelectFilter label="Statut" icon={Filter} value={status} onChange={setStatus} options={HISTORY_STATUSES} />
        <PeriodFilter label="Terminé" title="Filtre sur la date de remise / clôture"
          period={period} onPeriod={setPeriod} from={customFrom} onFrom={setCustomFrom} to={customTo} onTo={setCustomTo} />
        {hasFilters && (
          <button type="button" onClick={resetFilters} className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <X size={12} /> Effacer les filtres
          </button>
        )}
      </ListToolbar>

      {isLoading ? (
        <LoadingState label="Chargement de l'historique…" />
      ) : rows.length === 0 ? (
        hasFilters
          ? <NoResultState text="Aucun bon ne correspond aux filtres." onReset={resetFilters} />
          : <EmptyState icon={Archive} title="Aucun bon dans l'historique" text="Les bons remis, clôturés ou annulés apparaîtront ici." />
      ) : (
        <div style={{ opacity: isFetching ? 0.7 : 1, transition: 'opacity 0.15s' }}>
        <DataPanel footer={<PagerFoot page={page} total={total} onPage={setPage}
            note={`Bons remis, vérifiés, clôturés ou annulés · ${periodLabel(period, customFrom, customTo)}`} />}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th>N° bon</th>
                <th>Plan de production</th>
                <th>Statut</th>
                <th className="ds-num">Lignes</th>
                <th>Demandé par</th>
                <th>Préparé par</th>
                <th>Validé par</th>
                <th>Terminé le</th>
                <th style={{ width: 32 }}><span className="sr-only">Ouvrir</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((bon, i) => {
                const conf = bonStatusTag((bon.status as string) || 'cloture');
                const finalDate = (bon.closed_at || bon.prelevement_at || bon.updated_at) as string | null;
                // Un intertitre par mois (les lignes arrivent triées par date de fin décroissante).
                const month = finalDate ? format(new Date(finalDate), 'MMMM yyyy', { locale: fr }) : '';
                const prevDate = i > 0 ? (rows[i - 1].closed_at || rows[i - 1].prelevement_at || rows[i - 1].updated_at) as string | null : null;
                const prevMonth = prevDate ? format(new Date(prevDate), 'MMMM yyyy', { locale: fr }) : null;
                return [
                  month !== prevMonth && (
                    <tr key={`m-${bon.id}`} className="stk-month">
                      <td colSpan={9}>{month}</td>
                    </tr>
                  ),
                  <tr key={bon.id as string} onClick={() => onOpen(bon.plan_id as string)} style={{ cursor: 'pointer' }} title="Ouvrir le bon">
                    <td><span className="ds-ref">{bon.numero as string}</span></td>
                    <td>
                      <span className="ds-strong">Plan du {bon.plan_date ? format(new Date(bon.plan_date as string), 'dd MMM yyyy', { locale: fr }) : '—'}</span>
                      {bon.chef_reject_reason && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--ds-danger)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                          <AlertTriangle size={10} /> Refus préc. : {bon.chef_reject_reason as string}
                        </div>
                      )}
                    </td>
                    <td><StatusTag tone={conf.tone} icon={conf.icon} label={conf.label} /></td>
                    <td className="ds-num" style={{ fontWeight: 600 }}>{bon.total_lines as number}</td>
                    <td style={{ color: 'var(--theme-text-muted)' }}>{(bon.generated_by_name as string) || '—'}</td>
                    <td style={{ color: 'var(--theme-text-muted)' }}>{(bon.preparation_by_name as string) || '—'}</td>
                    <td style={{ color: 'var(--theme-text-muted)' }}>{(bon.prelevement_by_name as string) || '—'}</td>
                    <td style={{ color: 'var(--theme-text-muted)', whiteSpace: 'nowrap' }}>
                      {finalDate ? format(new Date(finalDate), 'dd MMM HH:mm', { locale: fr }) : '—'}
                    </td>
                    <td style={{ color: 'var(--theme-text-muted)' }}><ChevronRight size={14} aria-hidden="true" /></td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </DataPanel>
        </div>
      )}
    </div>
  );
}
