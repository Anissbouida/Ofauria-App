import { useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Check, CalendarRange, CalendarDays } from 'lucide-react';
import { leavesApi } from '../../../api/employees.api';
import { notify } from '../../../components/ui/InlineNotification';
import { useAuth } from '../../../context/AuthContext';
import { apiErrorMessage } from '../shared';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { StatusTag } from '../../../components/ui/StatusTag';
import { Field, EmptyPanel, LoadingPanel, HrHeaderActions, inputCls, panel } from '../ui';
import { Toolbar, DataPanel, TableFooter, ErrorState } from '../../../components/ds';

/**
 * Jours fériés : non décomptés d'un congé en jours ouvrables (art. 232).
 * Les fêtes religieuses suivent le calendrier lunaire : à confirmer à
 * l'annonce officielle (badge « à confirmer »).
 */
export default function HolidaysView({ switcher }: { switcher?: ReactNode } = {}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [year, setYear] = useState(new Date().getFullYear());
  const confirm = useConfirm();
  const [draft, setDraft] = useState<{ date: string; label: string } | null>(null);
  const { data: rows = [], isLoading, isError, refetch } = useQuery<Record<string, any>[]>({
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
      {isAdmin && (
        <HrHeaderActions>
          <button type="button" className="odoo-btn-primary" disabled={!!draft} onClick={() => setDraft({ date: `${year}-01-01`, label: '' })} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Plus size={13} aria-hidden="true" /> Ajouter un jour férié
          </button>
        </HrHeaderActions>
      )}
      <Toolbar>
        <label className="hr-tools">
          <CalendarRange size={14} aria-hidden="true" style={{ color: 'var(--ds-muted)' }} /> <span className="hr-tools-label">Année</span>
          <input type="number" className="odoo-filter-dropdown" style={{ width: 96 }} value={year} onChange={e => setYear(parseInt(e.target.value, 10))} />
        </label>
        {switcher}
      </Toolbar>
      {draft && (
        <div style={{ ...panel, display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label="Date" required><input type="date" className={inputCls} value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} /></Field>
          <Field label="Libellé" required style={{ flex: 1, minWidth: 200 }}><input className={inputCls} value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} /></Field>
          <button type="button" className="odoo-btn-secondary" onClick={() => setDraft(null)}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={!draft.label || upsert.isPending} onClick={() => upsert.mutate({ ...draft, isConfirmed: true })}>Enregistrer</button>
        </div>
      )}
      {isLoading ? (
        <LoadingPanel />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : !rows.length ? (
        <EmptyPanel icon={CalendarDays}>Aucun jour férié saisi pour {year}.</EmptyPanel>
      ) : (
        <DataPanel label="Jours fériés" footer={<TableFooter note={`${rows.length} jour${rows.length > 1 ? 's' : ''} férié${rows.length > 1 ? 's' : ''} en ${year}`} />}>
        <table className="odoo-table">
          <thead><tr><th>Date</th><th>Jour</th><th>Libellé</th><th>Statut</th>{isAdmin && <th className="ds-actions"><span className="sr-only">Actions</span></th>}</tr></thead>
          <tbody>
            {rows.map(h => (
              <tr key={iso(h.holiday_date)}>
                <td>{new Date(`${iso(h.holiday_date)}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                <td>{new Date(`${iso(h.holiday_date)}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'long' })}</td>
                <td className="ds-strong">{h.label}</td>
                <td>{h.is_confirmed ? <StatusTag tone="done" label="Confirmé" /> : <StatusTag tone="todo" label="Date à confirmer" />}</td>
                {isAdmin && (
                  <td className="ds-actions">
                    {!h.is_confirmed && (
                      <button type="button" className="odoo-btn-secondary ds-btn-sm"
                        onClick={() => upsert.mutate({ date: iso(h.holiday_date), label: h.label, isConfirmed: true })}><Check size={13} aria-hidden="true" /> Confirmer</button>
                    )}
                    <button type="button" className="ds-icon-btn" title="Supprimer" aria-label={`Supprimer ${h.label}`}
                      onClick={async () => { if (!(await confirm(`Supprimer « ${h.label} » ? Pour déplacer une fête religieuse, supprimez puis ajoutez la bonne date.`, { title: 'Supprimer le jour férié', confirmLabel: 'Supprimer', danger: true }))) return; remove.mutate(iso(h.holiday_date)); }}><Trash2 size={14} /></button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </DataPanel>
      )}
    </>
  );
}
