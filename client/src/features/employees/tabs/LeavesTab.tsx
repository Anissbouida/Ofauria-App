import { useState } from 'react';

const frDate = (raw: unknown) => { const s = isoDate(raw); return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : ''; };
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { leavesApi } from '../../../api/employees.api';
import { useReferentiel } from '../../../hooks/useReferentiel';
import { Plus, Users, CalendarOff, Check, X, Hourglass, Loader2, Trash2 } from 'lucide-react';
import { notify } from '../../../components/ui/InlineNotification';
import { getApiErrorMessage } from '../../../utils/api-error';
import { isoDate } from '../shared';
import LeaveRequestForm from '../leaves/LeaveRequestForm';
import LeaveBalancesView from '../leaves/LeaveBalancesView';
import HolidaysView from '../leaves/HolidaysView';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { StagePipeline, type StageDef } from '../../../components/purchasing/ProcessBoard';
import { EmptyState } from '../ui';

const LEAVE_STAGES: StageDef[] = [
  { key: 'pending', label: 'En attente', hint: 'à valider', icon: Hourglass },
  { key: 'approved', label: 'Approuvés', hint: 'congés accordés', icon: Check },
  { key: 'rejected', label: 'Refusés', hint: 'demandes rejetées', icon: X },
];
const LEAVE_VIEWS = [['requests', 'Demandes'], ['balances', 'Soldes'], ['holidays', 'Jours fériés']] as const;

/* ═══════════════════════ LEAVES TAB ═══════════════════════ */
export default function LeavesTab({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const [view, setView] = useState<'requests' | 'balances' | 'holidays'>('requests');
  return (
    <>
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8 }}>
        <div className="odoo-view-switcher" role="tablist" aria-label="Vue des congés">
          {LEAVE_VIEWS.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)}
              style={{
                padding: '0.3rem 0.75rem', fontSize: '0.8125rem',
                background: view === key ? 'var(--odoo-purple-light)' : 'transparent',
                color: view === key ? 'var(--odoo-purple)' : 'var(--odoo-text-muted)',
                fontWeight: view === key ? 600 : 400,
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {view === 'requests' ? <LeaveRequests queryClient={queryClient} />
        : view === 'balances' ? <LeaveBalancesView /> : <HolidaysView />}
    </>
  );
}

function LeaveRequests({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
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
  const stageStats = {
    pending: { count: pendingCount, sub: `${daysOf('pending')} j` },
    approved: { count: approvedCount, sub: `${daysOf('approved')} j` },
    rejected: { count: rejectedCount, sub: `${daysOf('rejected')} j` },
  };
  const visible = stage ? leavesList.filter(l => l.status === stage) : leavesList;

  return (
    <>
      {/* Pipeline des demandes : clic = filtrer la liste */}
      <StagePipeline
        title={`Demandes de congé ${currentYear}`}
        summary={`${leavesList.length} demande${leavesList.length > 1 ? 's' : ''} sur l'année`}
        stages={LEAVE_STAGES}
        stats={stageStats}
        isActive={k => stage === k}
        onPick={k => setStage(cur => (cur === k ? '' : k))}
      />

      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8 }}>
        {stage && (
          <span className="odoo-tag odoo-tag-blue" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Statut : {LEAVE_STAGES.find(x => x.key === stage)?.label}
            <button type="button" onClick={() => setStage('')} aria-label="Retirer le filtre de statut" style={{ display: 'inline-flex' }}>
              <X size={11} />
            </button>
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowForm(true)} className="odoo-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} /> Nouvelle demande
        </button>
      </div>

      {isLoading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Loader2 className="animate-spin" size={20} style={{ margin: '0 auto 8px' }} />
          <p style={{ fontSize: '0.8125rem' }}>Chargement...</p>
        </div>
      ) : leavesList.length === 0 ? (
        <EmptyState icon={CalendarOff}>Aucun congé pour cette année</EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState icon={CalendarOff}>Aucune demande avec ce statut</EmptyState>
      ) : (
        <div style={{ overflowX: 'auto' }}>
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
                    <span className={`odoo-tag ${
                      l.status === 'approved' ? 'odoo-tag-green' :
                      l.status === 'rejected' ? 'odoo-tag-red' :
                      'odoo-tag-yellow'
                    }`}>
                      {l.status === 'pending' ? 'En attente' : l.status === 'approved' ? 'Approuvé' : 'Refusé'}
                    </span>
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
                            className="odoo-pager-btn" title="Approuver" style={{ color: '#28a745' }}>
                            <Check size={14} />
                          </button>
                          <button onClick={async () => { if (await confirm(`Refuser le congé de ${l.first_name} ${l.last_name} ?`, { title: 'Refuser la demande', confirmLabel: 'Refuser', danger: true })) rejectMutation.mutate(l.id as string); }}
                            className="odoo-pager-btn" title="Refuser" style={{ color: '#dc3545' }}>
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
        </div>
      )}

      {showForm && <LeaveRequestForm onClose={() => setShowForm(false)} />}
    </>
  );
}
