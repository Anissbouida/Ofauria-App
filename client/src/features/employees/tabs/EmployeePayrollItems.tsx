import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, ListPlus } from 'lucide-react';
import { payrollConfigApi } from '../../../api/employees.api';
import { notify } from '../../../components/ui/InlineNotification';
import { apiErrorMessage, isoDate } from '../shared';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { SectionTitle, inputCls, smallBtn } from '../ui';

/**
 * Éléments fixes de paie d'un employé (indemnité de transport, prime de
 * rendement mensuelle, remboursement de prêt…) : repris automatiquement sur
 * chaque bulletin mensuel de leur période de validité.
 */
export default function EmployeePayrollItems({ employeeId }: { employeeId: string }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data: items = [], isLoading } = useQuery<Record<string, any>[]>({
    queryKey: ['employee-payroll-items', employeeId],
    queryFn: () => payrollConfigApi.items(employeeId),
  });
  const { data: rubriques = [] } = useQuery<Record<string, any>[]>({
    queryKey: ['payroll-rubriques'],
    queryFn: () => payrollConfigApi.rubriques(),
  });
  const [draft, setDraft] = useState<{ rubriqueId: string; amount: string; startDate: string; endDate: string } | null>(null);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['employee-payroll-items', employeeId] });

  const create = useMutation({
    mutationFn: () => payrollConfigApi.createItem(employeeId, {
      rubriqueId: draft!.rubriqueId, amount: parseFloat(draft!.amount),
      startDate: draft!.startDate || null, endDate: draft!.endDate || null,
    }),
    onSuccess: () => { invalidate(); setDraft(null); notify.success('Élément fixe ajouté (appliqué à la prochaine génération)'); },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur')),
  });
  // Arreter un element = fixer sa date de fin (l'historique des bulletins reste juste).
  const stop = useMutation({
    mutationFn: (id: string) => payrollConfigApi.updateItem(id, { endDate: new Date().toISOString().slice(0, 10) }),
    onSuccess: () => { invalidate(); notify.success('Élément arrêté à aujourd\'hui'); },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => payrollConfigApi.removeItem(id),
    onSuccess: () => { invalidate(); notify.success('Élément supprimé'); },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur')),
  });

  const today = new Date().toISOString().slice(0, 10);
  const fr = (d: unknown) => { const s = isoDate(d); return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : ''; };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <SectionTitle icon={ListPlus} actions={!draft && (
        <button type="button" className="odoo-btn-secondary" style={smallBtn}
          onClick={() => setDraft({ rubriqueId: '', amount: '', startDate: today, endDate: '' })}>
          <Plus size={11} /> Ajouter
        </button>
      )}>Éléments fixes de paie</SectionTitle>
      {isLoading ? <p style={muted}>Chargement...</p> : items.length === 0 && !draft ? (
        <p style={muted}>Aucun élément fixe (transport, prime mensuelle, prêt…).</p>
      ) : (
        <table className="odoo-table">
          <thead><tr><th>Rubrique</th><th style={{ textAlign: 'right' }}>Montant</th><th>Période</th><th style={{ width: 60 }}></th></tr></thead>
          <tbody>
            {items.map(i => {
              const ended = i.end_date && isoDate(i.end_date) < today;
              return (
                <tr key={i.id} style={{ opacity: ended ? 0.5 : 1 }}>
                  <td>{i.kind === 'retenue' ? '− ' : '+ '}{i.rubrique_label}</td>
                  <td style={{ textAlign: 'right' }}>{parseFloat(i.amount).toFixed(2)} DH</td>
                  <td style={{ fontSize: '0.75rem' }}>{fr(i.start_date)} → {i.end_date ? fr(i.end_date) : 'en cours'}</td>
                  <td>
                    <div style={{ display: 'inline-flex', gap: 2 }}>
                      {!i.end_date && (
                        <button className="odoo-pager-btn" title="Arrêter à aujourd'hui" disabled={stop.isPending}
                          onClick={async () => { if (!(await confirm('Arrêter cet élément fixe à aujourd\'hui ?', { title: 'Arrêter l\'élément fixe', confirmLabel: 'Arrêter' }))) return; stop.mutate(i.id); }}>■</button>
                      )}
                      <button className="odoo-pager-btn" title="Supprimer" style={{ color: '#dc3545' }} disabled={remove.isPending}
                        onClick={async () => { if (!(await confirm('Supprimer cet élément fixe ? Les bulletins déjà calculés ne changent pas tant qu\'ils ne sont pas régénérés.', { title: 'Supprimer l\'élément fixe', confirmLabel: 'Supprimer', danger: true }))) return; remove.mutate(i.id); }}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {draft && (
              <tr>
                <td>
                  <select className={inputCls} value={draft.rubriqueId} onChange={e => setDraft({ ...draft, rubriqueId: e.target.value })}>
                    <option value="">Rubrique...</option>
                    {rubriques.map(r => <option key={r.id} value={r.id}>{r.kind === 'retenue' ? '− ' : '+ '}{r.label}</option>)}
                  </select>
                </td>
                <td><input className={inputCls} type="number" min="0" step="0.01" value={draft.amount} style={{ width: 90 }} onChange={e => setDraft({ ...draft, amount: e.target.value })} /></td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input className={inputCls} type="date" value={draft.startDate} onChange={e => setDraft({ ...draft, startDate: e.target.value })} />
                    <input className={inputCls} type="date" value={draft.endDate} title="Fin (optionnelle)" onChange={e => setDraft({ ...draft, endDate: e.target.value })} />
                  </div>
                </td>
                <td>
                  <div style={{ display: 'inline-flex', gap: 2 }}>
                    <button type="button" className="odoo-btn-primary" style={smallBtn}
                      disabled={!draft.rubriqueId || !(parseFloat(draft.amount) > 0) || create.isPending} onClick={() => create.mutate()}>OK</button>
                    <button type="button" className="odoo-btn-secondary" style={smallBtn} onClick={() => setDraft(null)}>✕</button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

const muted = { fontSize: '0.8125rem', color: 'var(--odoo-text-muted)', margin: 0 } as const;
