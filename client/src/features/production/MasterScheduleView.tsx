import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { CalendarDays, Loader2, Save } from 'lucide-react';
import { productionApi } from '../../api/production.api';
import { Alert, DataPanel, EmptyState, ErrorState, LoadingState, NoResultState, SearchBar, TableFooter, Toolbar } from '../../components/ds';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

/**
 * Production › Plan directeur › Plan par semaine (G5-05).
 *
 * Quantité à produire par article et par semaine. La prévision s'affiche en indication ;
 * une semaine saisie remplace la prévision dans le calcul des besoins phasé, une case
 * vidée y revient. Les commandes fermes restent comptées en plus.
 */
const nf = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const wk = (d: string) => `Sem. du ${format(new Date(`${d}T00:00:00`), 'dd/MM', { locale: fr })}`;

export default function MasterScheduleView({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const today = new Date().toLocaleDateString('sv-SE');
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['master-schedule', today], queryFn: () => productionApi.masterSchedule(today, 8) });
  const [draft, setDraft] = useState<Record<string, number | null>>({});
  const [query, setQuery] = useState('');
  const cell = (pid: string, w: string) => `${pid}|${w}`;

  const save = useMutation({
    mutationFn: () => productionApi.saveMasterSchedule(Object.entries(draft).map(([k, q]) => {
      const [productId, weekStart] = k.split('|');
      return { productId, weekStart, quantity: q };
    })),
    onSuccess: (r) => { setDraft({}); qc.invalidateQueries({ queryKey: ['master-schedule'] }); qc.invalidateQueries({ queryKey: ['mrp-phased'] });
      notify.success(`${r.saved} semaine(s) enregistrée(s)${r.cleared ? ` · ${r.cleared} rendue(s) à la prévision` : ''}`); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.rows ?? []).filter(r => !q || r.product_name.toLowerCase().includes(q) || (r.category_name ?? '').toLowerCase().includes(q));
  }, [data, query]);

  if (isError) return <ErrorState title="Le plan par semaine n'a pas pu être chargé" onRetry={() => refetch()} />;
  if (isLoading || !data) return <LoadingState />;
  const changes = Object.keys(draft).length;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Alert tone="info" icon={CalendarDays}>
        Saisissez ce que vous prévoyez de produire chaque semaine. En gris, la prévision de vente : laissez la case vide pour la garder.
        Le calcul des besoins phasé lit ce plan à la place de la prévision.
      </Alert>
      <Toolbar>
        <SearchBar value={query} onChange={setQuery} placeholder="Rechercher un article" />
        <span className="ds-grow" />
        {canEdit && (
          <>
            <button type="button" className="odoo-btn-secondary" disabled={!changes} onClick={() => setDraft({})}>Annuler</button>
            <button type="button" className="odoo-btn-primary" disabled={!changes || save.isPending} aria-busy={save.isPending || undefined} onClick={() => save.mutate()}>
              {save.isPending ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Save size={14} aria-hidden="true" />} Enregistrer{changes ? ` (${changes})` : ''}
            </button>
          </>
        )}
      </Toolbar>
      {rows.length === 0 ? (query.trim()
        ? <NoResultState text="Aucun article ne correspond à la recherche." onReset={() => setQuery('')} />
        : <EmptyState icon={CalendarDays} title="Aucun article à planifier" text="Les articles fabriqués apparaîtront ici, semaine par semaine." />) : (
      <DataPanel label="Plan par semaine" footer={<TableFooter note={`${rows.length} article(s)${changes ? ` · ${changes} modification(s) non enregistrée(s)` : ''}`} />}>
        <table className="odoo-table">
          <thead><tr><th>Article</th>{data.weeks.map(w => <th key={w} className="ds-num">{wk(w)}</th>)}</tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.product_id}>
              <td><div className="ds-strong">{r.product_name}</div>{r.category_name && <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>{r.category_name}</div>}</td>
              {data.weeks.map(w => {
                const v = r.weeks[w];
                const k = cell(r.product_id, w);
                const value = k in draft ? draft[k] : v.planned;
                return (
                  <td key={w} className="ds-num">
                    <input type="number" min={0} step="any" className="ds-input sm" disabled={!canEdit}
                      value={value ?? ''} placeholder={v.forecast ? nf(v.forecast) : '0'}
                      aria-label={`${r.product_name}, ${wk(w)}`}
                      style={{ width: 84, textAlign: 'right', fontWeight: value != null ? 600 : 400 }}
                      onChange={e => {
                        const raw = e.target.value.trim();
                        const q = raw === '' ? null : Number(raw);
                        setDraft(d => {
                          const next = { ...d };
                          if (q === v.planned || (q == null && v.planned == null)) delete next[k]; else next[k] = q;
                          return next;
                        });
                      }} />
                  </td>
                );
              })}
            </tr>
          ))}</tbody>
        </table>
      </DataPanel>
      )}
    </div>
  );
}
