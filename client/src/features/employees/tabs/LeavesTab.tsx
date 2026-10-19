import { useState } from 'react';

const frDate = (raw: unknown) => { const s = isoDate(raw); return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : ''; };
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { leavesApi } from '../../../api/employees.api';
import { useReferentiel } from '../../../hooks/useReferentiel';
import { Plus, Users, CalendarOff, Check, X, AlertTriangle } from 'lucide-react';
import { notify } from '../../../components/ui/InlineNotification';
import { getApiErrorMessage } from '../../../utils/api-error';
import { isoDate } from '../shared';
import LeaveRequestForm from '../leaves/LeaveRequestForm';
import LeaveBalancesView from '../leaves/LeaveBalancesView';
import HolidaysView from '../leaves/HolidaysView';

/* ═══════════════════════ LEAVES TAB ═══════════════════════ */
export default function LeavesTab({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const [view, setView] = useState<'requests' | 'balances' | 'holidays'>('requests');
  return (
    <>
      <div className="odoo-search-panel" style={{ justifyContent: 'flex-start' }}>
        <div className="odoo-view-switcher">
          <button onClick={() => setView('requests')} className={view === 'requests' ? 'active' : ''}>Demandes</button>
          <button onClick={() => setView('balances')} className={view === 'balances' ? 'active' : ''}>Soldes</button>
          <button onClick={() => setView('holidays')} className={view === 'holidays' ? 'active' : ''}>Jours fériés</button>
        </div>
      </div>
      {view === 'requests' ? <LeaveRequests queryClient={queryClient} />
        : view === 'balances' ? <LeaveBalancesView /> : <HolidaysView />}
    </>
  );
}

function LeaveRequests({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const [showForm, setShowForm] = useState(false);
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

  return (
    <>
      {/* Stat tiles */}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><CalendarOff size={11} style={{ display: 'inline', marginRight: 4 }} />Demandes {currentYear}</div>
          <div className="odoo-stat-card-value">{leavesList.length}</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><AlertTriangle size={11} style={{ display: 'inline', marginRight: 4 }} />En attente</div>
          <div className="odoo-stat-card-value" style={{ color: pendingCount > 0 ? '#b08504' : undefined }}>{pendingCount}</div>
          <div className="odoo-stat-card-sub">à valider</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Check size={11} style={{ display: 'inline', marginRight: 4 }} />Approuvés</div>
          <div className="odoo-stat-card-value" style={{ color: approvedCount > 0 ? '#28a745' : undefined }}>{approvedCount}</div>
        </div>
      </div>

      <div className="odoo-search-panel">
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowForm(true)} className="odoo-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} /> Nouvelle demande
        </button>
      </div>

      {isLoading ? (
        <p style={{ color: 'var(--odoo-text-muted)', fontSize: '0.8125rem' }}>Chargement...</p>
      ) : leavesList.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--odoo-text-muted)' }}>
          <CalendarOff size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>Aucun congé pour cette année</p>
        </div>
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
              {leavesList.map(l => (
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
                          <button onClick={() => {
                            if (confirm(`Approuver le conge de ${l.first_name} ${l.last_name} du ${frDate(l.start_date)} au ${frDate(l.end_date)} (${l.days as number} j) ?`)) {
                              approveMutation.mutate(l.id as string);
                            }
                          }}
                            className="odoo-pager-btn" title="Approuver" style={{ color: '#28a745' }}>
                            <Check size={14} />
                          </button>
                          <button onClick={() => rejectMutation.mutate(l.id as string)}
                            className="odoo-pager-btn" title="Refuser" style={{ color: '#dc3545' }}>
                            <X size={14} />
                          </button>
                        </>
                      )}
                      {/* Suppression : possible sur tous statuts. Un conge approuve
                          peut avoir ete accorde par erreur (dates incorrectes) ;
                          la suppression re-libere les jours dans la balance. */}
                      <button onClick={() => {
                        if (confirm(`Supprimer definitivement ce conge (${l.first_name} ${l.last_name}, ${l.days as number} j) ?\n\nSi le conge etait approuve, les jours seront re-credites dans la balance.`)) {
                          removeMutation.mutate(l.id as string);
                        }
                      }}
                        className="odoo-pager-btn" title="Supprimer" style={{ color: 'var(--odoo-text-muted)' }}>
                        <X size={14} />
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
