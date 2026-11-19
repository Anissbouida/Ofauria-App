import { useState, type ReactNode } from 'react';

const frDate = (raw: unknown) => { const s = isoDate(raw); return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : ''; };
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { leavesApi } from '../../../api/employees.api';
import { useReferentiel } from '../../../hooks/useReferentiel';
import { Plus, Users, CalendarOff, Check, X, Hourglass, Trash2 } from 'lucide-react';
import { notify } from '../../../components/ui/InlineNotification';
import { getApiErrorMessage } from '../../../utils/api-error';
import { isoDate } from '../shared';
import LeaveRequestForm from '../leaves/LeaveRequestForm';
import LeaveBalancesView from '../leaves/LeaveBalancesView';
import HolidaysView from '../leaves/HolidaysView';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { StatusTag } from '../../../components/ui/StatusTag';
import { EmptyPanel, LoadingPanel, Segmented } from '../ui';
import { FilterChips } from '../../sales/ListTemplate';

const LEAVE_STAGES = [
  { key: 'pending', label: 'En attente', icon: Hourglass },
  { key: 'approved', label: 'Approuvés', icon: Check },
  { key: 'rejected', label: 'Refusés', icon: X },
] as const;
type LeaveView = 'requests' | 'balances' | 'holidays';
const LEAVE_VIEWS: Array<{ key: LeaveView; label: string }> = [{ key: 'requests', label: 'Demandes' }, { key: 'balances', label: 'Soldes' }, { key: 'holidays', label: 'Jours fériés' }];

/* ═══════════════════════ LEAVES TAB ═══════════════════════ */
export default function LeavesTab({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const [view, setView] = useState<LeaveView>('requests');
  // Contrôle segmenté des vues : posé dans la barre d'outils de chaque vue.
  const switcher = <Segmented label="Vue des congés" value={view} onChange={setView} options={LEAVE_VIEWS} />;
  return view === 'requests' ? <LeaveRequests queryClient={queryClient} switcher={switcher} />
    : view === 'balances' ? <LeaveBalancesView switcher={switcher} /> : <HolidaysView switcher={switcher} />;
}

function LeaveRequests({ queryClient, switcher }: { queryClient: ReturnType<typeof useQueryClient>; switcher: ReactNode }) {
  const [showForm, setShowForm] = useState(false);
  // Filtre client par etape du pipeline ('' = toutes les demandes).
  const [stage, setStage] = useState('');
  const confirm = useConfirm();
  const currentYear = new Date().getFullYear();
  const { getLabel: getLeaveLabel } = useReferentiel('leave_types');
  const { data: leaves = [], isLoading } = useQuery({
    queryKey: ['leaves', currentYear],
    queryFn: () => leavesApi.list({ year: String(currentYear) }),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => leavesApi.approve(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['leaves'] }); queryClient.invalidateQueries({ queryKey: ['leave-balances'] }); notify.success('Congé approuvé'); },
    onError: (err: unknown) => notify.error(getApiErrorMessage(err, 'Erreur lors de l\'approbation')),
  });
  const rejectMutation = useMutation({
    mutationFn: (id: string) => leavesApi.reject(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['leaves'] }); notify.success('Congé refusé'); },
    onError: (err: unknown) => notify.error(getApiErrorMessage(err, 'Erreur lors du refus')),
  });
  const removeMutation = useMutation({
    mutationFn: (id: string) => leavesApi.remove(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['leaves'] }); queryClient.invalidateQueries({ queryKey: ['leave-balances'] }); notify.success('Congé supprimé'); },
    onError: (err: unknown) => notify.error(getApiErrorMessage(err, 'Erreur lors de la suppression')),
  });

  const leavesList = leaves as Record<string, any>[];
  const pendingCount = leavesList.filter(l => l.status === 'pending').length;
  const approvedCount = leavesList.filter(l => l.status === 'approved').length;
  const rejectedCount = leavesList.filter(l => l.status === 'rejected').length;
  const daysOf = (st: string) => leavesList.filter(l => l.status === st).reduce((a, l) => a + (parseFloat(String(l.days)) || 0), 0);
  const stageCount: Record<string, number> = { pending: pendingCount, approved: approvedCount, rejected: rejectedCount };
  const visible = stage ? leavesList.filter(l => l.status === stage) : leavesList;

  return (
    <>
      {/* Barre d'outils (vues + action) puis pastilles de statut avec compteurs : clic = filtrer la liste */}
      <div className="prj-toolbar">
        {switcher}
        <span className="hr-spacer" />
        <button onClick={() => setShowForm(true)} className="odoo-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} /> Nouvelle demande
        </button>
      </div>
      <div className="prj-toolbar">
        <FilterChips label="Statut des demandes" value={stage} onChange={setStage}
          chips={[{ key: '', label: 'Toutes', count: leavesList.length }, ...LEAVE_STAGES.map(st => ({ key: st.key, label: st.label, icon: st.icon, count: stageCount[st.key] }))]} />
        <span className="hr-spacer" />
        <small style={{ color: 'var(--theme-text-muted)', fontSize: 13 }}>
          Demandes de congé {currentYear} · {daysOf('pending')} j en attente · {daysOf('approved')} j approuvés · {daysOf('rejected')} j refusés
        </small>
      </div>

      {isLoading ? (
        <LoadingPanel />
      ) : leavesList.length === 0 ? (
        <EmptyPanel icon={CalendarOff}>Aucun congé pour cette année</EmptyPanel>
      ) : visible.length === 0 ? (
        <EmptyPanel icon={CalendarOff}>Aucune demande avec ce statut</EmptyPanel>
      ) : (
        <div className="prj-panel hr-plain"><div className="prj-scroll">
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}></th>
                <th>Employé</th>
                <th>Type</th>
                <th>Période</th>
                <th style={{ textAlign: 'center' }}>Jours</th>
                <th>Motif</th>
                <th>Statut</th>
                <th style={{ textAlign: 'center', width: 80 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(l => (
                <tr key={l.id as string} className={l.status === 'pending' ? 'row-warning' : ''}>
                  <td>
                    <span className={`odoo-status-dot ${l.status === 'approved' ? 'ok' : l.status === 'rejected' ? 'danger' : 'warning'}`} />
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                      <Users size={11} style={{ color: 'var(--theme-accent)' }} />
                      {l.first_name as string} {l.last_name as string}
                    </span>
                  </td>
                  <td>{getLeaveLabel(l.type as string)}</td>
                  <td style={{ color: 'var(--odoo-text-muted)' }}>
                    {frDate(l.start_date)} — {frDate(l.end_date)}
                  </td>
                  <td style={{ textAlign: 'center', fontWeight: 600 }}>{parseFloat(String(l.days))}</td>
                  <td style={{ color: 'var(--odoo-text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.reason as string || '—'}
                  </td>
                  <td>
                    <StatusTag
                      tone={l.status === 'approved' ? 'done' : l.status === 'rejected' ? 'blocked' : 'todo'}
                      label={l.status === 'pending' ? 'En attente' : l.status === 'approved' ? 'Approuvé' : 'Refusé'}
                    />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'inline-flex', gap: 2 }}>
                      {l.status === 'pending' && (
                        <>
                          <button onClick={async () => {
                            if (!(await confirm(`Approuver le conge de ${l.first_name} ${l.last_name} du ${frDate(l.start_date)} au ${frDate(l.end_date)} (${l.days as number} j) ?`,
                              { title: 'Approuver le congé', confirmLabel: 'Approuver' }))) return;
                            approveMutation.mutate(l.id as string);
                          }}
                            className="odoo-pager-btn" title="Approuver" style={{ color: 'var(--prj-green)' }}>
                            <Check size={14} />
                          </button>
                          <button onClick={async () => { if (await confirm(`Refuser le congé de ${l.first_name} ${l.last_name} ?`, { title: 'Refuser la demande', confirmLabel: 'Refuser', danger: true })) rejectMutation.mutate(l.id as string); }}
                            className="odoo-pager-btn" title="Refuser" style={{ color: 'var(--prj-red)' }}>
                            <X size={14} />
                          </button>
                        </>
                      )}
                      {/* Suppression : possible sur tous statuts. Un conge approuve
                          peut avoir ete accorde par erreur (dates incorrectes) ;
                          la suppression re-libere les jours dans la balance. */}
                      <button onClick={async () => {
                        if (!(await confirm(`Supprimer definitivement ce conge (${l.first_name} ${l.last_name}, ${l.days as number} j) ?\n\nSi le conge etait approuve, les jours seront re-credites dans la balance.`,
                          { title: 'Supprimer le congé', confirmLabel: 'Supprimer', danger: true }))) return;
                        removeMutation.mutate(l.id as string);
                      }}
                        className="odoo-pager-btn" title="Supprimer" style={{ color: 'var(--odoo-text-muted)' }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}

      {showForm && <LeaveRequestForm onClose={() => setShowForm(false)} />}
    </>
  );
}
