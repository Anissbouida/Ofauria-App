import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Check } from 'lucide-react';
import { leavesApi } from '../../../api/employees.api';
import { notify } from '../../../components/ui/InlineNotification';
import { useAuth } from '../../../context/AuthContext';
import { apiErrorMessage } from '../shared';

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
      <div className="odoo-search-panel" style={{ justifyContent: 'space-between' }}>
        <input type="number" className="input" style={{ width: 96 }} value={year} onChange={e => setYear(parseInt(e.target.value, 10))} />
        {isAdmin && !draft && (
          <button className="odoo-btn-primary" onClick={() => setDraft({ date: `${year}-01-01`, label: '' })} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Plus size={13} /> Ajouter un jour férié
          </button>
        )}
      </div>
      {draft && (
        <div className="flex gap-2 items-end">
          <label className="text-xs">Date<input type="date" className="input" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} /></label>
          <label className="text-xs" style={{ flex: 1 }}>Libellé<input className="input" value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} /></label>
          <button className="odoo-btn-primary" disabled={!draft.label || upsert.isPending} onClick={() => upsert.mutate({ ...draft, isConfirmed: true })}>OK</button>
          <button className="odoo-btn-secondary" onClick={() => setDraft(null)}>Annuler</button>
        </div>
      )}
      {isLoading ? <p style={{ color: 'var(--odoo-text-muted)', fontSize: '0.8125rem' }}>Chargement...</p> : (
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
                        onClick={() => { if (confirm(`Supprimer « ${h.label} » ? Pour déplacer une fête religieuse, supprimez puis ajoutez la bonne date.`)) remove.mutate(iso(h.holiday_date)); }}><Trash2 size={13} /></button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--odoo-text-muted)' }}>Aucun jour férié saisi pour {year}.</td></tr>}
          </tbody>
        </table>
      )}
    </>
  );
}
