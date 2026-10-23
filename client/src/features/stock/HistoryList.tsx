import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertTriangle, Archive, ChevronRight, Search, Filter, X } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { bonSortieApi } from '../../api/bon-sortie.api';
import { bonStatusTag } from '../production/status';
import {
  PeriodFilter, SelectFilter, Pager, PAGE_SIZE, periodParams, periodLabel, type PeriodKey,
} from '../../components/purchasing/ProcessBoard';

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8 }}>
        <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        <input type="text" placeholder="Rechercher par N° de bon, demandeur, préparateur..." aria-label="Rechercher dans l'historique"
          value={searchInput} onChange={e => setSearchInput(e.target.value)} className="odoo-search-input" style={{ flex: '1 1 220px', minWidth: 0 }} />
        {isFetching && !isLoading && <Loader2 className="animate-spin" size={13} style={{ color: 'var(--theme-text-muted)' }} />}
        <SelectFilter label="Statut" icon={Filter} value={status} onChange={setStatus} options={HISTORY_STATUSES} />
        <PeriodFilter label="Terminé" title="Filtre sur la date de remise / clôture"
          period={period} onPeriod={setPeriod} from={customFrom} onFrom={setCustomFrom} to={customTo} onTo={setCustomTo} />
        {hasFilters && (
          <button type="button" onClick={resetFilters} className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <X size={12} /> Effacer les filtres
          </button>
        )}
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
          <Loader2 size={28} className="animate-spin" style={{ color: 'var(--theme-accent)' }} />
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Archive size={32} style={{ margin: '0 auto 0.75rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{hasFilters ? 'Aucun bon pour ces filtres.' : 'Aucun bon dans l\'historique pour le moment.'}</p>
          {hasFilters && (
            <button type="button" onClick={resetFilters} style={{ fontSize: '0.6875rem', textDecoration: 'underline', color: 'inherit' }}>Effacer les filtres</button>
          )}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', opacity: isFetching ? 0.7 : 1, transition: 'opacity 0.15s' }}>
          <table className="odoo-table" style={{ border: '1px solid var(--theme-bg-separator)' }}>
            <thead>
              <tr>
                <th>N° bon</th>
                <th>Plan de production</th>
                <th>Statut</th>
                <th style={{ textAlign: 'right' }}>Lignes</th>
                <th>Demandé par</th>
                <th>Préparé par</th>
                <th>Validé par</th>
                <th>Terminé le</th>
                <th style={{ width: 32 }}></th>
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
                    <tr key={`m-${bon.id}`}>
                      <td colSpan={9} style={{ background: 'var(--odoo-bg-hover)', fontWeight: 600, fontSize: '0.75rem', textTransform: 'capitalize', color: 'var(--odoo-text)' }}>{month}</td>
                    </tr>
                  ),
                  <tr key={bon.id as string} onClick={() => onOpen(bon.plan_id as string)} style={{ cursor: 'pointer' }} title="Ouvrir le bon">
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{bon.numero as string}</td>
                    <td>
                      <strong>Plan du {bon.plan_date ? format(new Date(bon.plan_date as string), 'dd MMM yyyy', { locale: fr }) : '—'}</strong>
                      {bon.chef_reject_reason && (
                        <div style={{ fontSize: '0.6875rem', color: '#721c24', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                          <AlertTriangle size={10} /> Refus préc. : {bon.chef_reject_reason as string}
                        </div>
                      )}
                    </td>
                    <td><span className={`odoo-tag ${conf.cls}`}>{conf.label}</span></td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{bon.total_lines as number}</td>
                    <td style={{ color: 'var(--theme-text-muted)' }}>{(bon.generated_by_name as string) || '—'}</td>
                    <td style={{ color: 'var(--theme-text-muted)' }}>{(bon.preparation_by_name as string) || '—'}</td>
                    <td style={{ color: 'var(--theme-text-muted)' }}>{(bon.prelevement_by_name as string) || '—'}</td>
                    <td style={{ color: 'var(--theme-text-muted)', whiteSpace: 'nowrap' }}>
                      {finalDate ? format(new Date(finalDate), 'dd MMM HH:mm', { locale: fr }) : '—'}
                    </td>
                    <td style={{ color: 'var(--theme-text-muted)' }}><ChevronRight size={14} /></td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
          <Pager page={page} total={total} onPage={setPage}
            note={`Bons remis, vérifiés, clôturés ou annulés · ${periodLabel(period, customFrom, customTo)}`} />
        </div>
      )}
    </div>
  );
}
