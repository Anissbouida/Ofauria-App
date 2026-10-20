import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Check, Loader2, CalendarRange, CalendarDays } from 'lucide-react';
import { leavesApi } from '../../../api/employees.api';
import { notify } from '../../../components/ui/InlineNotification';
import { useAuth } from '../../../context/AuthContext';
import { apiErrorMessage } from '../shared';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { Field, EmptyState, inputCls, panel } from '../ui';

/**
 * Jours fériés : non décomptés d'un congé en jours ouvrables (art. 232).
 * Les fêtes religieuses suivent le calendrier lunaire : à confirmer à
 * l'annonce officielle (badge « à confirmer »).
 */
export default function HolidaysView() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [year, setYear] = useState(new Date().getFullYear());
  const confirm = useConfirm();
  const [draft, setDraft] = useState<{ date: string; label: string } | null>(null);
  const { data: rows = [], isLoading } = useQuery<Record<string, any>[]>({
    queryKey: ['holidays', year],
    queryFn: () => leavesApi.holidays(year),
  });
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['holidays'] });
    queryClient.invalidateQueries({ queryKey: ['leave-balances'] });
  };
  const upsert = useMutation({
    mutationFn: (d: { date: string; label: string; isConfirmed: boolean }) => leavesApi.upsertHoliday(d),
    onSuccess: () => { invalidate(); setDraft(null); notify.success('Jour férié enregistré'); },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur')),
  });
  const remove = useMutation({
    mutationFn: (date: string) => leavesApi.removeHoliday(date),
    onSuccess: () => { invalidate(); notify.success('Jour férié supprimé'); },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur')),
  });
  const iso = (d: string) => String(d).slice(0, 10);

  return (
    <>
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>
          <CalendarRange size={13} /> Année
          <input type="number" className="odoo-filter-dropdown" style={{ width: 96 }} value={year} onChange={e => setYear(parseInt(e.target.value, 10))} />
        </label>
        <div style={{ flex: 1 }} />
        {isAdmin && !draft && (
          <button className="odoo-btn-primary" onClick={() => setDraft({ date: `${year}-01-01`, label: '' })} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Plus size={13} /> Ajouter un jour férié
          </button>
        )}
      </div>
      {draft && (
        <div style={{ ...panel, display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label="Date"><input type="date" className={inputCls} value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} /></Field>
          <Field label="Libellé" style={{ flex: 1, minWidth: 200 }}><input className={inputCls} value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} /></Field>
          <button className="odoo-btn-secondary" onClick={() => setDraft(null)}>Annuler</button>
          <button className="odoo-btn-primary" disabled={!draft.label || upsert.isPending} onClick={() => upsert.mutate({ ...draft, isConfirmed: true })}>OK</button>
        </div>
      )}
      {isLoading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Loader2 className="animate-spin" size={20} style={{ margin: '0 auto 8px' }} />
          <p style={{ fontSize: '0.8125rem' }}>Chargement...</p>
        </div>
      ) : !rows.length ? (
        <EmptyState icon={CalendarDays}>Aucun jour férié saisi pour {year}.</EmptyState>
      ) : (
        <table className="odoo-table">
          <thead><tr><th>Date</th><th>Jour</th><th>Libellé</th><th>Statut</th>{isAdmin && <th style={{ width: 70 }}></th>}</tr></thead>
          <tbody>
            {rows.map(h => (
              <tr key={iso(h.holiday_date)}>
                <td>{new Date(`${iso(h.holiday_date)}T00:00:00`).toLocaleDateString('fr-FR')}</td>
                <td style={{ color: 'var(--odoo-text-muted)' }}>{new Date(`${iso(h.holiday_date)}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'long' })}</td>
                <td>{h.label}</td>
                <td>{h.is_confirmed ? <span className="odoo-tag odoo-tag-green">Confirmé</span> : <span className="odoo-tag odoo-tag-orange">Date à confirmer</span>}</td>
                {isAdmin && (
                  <td>
                    <div style={{ display: 'inline-flex', gap: 2 }}>
                      {!h.is_confirmed && (
                        <button className="odoo-pager-btn" title="Confirmer la date" style={{ color: '#28a745' }}
                          onClick={() => upsert.mutate({ date: iso(h.holiday_date), label: h.label, isConfirmed: true })}><Check size={13} /></button>
                      )}
                      <button className="odoo-pager-btn" title="Supprimer" style={{ color: '#dc3545' }}
                        onClick={async () => { if (!(await confirm(`Supprimer « ${h.label} » ? Pour déplacer une fête religieuse, supprimez puis ajoutez la bonne date.`, { title: 'Supprimer le jour férié', confirmLabel: 'Supprimer', danger: true }))) return; remove.mutate(iso(h.holiday_date)); }}><Trash2 size={13} /></button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
