import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { employeesApi, leavesApi } from '../../../api/employees.api';
import { useReferentiel } from '../../../hooks/useReferentiel';
import { format } from 'date-fns';
import { Plus, Users, CalendarOff, Check, X, AlertTriangle } from 'lucide-react';
import { notify } from '../../../components/ui/InlineNotification';
import { getApiErrorMessage } from '../../../utils/api-error';

/* ═══════════════════════ LEAVES TAB ═══════════════════════ */
export default function LeavesTab({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const [showForm, setShowForm] = useState(false);
  const currentYear = new Date().getFullYear();
  const { entries: leaveTypes, getLabel: getLeaveLabel } = useReferentiel('leave_types');

  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: employeesApi.list });
  const { data: leaves = [], isLoading } = useQuery({
    queryKey: ['leaves', currentYear],
    queryFn: () => leavesApi.list({ year: String(currentYear) }),
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, any>) => leavesApi.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['leaves'] }); notify.success('Congé ajouté'); setShowForm(false); },
    onError: () => notify.error('Erreur'),
  });
  const approveMutation = useMutation({
    mutationFn: (id: string) => leavesApi.approve(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['leaves'] }); notify.success('Congé approuvé'); },
    onError: (err: unknown) => notify.error(getApiErrorMessage(err, 'Erreur lors de l\'approbation')),
  });
  const rejectMutation = useMutation({
    mutationFn: (id: string) => leavesApi.reject(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['leaves'] }); notify.success('Congé refusé'); },
    onError: (err: unknown) => notify.error(getApiErrorMessage(err, 'Erreur lors du refus')),
  });
  const removeMutation = useMutation({
    mutationFn: (id: string) => leavesApi.remove(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['leaves'] }); notify.success('Congé supprimé'); },
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
                    {format(new Date(l.start_date as string), 'dd/MM/yyyy')} — {format(new Date(l.end_date as string), 'dd/MM/yyyy')}
                  </td>
                  <td style={{ textAlign: 'center', fontWeight: 600 }}>{l.days as number}</td>
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
                            if (confirm(`Approuver le conge de ${l.first_name} ${l.last_name} du ${format(new Date(l.start_date as string), 'dd/MM/yyyy')} au ${format(new Date(l.end_date as string), 'dd/MM/yyyy')} (${l.days as number} j) ?`)) {
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

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold mb-4">Nouvelle demande de congé</h2>
            <form onSubmit={e => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const data = Object.fromEntries(fd) as Record<string, any>;
              const start = new Date(data.startDate as string);
              const end = new Date(data.endDate as string);
              const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
              data.days = diffDays > 0 ? diffDays : 1;
              createMutation.mutate(data);
            }} className="space-y-4">
              <div><label className="block text-sm font-medium mb-1">Employé *</label>
                <select name="employeeId" className="input" required>
                  <option value="">Choisir...</option>
                  {(employees as Record<string, any>[]).filter(e => e.is_active).map(e => (
                    <option key={e.id as string} value={e.id as string}>{e.first_name as string} {e.last_name as string}</option>
                  ))}
                </select></div>
              <div><label className="block text-sm font-medium mb-1">Type *</label>
                <select name="type" className="input" required>
                  {leaveTypes.map(lt => <option key={lt.code} value={lt.code}>{lt.label}</option>)}
                </select></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Du *</label><input name="startDate" type="date" className="input" required /></div>
                <div><label className="block text-sm font-medium mb-1">Au *</label><input name="endDate" type="date" className="input" required /></div>
              </div>
              <div><label className="block text-sm font-medium mb-1">Motif</label><textarea name="reason" rows={2} className="input" /></div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Annuler</button>
                <button type="submit" disabled={createMutation.isPending} className="btn-primary">Enregistrer</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
