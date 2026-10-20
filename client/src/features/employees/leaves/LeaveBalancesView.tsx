import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, Trash2, Loader2, CalendarCheck, Info, History, SlidersHorizontal } from 'lucide-react';
import { leavesApi } from '../../../api/employees.api';
import { notify } from '../../../components/ui/InlineNotification';
import { useAuth } from '../../../context/AuthContext';
import { apiErrorMessage, downloadCsv } from '../shared';
import { StatusBanner } from '../../../components/ui/StatusBanner';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { HrModal, Field, SectionTitle, EmptyState, inputCls, panel, smallBtn } from '../ui';

const d2 = (v: number) => (Math.round(v * 100) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 });

/**
 * Soldes de congés payés : droits acquis de l'année (1,5 j/mois + ancienneté),
 * reliquat reporté, pris, en attente, disponible, et jours qui expirent au
 * 31/12. Détail par année et ajustements (admin) par employé.
 */
export default function LeaveBalancesView() {
  const { data: rows = [], isLoading } = useQuery<Record<string, any>[]>({
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
      <StatusBanner tone="neutral" icon={Info} title="Acquisition des congés payés"
        actions={<button className="odoo-btn-secondary" onClick={exportCsv} disabled={!rows.length} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Download size={12} /> CSV
        </button>}>
        1,5 jour ouvrable par mois de service, +1,5 jour par 5 ans d'ancienneté (plafond 30 j/an). Un reliquat se cumule sur deux années consécutives.
      </StatusBanner>
      {isLoading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Loader2 className="animate-spin" size={20} style={{ margin: '0 auto 8px' }} />
          <p style={{ fontSize: '0.8125rem' }}>Chargement...</p>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={CalendarCheck}>Aucun solde de congés à afficher</EmptyState>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead><tr>
              <th>Employé</th>
              <th style={{ textAlign: 'right' }}>Acquis {year}</th><th style={{ textAlign: 'right' }}>Reporté</th>
              <th style={{ textAlign: 'right' }}>Pris {year}</th><th style={{ textAlign: 'right' }}>En attente</th>
              <th style={{ textAlign: 'right' }}>Disponible</th><th style={{ textAlign: 'right' }}>Expire au 31/12</th>
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.employeeId} onClick={() => setDetail(r)} style={{ cursor: 'pointer' }}>
                  <td style={{ fontWeight: 500 }}>{r.name}{!r.hireDate && <span className="odoo-tag odoo-tag-orange" style={{ marginLeft: 6 }}>Sans date d'embauche</span>}</td>
                  <td style={{ textAlign: 'right' }}>{d2(r.acquiredThisYear)}{r.seniorityBonus > 0 && <span style={{ color: 'var(--odoo-text-muted)', fontSize: '0.6875rem' }} title="Majoration d'ancienneté annuelle"> (+{d2(r.seniorityBonus)})</span>}</td>
                  <td style={{ textAlign: 'right' }}>{d2(r.carriedOver)}</td>
                  <td style={{ textAlign: 'right' }}>{d2(r.takenThisYear)}</td>
                  <td style={{ textAlign: 'right', color: r.pending > 0 ? '#b08504' : undefined }}>{d2(r.pending)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: r.available < 0 ? '#dc3545' : '#155724' }}>{d2(r.available)}</td>
                  <td style={{ textAlign: 'right', color: r.expiringThisYear > 0 ? '#b85d1a' : 'var(--odoo-text-light)' }}>{r.expiringThisYear > 0 ? d2(r.expiringThisYear) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
      tag={<span className={`odoo-tag ${balance && balance.available < 0 ? 'odoo-tag-red' : 'odoo-tag-green'}`}>Disponible {balance ? d2(balance.available) : '…'} j</span>}
      footer={<button type="button" onClick={onClose} className="odoo-btn-secondary">Fermer</button>}>
        <p style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)', margin: 0 }}>
          Embauché le {employee.hireDate ? new Date(employee.hireDate).toLocaleDateString('fr-FR') : '—'} · disponible {balance ? d2(balance.available) : '…'} j
        </p>
        <SectionTitle icon={History}>Détail par année</SectionTitle>
        <table className="odoo-table">
          <thead><tr>
            <th>Année</th><th style={{ textAlign: 'center' }}>Mois</th><th style={{ textAlign: 'right' }}>Droit annuel</th>
            <th style={{ textAlign: 'right' }}>Acquis</th><th style={{ textAlign: 'right' }}>Ajust.</th><th style={{ textAlign: 'right' }}>Pris</th>
            <th style={{ textAlign: 'right' }}>Expiré</th><th style={{ textAlign: 'right' }}>Solde fin</th>
          </tr></thead>
          <tbody>
            {[...(balance?.years ?? [])].reverse().map((y: Record<string, any>) => (
              <tr key={y.year}>
                <td>{y.year}</td><td style={{ textAlign: 'center' }}>{y.months}</td><td style={{ textAlign: 'right' }}>{d2(y.annualEntitlement)}</td>
                <td style={{ textAlign: 'right' }}>{d2(y.acquired)}</td><td style={{ textAlign: 'right' }}>{y.adjustments ? d2(y.adjustments) : '—'}</td>
                <td style={{ textAlign: 'right' }}>{d2(y.taken)}</td>
                <td style={{ textAlign: 'right', color: y.expired > 0 ? '#b85d1a' : undefined }}>{y.expired > 0 ? d2(y.expired) : '—'}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{d2(y.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <SectionTitle icon={SlidersHorizontal} actions={isAdmin && !adj ? (
          <button className="odoo-btn-secondary" style={smallBtn}
            onClick={() => setAdj({ year: String(new Date().getFullYear()), days: '', reason: '' })}><Plus size={11} /> Ajouter</button>
        ) : undefined}>Ajustements</SectionTitle>
        {adj && (
          <div style={{ ...panel, display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field label="Année"><input className={inputCls} type="number" style={{ width: 90 }} value={adj.year} onChange={e => setAdj({ ...adj, year: e.target.value })} /></Field>
            <Field label="Jours (±)"><input className={inputCls} type="number" step="0.5" style={{ width: 90 }} value={adj.days} onChange={e => setAdj({ ...adj, days: e.target.value })} /></Field>
            <Field label="Motif" style={{ flex: 1, minWidth: 200 }}><input className={inputCls} value={adj.reason} placeholder="Reprise du solde au 01/01, régularisation…" onChange={e => setAdj({ ...adj, reason: e.target.value })} /></Field>
            <button className="odoo-btn-secondary" onClick={() => setAdj(null)}>Annuler</button>
            <button className="odoo-btn-primary" disabled={create.isPending || !parseFloat(adj.days) || adj.reason.length < 3} onClick={() => create.mutate()}>OK</button>
          </div>
        )}
        {adjustments.length === 0 ? <p style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)', margin: 0 }}>Aucun ajustement.</p> : (
          <table className="odoo-table">
            <thead><tr><th>Année</th><th style={{ textAlign: 'right' }}>Jours</th><th>Motif</th><th>Par</th>{isAdmin && <th style={{ width: 32 }}></th>}</tr></thead>
            <tbody>
              {adjustments.map(a => (
                <tr key={a.id}>
                  <td>{a.year}</td><td style={{ textAlign: 'right' }}>{parseFloat(a.days) > 0 ? '+' : ''}{d2(parseFloat(a.days))}</td>
                  <td>{a.reason}</td><td style={{ color: 'var(--odoo-text-muted)' }}>{a.created_by_first_name ?? '—'}</td>
                  {isAdmin && <td><button className="odoo-pager-btn" style={{ color: '#dc3545' }} onClick={async () => { if (!(await confirm('Supprimer cet ajustement ?', { title: 'Supprimer l\'ajustement', confirmLabel: 'Supprimer', danger: true }))) return; remove.mutate(a.id); }}><Trash2 size={12} /></button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </HrModal>
  );
}
