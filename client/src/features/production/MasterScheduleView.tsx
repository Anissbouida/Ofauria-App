import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { CalendarDays, Loader2, Save, Search } from 'lucide-react';
import { productionApi } from '../../api/production.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
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
  const { data, isLoading } = useQuery({ queryKey: ['master-schedule', today], queryFn: () => productionApi.masterSchedule(today, 8) });
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

  if (isLoading || !data) return <Loader2 className="animate-spin" size={18} />;
  const changes = Object.keys(draft).length;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <StatusBanner tone="info" icon={CalendarDays} title="Plan par semaine">
        Saisissez ce que vous prévoyez de produire chaque semaine. En gris, la prévision de vente : laissez la case vide pour la garder.
        Le calcul des besoins phasé lit ce plan à la place de la prévision.
      </StatusBanner>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--odoo-border)', borderRadius: 4, padding: '4px 8px' }}>
          <Search size={13} aria-hidden />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher un article" aria-label="Rechercher un article"
            style={{ border: 0, outline: 'none', background: 'transparent', fontSize: '0.875rem' }} />
        </label>
        <div style={{ flex: 1 }} />
        {canEdit && (
          <>
            <button type="button" className="odoo-btn-secondary" disabled={!changes} onClick={() => setDraft({})}>Annuler</button>
            <button type="button" className="odoo-btn-primary" disabled={!changes || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Enregistrer{changes ? ` (${changes})` : ''}
            </button>
          </>
        )}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead><tr><th>Article</th>{data.weeks.map(w => <th key={w} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{wk(w)}</th>)}</tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.product_id}>
              <td><div style={{ fontWeight: 500 }}>{r.product_name}</div>{r.category_name && <div style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>{r.category_name}</div>}</td>
              {data.weeks.map(w => {
                const v = r.weeks[w];
                const k = cell(r.product_id, w);
                const value = k in draft ? draft[k] : v.planned;
                return (
                  <td key={w} style={{ textAlign: 'right' }}>
                    <input type="number" min={0} step="any" className="input" disabled={!canEdit}
                      value={value ?? ''} placeholder={v.forecast ? nf(v.forecast) : '0'}
                      aria-label={`${r.product_name}, ${wk(w)}`}
                      style={{ width: 84, textAlign: 'right', padding: '2px 6px', fontWeight: value != null ? 600 : 400 }}
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
      </div>
    </div>
  );
}
