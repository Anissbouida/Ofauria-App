import { useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, Trash2, CalendarCheck, Info, History, SlidersHorizontal } from 'lucide-react';
import { leavesApi } from '../../../api/employees.api';
import { notify } from '../../../components/ui/InlineNotification';
import { useAuth } from '../../../context/AuthContext';
import { apiErrorMessage, downloadCsv } from '../shared';
import { StatusBanner } from '../../../components/ui/StatusBanner';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { StatusTag } from '../../../components/ui/StatusTag';
import { HrModal, Field, SectionTitle, EmptyPanel, LoadingPanel, HrHeaderActions, inputCls, panel } from '../ui';
import { Toolbar, DataPanel, TableFooter, ErrorState } from '../../../components/ds';

const d2 = (v: number) => (Math.round(v * 100) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 });

/**
 * Soldes de congés payés : droits acquis de l'année (1,5 j/mois + ancienneté),
 * reliquat reporté, pris, en attente, disponible, et jours qui expirent au
 * 31/12. Détail par année et ajustements (admin) par employé.
 */
export default function LeaveBalancesView({ switcher }: { switcher?: ReactNode } = {}) {
  const { data: rows = [], isLoading, isError, refetch } = useQuery<Record<string, any>[]>({
    queryKey: ['leave-balances'],
    queryFn: () => leavesApi.balances(),
  });
  const [detail, setDetail] = useState<Record<string, any> | null>(null);
  const year = new Date().getFullYear();

  const exportCsv = () => downloadCsv(`soldes_conges_${new Date().toISOString().slice(0, 10)}.csv`,
    ['Employé', 'Embauche', `Acquis ${year}`, 'Reporté', `Pris ${year}`, 'En attente', 'Disponible', `Expire au 31/12/${year}`],
    rows.map(r => [r.name, r.hireDate ?? '', r.acquiredThisYear, r.carriedOver, r.takenThisYear, r.pending, r.available, r.expiringThisYear]));

  return (
    <>
      {/* Export : action secondaire, en haut à droite de la page. */}
      <HrHeaderActions>
        <button type="button" className="odoo-btn-secondary" onClick={exportCsv} disabled={!rows.length} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Download size={13} aria-hidden="true" /> Exporter
        </button>
      </HrHeaderActions>
      <StatusBanner tone="neutral" icon={Info} title="Acquisition des congés payés">
        1,5 jour ouvrable par mois de service, +1,5 jour par 5 ans d'ancienneté (plafond 30 j/an). Un reliquat se cumule sur deux années consécutives.
      </StatusBanner>
      <Toolbar>
        <span className="hr-tools-label">Soldes de congés payés {year}, en jours</span>
        {switcher}
      </Toolbar>
      {isLoading ? (
        <LoadingPanel />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : rows.length === 0 ? (
        <EmptyPanel icon={CalendarCheck}>Aucun solde de congés à afficher</EmptyPanel>
      ) : (
        <DataPanel label="Soldes de congés" footer={<TableFooter note={`${rows.length} employé${rows.length > 1 ? 's' : ''} · cliquer sur une ligne pour le détail par année`} />}>
          <table className="odoo-table">
            <thead><tr>
              <th>Employé</th>
              <th className="ds-num">Acquis {year} (j)</th><th className="ds-num">Reporté (j)</th>
              <th className="ds-num">Pris {year} (j)</th><th className="ds-num">En attente (j)</th>
              <th className="ds-num">Disponible (j)</th><th className="ds-num">Expire au 31/12 (j)</th>
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.employeeId} onClick={() => setDetail(r)} style={{ cursor: 'pointer' }}>
                  <td className="ds-strong">{r.name}{!r.hireDate && <span style={{ marginLeft: 6 }}><StatusTag tone="todo" label="Sans date d'embauche" /></span>}</td>
                  <td className="ds-num">{d2(r.acquiredThisYear)}{r.seniorityBonus > 0 && <span style={{ color: 'var(--ds-muted)', fontSize: 12 }} title="Majoration d'ancienneté annuelle"> (+{d2(r.seniorityBonus)})</span>}</td>
                  <td className="ds-num">{d2(r.carriedOver)}</td>
                  <td className="ds-num">{d2(r.takenThisYear)}</td>
                  <td className="ds-num" style={{ color: r.pending > 0 ? 'var(--ds-warning)' : undefined }}>{d2(r.pending)}</td>
                  <td className="ds-num ds-strong" style={{ color: r.available < 0 ? 'var(--ds-danger)' : undefined }}>{d2(r.available)}</td>
                  <td className="ds-num" style={{ color: r.expiringThisYear > 0 ? 'var(--ds-warning)' : 'var(--ds-muted)' }}>{r.expiringThisYear > 0 ? d2(r.expiringThisYear) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>
      )}
      {detail && <BalanceDetail employee={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function BalanceDetail({ employee, onClose }: { employee: Record<string, any>; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { data: balance } = useQuery<Record<string, any>>({
    queryKey: ['leave-balance', employee.employeeId],
    queryFn: () => leavesApi.balance(employee.employeeId),
  });
  const { data: adjustments = [] } = useQuery<Record<string, any>[]>({
    queryKey: ['leave-adjustments', employee.employeeId],
    queryFn: () => leavesApi.adjustments(employee.employeeId),
  });
  const [adj, setAdj] = useState<{ year: string; days: string; reason: string } | null>(null);
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['leave-balance', employee.employeeId] });
    queryClient.invalidateQueries({ queryKey: ['leave-adjustments', employee.employeeId] });
    queryClient.invalidateQueries({ queryKey: ['leave-balances'] });
  };
  const create = useMutation({
    mutationFn: () => leavesApi.createAdjustment(employee.employeeId, { year: parseInt(adj!.year, 10), days: parseFloat(adj!.days), reason: adj!.reason }),
    onSuccess: () => { invalidate(); setAdj(null); notify.success('Ajustement enregistré'); },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur')),
  });
  const confirm = useConfirm();
  const remove = useMutation({
    mutationFn: (id: string) => leavesApi.removeAdjustment(id),
    onSuccess: () => { invalidate(); notify.success('Ajustement supprimé'); },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur')),
  });

  return (
    <HrModal icon={CalendarCheck} crumb="Solde de congés" title={employee.name} width={760} onClose={onClose}
      tag={<StatusTag tone={balance && balance.available < 0 ? 'blocked' : 'done'} label={`Disponible ${balance ? d2(balance.available) : '…'} j`} />}
      footer={<button type="button" onClick={onClose} className="odoo-btn-secondary">Fermer</button>}>
        <p style={{ fontSize: 13, color: 'var(--ds-muted)', margin: 0 }}>
          Embauché le {employee.hireDate ? new Date(employee.hireDate).toLocaleDateString('fr-FR') : '—'} · disponible {balance ? d2(balance.available) : '…'} j
        </p>
        <SectionTitle icon={History}>Détail par année</SectionTitle>
        <table className="odoo-table">
          <thead><tr>
            <th>Année</th><th className="ds-num">Mois</th><th className="ds-num">Droit annuel (j)</th>
            <th className="ds-num">Acquis (j)</th><th className="ds-num">Ajustements (j)</th><th className="ds-num">Pris (j)</th>
            <th className="ds-num">Expiré (j)</th><th className="ds-num">Solde de fin (j)</th>
          </tr></thead>
          <tbody>
            {[...(balance?.years ?? [])].reverse().map((y: Record<string, any>) => (
              <tr key={y.year}>
                <td className="ds-strong">{y.year}</td><td className="ds-num">{y.months}</td><td className="ds-num">{d2(y.annualEntitlement)}</td>
                <td className="ds-num">{d2(y.acquired)}</td><td className="ds-num">{y.adjustments ? d2(y.adjustments) : '—'}</td>
                <td className="ds-num">{d2(y.taken)}</td>
                <td className="ds-num" style={{ color: y.expired > 0 ? 'var(--ds-warning)' : undefined }}>{y.expired > 0 ? d2(y.expired) : '—'}</td>
                <td className="ds-num ds-strong">{d2(y.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <SectionTitle icon={SlidersHorizontal} actions={isAdmin && !adj ? (
          <button type="button" className="odoo-btn-secondary ds-btn-sm"
            onClick={() => setAdj({ year: String(new Date().getFullYear()), days: '', reason: '' })}><Plus size={13} aria-hidden="true" /> Ajouter</button>
        ) : undefined}>Ajustements</SectionTitle>
        {adj && (
          <div style={{ ...panel, display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field label="Année" required><input className={inputCls} type="number" style={{ width: 90 }} value={adj.year} onChange={e => setAdj({ ...adj, year: e.target.value })} /></Field>
            <Field label="Jours (±)" required><input className={inputCls} type="number" step="0.5" style={{ width: 90 }} value={adj.days} onChange={e => setAdj({ ...adj, days: e.target.value })} /></Field>
            <Field label="Motif" required style={{ flex: 1, minWidth: 200 }}><input className={inputCls} value={adj.reason} placeholder="Reprise du solde au 01/01, régularisation…" onChange={e => setAdj({ ...adj, reason: e.target.value })} /></Field>
            <button type="button" className="odoo-btn-secondary" onClick={() => setAdj(null)}>Annuler</button>
            <button type="button" className="odoo-btn-primary" disabled={create.isPending || !parseFloat(adj.days) || adj.reason.length < 3} onClick={() => create.mutate()}>Enregistrer</button>
          </div>
        )}
        {adjustments.length === 0 ? <p style={{ fontSize: 13, color: 'var(--ds-muted)', margin: 0 }}>Aucun ajustement.</p> : (
          <table className="odoo-table">
            <thead><tr><th>Année</th><th className="ds-num">Jours</th><th>Motif</th><th>Par</th>{isAdmin && <th className="ds-actions"><span className="sr-only">Actions</span></th>}</tr></thead>
            <tbody>
              {adjustments.map(a => (
                <tr key={a.id}>
                  <td>{a.year}</td><td className="ds-num">{parseFloat(a.days) > 0 ? '+' : ''}{d2(parseFloat(a.days))}</td>
                  <td>{a.reason}</td><td>{a.created_by_first_name ?? '—'}</td>
                  {isAdmin && <td className="ds-actions"><button type="button" className="ds-icon-btn" aria-label="Supprimer l'ajustement" title="Supprimer" onClick={async () => { if (!(await confirm('Supprimer cet ajustement ?', { title: 'Supprimer l\'ajustement', confirmLabel: 'Supprimer', danger: true }))) return; remove.mutate(a.id); }}><Trash2 size={14} /></button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </HrModal>
  );
}
