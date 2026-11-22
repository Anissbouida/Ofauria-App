import { useState, type ReactNode } from 'react';

const frDate = (raw: unknown) => { const s = isoDate(raw); return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : ''; };
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { leavesApi } from '../../../api/employees.api';
import { useReferentiel } from '../../../hooks/useReferentiel';
import { Plus, CalendarOff, Check, X, Hourglass, Trash2 } from 'lucide-react';
import { notify } from '../../../components/ui/InlineNotification';
import { getApiErrorMessage } from '../../../utils/api-error';
import { isoDate } from '../shared';
import LeaveRequestForm from '../leaves/LeaveRequestForm';
import LeaveBalancesView from '../leaves/LeaveBalancesView';
import HolidaysView from '../leaves/HolidaysView';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { StatusTag } from '../../../components/ui/StatusTag';
import { RowMenu } from '../../../components/ui/RowMenu';
import { EmptyPanel, LoadingPanel, Segmented, HrHeaderActions } from '../ui';
import { Toolbar, DataPanel, TableFooter, NoResultState, ErrorState } from '../../../components/ds';
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
  const { data: leaves = [], isLoading, isError, refetch } = useQuery({
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
      {/* Action principale de la page, à droite du fil d'Ariane. */}
      <HrHeaderActions>
        <button type="button" onClick={() => setShowForm(true)} className="odoo-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} aria-hidden="true" /> Nouvelle demande
        </button>
      </HrHeaderActions>

      {/* Pastilles de statut avec compteurs (clic = filtrer), puis barre d'outils : résumé et bascule de vue. */}
      <FilterChips label="Statut des demandes" value={stage} onChange={setStage}
        chips={[{ key: '', label: 'Toutes', count: leavesList.length }, ...LEAVE_STAGES.map(st => ({ key: st.key, label: st.label, icon: st.icon, count: stageCount[st.key] }))]} />
      <Toolbar>
        <span className="hr-tools-label">
          Demandes de congé {currentYear} · {daysOf('pending')} j en attente · {daysOf('approved')} j approuvés · {daysOf('rejected')} j refusés
        </span>
        {switcher}
      </Toolbar>

      {isLoading ? (
        <LoadingPanel />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : leavesList.length === 0 ? (
        <EmptyPanel icon={CalendarOff}>Aucun congé pour cette année</EmptyPanel>
      ) : visible.length === 0 ? (
        <NoResultState text="Aucune demande avec ce statut." onReset={() => setStage('')} />
      ) : (
        <DataPanel label="Demandes de congé" footer={<TableFooter note={`${visible.length} demande${visible.length > 1 ? 's' : ''}`} />}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th>Employé</th>
                <th>Type</th>
                <th>Période</th>
                <th className="ds-num">Durée (j)</th>
                <th>Motif</th>
                <th>Statut</th>
                <th className="ds-actions"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(l => {
                const who = `${l.first_name} ${l.last_name}`;
                const approve = async () => {
                  if (!(await confirm(`Approuver le congé de ${who} du ${frDate(l.start_date)} au ${frDate(l.end_date)} (${l.days as number} j) ?`,
                    { title: 'Approuver le congé', confirmLabel: 'Approuver' }))) return;
                  approveMutation.mutate(l.id as string);
                };
                const reject = async () => {
                  if (await confirm(`Refuser le congé de ${who} ?`, { title: 'Refuser la demande', confirmLabel: 'Refuser', danger: true })) rejectMutation.mutate(l.id as string);
                };
                // Suppression possible sur tous les statuts : un congé approuvé par erreur
                // (dates incorrectes) se supprime, ce qui re-crédite les jours dans le solde.
                const remove = async () => {
                  if (!(await confirm(`Supprimer définitivement ce congé (${who}, ${l.days as number} j) ?\n\nSi le congé était approuvé, les jours seront re-crédités dans le solde.`,
                    { title: 'Supprimer le congé', confirmLabel: 'Supprimer', danger: true }))) return;
                  removeMutation.mutate(l.id as string);
                };
                return (
                <tr key={l.id as string}>
                  <td className="ds-strong">{who}</td>
                  <td>{getLeaveLabel(l.type as string)}</td>
                  <td>{frDate(l.start_date)} — {frDate(l.end_date)}</td>
                  <td className="ds-num ds-strong">{parseFloat(String(l.days))}</td>
                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.reason as string || undefined}>
                    {l.reason as string || '—'}
                  </td>
                  <td>
                    <StatusTag
                      tone={l.status === 'approved' ? 'done' : l.status === 'rejected' ? 'blocked' : 'todo'}
                      label={l.status === 'pending' ? 'En attente' : l.status === 'approved' ? 'Approuvé' : 'Refusé'}
                    />
                  </td>
                  <td className="ds-actions">
                    {l.status === 'pending' && (
                      <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => void approve()}><Check size={13} aria-hidden="true" /> Approuver</button>
                    )}
                    <RowMenu label={`Plus d'actions pour la demande de ${who}`} items={[
                      ...(l.status === 'pending' ? [{ label: 'Refuser', icon: X, danger: true, onSelect: () => void reject() }] : []),
                      { label: 'Supprimer', icon: Trash2, danger: true, onSelect: () => void remove() },
                    ]} />
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </DataPanel>
      )}

      {showForm && <LeaveRequestForm onClose={() => setShowForm(false)} />}
    </>
  );
}
