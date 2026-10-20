import PayrollPayDialog from './PayrollPayDialog';
import { useMemo, useState } from 'react';
import SearchSelect from '../../../components/ui/SearchSelect';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { payrollApi, advancesApi } from '../../../api/employees.api';
import { useReferentiel } from '../../../hooks/useReferentiel';
import {
  UserCog, Users, Banknote, Download, ArrowUpDown, ArrowUp, ArrowDown, FileText, RotateCcw, Lock, Unlock,
  CheckCircle2, Clock, Wallet, Receipt,
} from 'lucide-react';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { StatusBanner } from '../../../components/ui/StatusBanner';
import { StagePipeline, StageProgress, type StageDef } from '../../../components/purchasing/ProcessBoard';
import { HrModal, EmptyState, SectionTitle, inputCls } from '../ui';

type PayStage = 'generated' | 'topay' | 'paid';
const PAY_STAGES: StageDef[] = [
  { key: 'generated', label: 'Générés', hint: 'bulletins du mois', icon: Receipt },
  { key: 'topay', label: 'À payer', hint: 'net non versé', icon: Clock },
  { key: 'paid', label: 'Payés', hint: 'paiement enregistré', icon: CheckCircle2 },
];
import { notify } from '../../../components/ui/InlineNotification';
import { MONTH_NAMES, apiErrorMessage, saveBlobResponse } from '../shared';
import PayslipLinesEditor from './PayslipLinesEditor';
import SalaryTransferDialog from './SalaryTransferDialog';
import { useAuth } from '../../../context/AuthContext';

export default function MonthlyPayrollView({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [detailPayroll, setDetailPayroll] = useState<Record<string, any> | null>(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [payTarget, setPayTarget] = useState<Record<string, any> | null>(null);
  const [paySortKey, setPaySortKey] = useState<string>('name');
  const [paySortDir, setPaySortDir] = useState<'asc' | 'desc'>('asc');
  const [stageFilter, setStageFilter] = useState<PayStage | null>(null);
  const { getLabel: getRoleLabel } = useReferentiel('employee_roles');
  const confirm = useConfirm();

  const togglePaySort = (key: string) => {
    if (paySortKey === key) setPaySortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setPaySortKey(key); setPaySortDir('asc'); }
  };
  const PaySortIcon = ({ col }: { col: string }) => {
    if (paySortKey !== col) return <ArrowUpDown size={13} style={{ display: "inline", marginLeft: 4, color: "var(--odoo-text-light)" }} />;
    return paySortDir === 'asc' ? <ArrowUp size={13} style={{ display: "inline", marginLeft: 4, color: "var(--odoo-purple)" }} /> : <ArrowDown size={13} style={{ display: "inline", marginLeft: 4, color: "var(--odoo-purple)" }} />;
  };

  const { data: payrolls = [], isLoading } = useQuery({
    queryKey: ['payroll', month, year],
    queryFn: () => payrollApi.list({ month: String(month), year: String(year) }),
  });

  // Cloture du mois : un mois cloture ne se regenere ni ne s'edite (paiement possible).
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { data: period } = useQuery<Record<string, any>>({
    queryKey: ['payroll-period', month, year],
    queryFn: () => payrollApi.period(month, year),
  });
  const isClosed = period?.status === 'closed';
  const periodMutation = useMutation({
    mutationFn: (action: 'close' | 'reopen') => action === 'close' ? payrollApi.closePeriod(month, year) : payrollApi.reopenPeriod(month, year),
    onSuccess: (d: Record<string, any>, action) => {
      queryClient.invalidateQueries({ queryKey: ['payroll-period'] });
      queryClient.invalidateQueries({ queryKey: ['payroll-declarations'] });
      notify.success(action === 'close'
        ? `Mois clôturé et comptabilisé (${d?.entriesPosted ?? 0} écriture(s) de paie)`
        : `Mois rouvert : ${d?.entriesReversed ?? 0} écriture(s) de paie extournée(s)`);
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur')),
  });

  // Soldes d'avances en cours par employe (pour proposer la retenue au paiement)
  const { data: outstandingRows = [] } = useQuery({
    queryKey: ['advances-outstanding'],
    queryFn: () => advancesApi.outstanding(),
  });
  // outstanding = solde total ; suggested = retenue proposee (plan d'etalement
  // monthly_deduction si defini, sinon tout le solde).
  const { outstandingByEmp, suggestedByEmp } = useMemo(() => {
    const o = new Map<string, number>();
    const s = new Map<string, number>();
    (outstandingRows as Record<string, any>[]).forEach(r => {
      o.set(r.employee_id as string, parseFloat(r.outstanding as string) || 0);
      s.set(r.employee_id as string, parseFloat(r.suggested as string) || 0);
    });
    return { outstandingByEmp: o, suggestedByEmp: s };
  }, [outstandingRows]);

  const generateMutation = useMutation({
    mutationFn: () => payrollApi.generate(month, year),
    onSuccess: ({ removed }) => {
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      notify.success('Bulletins generes');
      // Bulletins non payes retires car l'employe n'est plus paye au mois :
      // on le dit, au lieu de les faire disparaitre en silence.
      if (removed.length > 0) {
        const freq = (f: string) => f === 'weekly' ? 'hebdo' : f === 'biweekly' ? 'quinzaine' : f;
        notify.warning(`${removed.length} bulletin(s) non payé(s) retiré(s) — employé(s) passé(s) dans une autre fréquence de paie : `
          + removed.map(r => `${r.first_name} ${r.last_name} (${freq(r.pay_frequency)})`).join(', '));
      }
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur lors de la generation')),
  });

  const payMutation = useMutation({
    mutationFn: ({ id, method, deduction }: { id: string; method: string; deduction: number }) =>
      payrollApi.markPaid(id, method, deduction),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      queryClient.invalidateQueries({ queryKey: ['advances-outstanding'] });
      queryClient.invalidateQueries({ queryKey: ['salary-advances'] });
      notify.success('Paiement enregistre');
      setPayTarget(null);
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors du paiement');
    },
  });

  const unpayMutation = useMutation({
    mutationFn: (id: string) => payrollApi.unmarkPaid(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      queryClient.invalidateQueries({ queryKey: ['advances-outstanding'] });
      queryClient.invalidateQueries({ queryKey: ['salary-advances'] });
      notify.success('Paiement annulé : sortie de caisse supprimée et retenues re-créditées');
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de l\'annulation');
    },
  });

  const pf = (v: unknown) => parseFloat(v as string || '0').toFixed(2);
  const pn = (v: unknown) => parseFloat(v as string || '0');

  const totalNet = (payrolls as Record<string, any>[]).reduce((s, p) => s + pn(p.net_salary), 0);
  const totalGross = (payrolls as Record<string, any>[]).reduce((s, p) => s + pn(p.gross_salary), 0);
  const totalIR = (payrolls as Record<string, any>[]).reduce((s, p) => s + pn(p.ir_net), 0);
  const totalCNSS = (payrolls as Record<string, any>[]).reduce((s, p) => s + pn(p.cnss_employee), 0);
  const totalAMO = (payrolls as Record<string, any>[]).reduce((s, p) => s + pn(p.amo_employee), 0);
  const totalChargesPatron = (payrolls as Record<string, any>[]).reduce((s, p) => s + pn(p.total_charges_patron), 0);
  const totalPaid = (payrolls as Record<string, any>[]).filter(p => p.paid).length;

  const exportPayroll = () => {
    const BOM = '\uFEFF';
    const headers = ['Employe', 'Fonction', 'Salaire Base', 'Brut', 'CNSS Sal.', 'AMO Sal.', 'IR', 'Net a payer', 'Charges Patron', 'Paye'];
    const rows = (payrolls as Record<string, any>[]).map(p => [
      `${p.first_name} ${p.last_name}`,
      getRoleLabel(p.employee_role as string),
      pf(p.base_salary), pf(p.gross_salary), pf(p.cnss_employee), pf(p.amo_employee),
      pf(p.ir_net), pf(p.net_salary), pf(p.total_charges_patron),
      p.paid ? 'Oui' : 'Non',
    ]);
    const csv = BOM + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `paie_${MONTH_NAMES[month - 1]}_${year}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Sort payrolls ───
  const sortedPayrolls = [...(payrolls as Record<string, any>[])].sort((a, b) => {
    let cmp = 0;
    switch (paySortKey) {
      case 'name': cmp = (`${a.first_name} ${a.last_name}` as string).localeCompare(`${b.first_name} ${b.last_name}` as string); break;
      case 'role': cmp = getRoleLabel(a.employee_role as string).localeCompare(getRoleLabel(b.employee_role as string)); break;
      case 'worked': cmp = pn(a.worked_days) - pn(b.worked_days); break;
      case 'base': cmp = pn(a.base_salary) - pn(b.base_salary); break;
      case 'gross': cmp = pn(a.gross_salary) - pn(b.gross_salary); break;
      case 'cnss': cmp = pn(a.cnss_employee) - pn(b.cnss_employee); break;
      case 'amo': cmp = pn(a.amo_employee) - pn(b.amo_employee); break;
      case 'ir': cmp = pn(a.ir_net) - pn(b.ir_net); break;
      case 'net': cmp = pn(a.net_salary) - pn(b.net_salary); break;
      case 'status': cmp = (a.paid ? 1 : 0) - (b.paid ? 1 : 0); break;
    }
    return paySortDir === 'asc' ? cmp : -cmp;
  });

  // ─── Bulletin PDF (genere serveur : mentions legales, bases, cumuls) ───
  const generatePDF = async (p: Record<string, any>) => {
    try {
      const response = await payrollApi.pdf(p.id as string);
      saveBlobResponse(response, `bulletin_${p.last_name}_${p.first_name}_${year}-${String(month).padStart(2, '0')}.pdf`);
    } catch (err) {
      notify.error(apiErrorMessage(err, 'Erreur lors de la génération du PDF'));
    }
  };

  // Filtre client issu du pipeline (n'affecte ni les exports ni la cloture).
  const visiblePayrolls = sortedPayrolls.filter(p =>
    stageFilter === 'topay' ? !p.paid : stageFilter === 'paid' ? !!p.paid : true);
  const allRows = payrolls as Record<string, any>[];
  const toPayRows = allRows.filter(p => !p.paid);
  const stageStats = {
    generated: { count: allRows.length, sub: `${totalGross.toFixed(0)} DH brut` },
    topay: { count: toPayRows.length, sub: `${toPayRows.reduce((s, p) => s + pn(p.net_salary), 0).toFixed(0)} DH` },
    paid: { count: totalPaid, sub: `${allRows.filter(p => p.paid).reduce((s, p) => s + pn(p.net_salary), 0).toFixed(0)} DH` },
  };

  const generateAllPDF = async () => {
    for (const p of sortedPayrolls) await generatePDF(p);
    notify.success(`${sortedPayrolls.length} bulletins PDF générés`);
  };

  const dh = <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', fontWeight: 400 }}>DH</span>;

  return (
    <>
      {/* Toolbar */}
      <div className="odoo-search-panel" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <SearchSelect
            options={MONTH_NAMES.map((m, i) => ({ id: String(i + 1), label: m }))}
            value={String(month)}
            onChange={id => id && setMonth(parseInt(id))}
            placeholder="Mois"
            width={140}
          />
          <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value))} className={inputCls} style={{ width: 96 }} />
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <button onClick={generateAllPDF} className="odoo-btn-secondary" disabled={sortedPayrolls.length === 0}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <FileText size={13} /> PDF tous
          </button>
          <button onClick={exportPayroll} className="odoo-btn-secondary" disabled={sortedPayrolls.length === 0}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Download size={13} /> CSV
          </button>
          <button onClick={() => setShowTransfer(true)} className="odoo-btn-secondary" disabled={sortedPayrolls.length === 0}
            title="Ordre de virement groupé : fichier banque et lettre à signer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Banknote size={13} /> Virement groupé
          </button>
          <button onClick={async () => {
            if (!(await confirm(`Generer les bulletins de paie ${MONTH_NAMES[month - 1]} ${year} pour tous les employes mensuels ?\n\nLes bulletins deja PAYES ne sont jamais ecrases. Les autres sont recalcules depuis le pointage.`,
              { title: 'Générer les bulletins', confirmLabel: 'Générer' }))) return;
            generateMutation.mutate();
          }} disabled={generateMutation.isPending || isClosed} className="odoo-btn-primary"
            title={isClosed ? 'Mois clôturé : rouvrez-le pour régénérer' : undefined}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Banknote size={13} /> Générer les bulletins
          </button>
          {isAdmin && !isClosed && (
            <button onClick={async () => {
              if (!(await confirm(`Clôturer la paie de ${MONTH_NAMES[month - 1]} ${year} ?\n\nLes bulletins seront figés et comptabilisés (écriture de paie : salaires, charges sociales, CNSS, IR, net à payer). Le paiement reste possible.\n\nVérifiez d'abord les bulletins.`,
                { title: 'Clôturer le mois', confirmLabel: 'Clôturer', danger: true }))) return;
              periodMutation.mutate('close');
            }}
              disabled={periodMutation.isPending || sortedPayrolls.length === 0} className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Lock size={13} /> Clôturer le mois
            </button>
          )}
        </div>
      </div>

      {isClosed && (
        <StatusBanner tone="neutral" icon={Lock} title={`Paie de ${MONTH_NAMES[month - 1]} ${year} clôturée`}
          actions={isAdmin ? (
            <button onClick={async () => {
              if (!(await confirm(`Rouvrir la paie de ${MONTH_NAMES[month - 1]} ${year} ?\n\nLes écritures de paie du mois seront extournées et les bulletins non payés pourront être recalculés. Impossible si le mois a déjà été déclaré.`,
                { title: 'Rouvrir le mois', confirmLabel: 'Rouvrir', danger: true }))) return;
              periodMutation.mutate('reopen');
            }}
              disabled={periodMutation.isPending} className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Unlock size={13} /> Rouvrir le mois
            </button>
          ) : undefined}>
          {period?.closed_at && <>Clôturée le {new Date(period.closed_at).toLocaleDateString('fr-FR')}</>}
          {period?.closed_by_first_name && <> par {period.closed_by_first_name} {period.closed_by_last_name}</>}
          {period?.closed_at ? '. ' : ''}Les bulletins sont figés et comptabilisés ; le paiement reste possible.
        </StatusBanner>
      )}

      {/* Pipeline + montants */}
      {allRows.length > 0 && (
        <>
          <StagePipeline title={`Bulletins — ${MONTH_NAMES[month - 1]} ${year}`}
            summary={stageFilter ? 'Cliquez à nouveau pour tout afficher' : `${totalPaid}/${allRows.length} payés`}
            stages={PAY_STAGES} stats={stageStats}
            isActive={k => stageFilter === k}
            onPick={k => setStageFilter(f => (f === k || k === 'generated') ? null : k as PayStage)} />
          <div className="odoo-stat-grid">
            <div className="odoo-stat-card">
              <div className="odoo-stat-card-label">Masse salariale brute</div>
              <div className="odoo-stat-card-value">{totalGross.toFixed(2)} {dh}</div>
            </div>
            <div className="odoo-stat-card">
              <div className="odoo-stat-card-label">Total net à payer</div>
              <div className="odoo-stat-card-value" style={{ color: '#28a745' }}>{totalNet.toFixed(2)} {dh}</div>
            </div>
            <div className="odoo-stat-card">
              <div className="odoo-stat-card-label">CNSS + AMO + IR (sal.)</div>
              <div className="odoo-stat-card-value" style={{ color: '#b85d1a' }}>{(totalCNSS + totalAMO + totalIR).toFixed(2)} {dh}</div>
            </div>
            <div className="odoo-stat-card">
              <div className="odoo-stat-card-label">Charges patronales</div>
              <div className="odoo-stat-card-value" style={{ color: 'var(--theme-accent)' }}>{totalChargesPatron.toFixed(2)} {dh}</div>
            </div>
          </div>
        </>
      )}

      {isLoading ? (
        <p style={{ color: 'var(--odoo-text-muted)', fontSize: '0.8125rem' }}>Chargement...</p>
      ) : sortedPayrolls.length === 0 ? (
        <EmptyState icon={Banknote}>Aucun bulletin pour cette période. Cliquez sur « Générer les bulletins ».</EmptyState>
      ) : visiblePayrolls.length === 0 ? (
        <EmptyState icon={Banknote}>Aucun bulletin à cette étape.</EmptyState>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th onClick={() => togglePaySort('name')} style={{ cursor: 'pointer' }}>Employé <PaySortIcon col="name" /></th>
                <th onClick={() => togglePaySort('worked')} style={{ cursor: 'pointer', textAlign: 'center' }}>J. Trav. <PaySortIcon col="worked" /></th>
                <th onClick={() => togglePaySort('base')} style={{ cursor: 'pointer', textAlign: 'right' }}>Base <PaySortIcon col="base" /></th>
                <th onClick={() => togglePaySort('gross')} style={{ cursor: 'pointer', textAlign: 'right' }}>Brut <PaySortIcon col="gross" /></th>
                <th onClick={() => togglePaySort('cnss')} style={{ cursor: 'pointer', textAlign: 'right' }}>CNSS <PaySortIcon col="cnss" /></th>
                <th onClick={() => togglePaySort('amo')} style={{ cursor: 'pointer', textAlign: 'right' }}>AMO <PaySortIcon col="amo" /></th>
                <th onClick={() => togglePaySort('ir')} style={{ cursor: 'pointer', textAlign: 'right' }}>IR <PaySortIcon col="ir" /></th>
                <th onClick={() => togglePaySort('net')} style={{ cursor: 'pointer', textAlign: 'right' }}>Net <PaySortIcon col="net" /></th>
                <th style={{ textAlign: 'right' }}>Avance</th>
                <th onClick={() => togglePaySort('status')} style={{ cursor: 'pointer', textAlign: 'center' }}>Statut <PaySortIcon col="status" /></th>
                <th style={{ textAlign: 'center', width: 80 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visiblePayrolls.map(p => (
                <tr key={p.id as string}>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                      <Users size={11} style={{ color: 'var(--theme-accent)' }} />
                      {p.first_name as string} {p.last_name as string}
                      <span style={{ color: 'var(--odoo-text-muted)', fontSize: '0.6875rem' }}>· {getRoleLabel(p.employee_role as string)}</span>
                      {p.is_declared === false && <span className="odoo-tag odoo-tag-grey" title="Ni cotisations ni IR">Non déclaré</span>}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span style={{ fontWeight: 600, color: pn(p.worked_days) < 26 ? '#dc3545' : '#155724' }}>
                      {pn(p.worked_days)}
                    </span>
                    <span style={{ color: 'var(--odoo-text-light)', fontSize: '0.625rem' }}> /26</span>
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--odoo-text-muted)' }}>{pf(p.base_salary)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 500 }}>{pf(p.gross_salary)}</td>
                  <td style={{ textAlign: 'right', color: '#b85d1a' }}>{pf(p.cnss_employee)}</td>
                  <td style={{ textAlign: 'right', color: '#b85d1a' }}>{pf(p.amo_employee)}</td>
                  <td style={{ textAlign: 'right', color: '#dc3545' }}>{pf(p.ir_net)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: '#155724' }}>
                    {(() => {
                      const net = pn(p.net_salary);
                      const ded = p.paid
                        ? pn(p.advance_deduction)
                        : Math.min(suggestedByEmp.get(p.employee_id as string) ?? 0, net);
                      const verse = Math.max(0, Math.round((net - ded) * 100) / 100);
                      if (ded <= 0.005) return pf(p.net_salary);
                      return (
                        <span title={p.paid
                          ? `Net ${net.toFixed(2)} − retenue avance ${ded.toFixed(2)} = versé ${verse.toFixed(2)}`
                          : `Net dû ${net.toFixed(2)} − retenue proposée ${ded.toFixed(2)} (modifiable au paiement)`}>
                          {verse.toFixed(2)}
                          <div style={{ fontSize: '0.625rem', fontWeight: 400, color: 'var(--odoo-text-muted)' }}>
                            net {net.toFixed(2)}
                          </div>
                        </span>
                      );
                    })()}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {p.paid ? (
                      pn(p.advance_deduction) > 0
                        ? <span style={{ color: '#b85d1a', fontWeight: 500 }}>− {pf(p.advance_deduction)}</span>
                        : <span style={{ color: 'var(--odoo-text-light)' }}>—</span>
                    ) : (outstandingByEmp.get(p.employee_id as string) || 0) > 0 ? (
                      <span className="odoo-tag odoo-tag-orange" title="Solde d'avances à récupérer">
                        {(outstandingByEmp.get(p.employee_id as string) || 0).toFixed(2)}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--odoo-text-light)' }}>—</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <StageProgress count={3} current={p.paid ? 3 : isClosed ? 2 : 1} done={!!p.paid} />
                    {p.paid ? (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <span className="odoo-tag odoo-tag-green">Payé</span>
                        <button onClick={async () => {
                          if (!(await confirm(`Annuler le paiement de ${p.first_name} ${p.last_name} ?\n\nLa sortie de caisse liée sera supprimée (écriture comptable reversée) et les retenues d'avance re-créditées. Vous pourrez ensuite re-payer sans doublon.`,
                            { title: 'Annuler le paiement', confirmLabel: 'Annuler le paiement', danger: true }))) return;
                          unpayMutation.mutate(p.id as string);
                        }} className="odoo-pager-btn" title="Annuler le paiement" style={{ color: '#dc3545' }}>
                          <RotateCcw size={12} />
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setPayTarget(p)} className="odoo-btn-primary" style={{ padding: '0.15rem 0.6rem', fontSize: '0.75rem' }}>
                        Payer
                      </button>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'inline-flex', gap: 2 }}>
                      <button onClick={() => setDetailPayroll(p)} className="odoo-pager-btn" title="Voir le détail">
                        <UserCog size={13} />
                      </button>
                      <button onClick={() => generatePDF(p)} className="odoo-pager-btn" title="Télécharger PDF">
                        <FileText size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Dialogue de paiement (mode + retenue avance) ─── */}
      {payTarget && (
        <PayrollPayDialog
          employeeName={`${payTarget.first_name} ${payTarget.last_name}`}
          periodLabel={`${MONTH_NAMES[month - 1]} ${year}`}
          net={pn(payTarget.net_salary)}
          outstanding={outstandingByEmp.get(payTarget.employee_id as string) || 0}
          suggested={suggestedByEmp.get(payTarget.employee_id as string) ?? (outstandingByEmp.get(payTarget.employee_id as string) || 0)}
          defaultMethod="cash"
          pending={payMutation.isPending}
          onClose={() => setPayTarget(null)}
          onConfirm={(method, deduction) => payMutation.mutate({ id: payTarget.id as string, method, deduction })}
        />
      )}

      {/* ─── Bulletin de paie detail modal ─── */}
      {detailPayroll && (() => {
        const p = detailPayroll;
        const notDeclared = p.is_declared === false;
        const tag = p.paid ? <span className="odoo-tag odoo-tag-green">Payé</span>
          : notDeclared ? <span className="odoo-tag odoo-tag-grey">Non déclaré</span>
          : <span className="odoo-tag odoo-tag-orange">À payer</span>;
        // Cycle de vie du bulletin : Généré → Mois clôturé → Payé (le paiement
        // peut preceder la cloture : chaque etape est franchie independamment).
        const steps = [
          { label: 'Généré', detail: `${MONTH_NAMES[month - 1]} ${year}`, done: true },
          { label: 'Mois clôturé', detail: isClosed ? (period?.closed_at ? new Date(period.closed_at).toLocaleDateString('fr-FR') : 'comptabilisé') : 'en saisie', done: isClosed },
          { label: 'Payé', detail: p.paid ? (pn(p.advance_deduction) > 0 ? `retenue ${pf(p.advance_deduction)} DH` : 'versé') : 'à payer', done: !!p.paid },
        ];
        const currentIdx = steps.findIndex(s => !s.done);
        const otLabel = [
          pn(p.ot_day_hours) && `${pn(p.ot_day_hours)} h jour`, pn(p.ot_night_hours) && `${pn(p.ot_night_hours)} h nuit`,
          pn(p.ot_rest_day_hours) && `${pn(p.ot_rest_day_hours)} h repos`, pn(p.ot_rest_night_hours) && `${pn(p.ot_rest_night_hours)} h repos nuit`,
        ].filter(Boolean).join(', ') || `${pn(p.overtime_hours)} h`;
        // Lignes du bulletin : [désignation, gain, retenue]
        const rows: Array<[string, number | null, number | null]> = [
          ['Salaire de base', pn(p.base_salary), null],
          ...(pn(p.seniority_bonus) > 0 ? [['Prime d\'anciennete', pn(p.seniority_bonus), null] as [string, number, null]] : []),
          ...(pn(p.overtime_amount) > 0 ? [[`Heures sup. (${otLabel})`, pn(p.overtime_amount), null] as [string, number, null]] : []),
          ...(pn(p.holiday_premium) > 0 ? [[`Férié travaillé (${pn(p.holiday_worked_days)} j)`, pn(p.holiday_premium), null] as [string, number, null]] : []),
          ...(pn(p.extra_shift_amount) > 0 ? [[`Double shifts (+${p.extra_shift_days} j)`, pn(p.extra_shift_amount), null] as [string, number, null]] : []),
          ...(pn(p.bonuses) > 0 ? [['Primes et indemnités', pn(p.bonuses), null] as [string, number, null]] : []),
          ...(pn(p.deductions) > 0 ? [['Retenue absences', null, pn(p.deductions)] as [string, null, number]] : []),
        ];
        const cotis: Array<[string, null, number]> = [
          ['CNSS (plafonnée)', null, pn(p.cnss_employee)],
          ['AMO', null, pn(p.amo_employee)],
          ...(pn(p.cimr_employee) > 0 ? [['CIMR', null, pn(p.cimr_employee)] as [string, null, number]] : []),
          ['IR net', null, pn(p.ir_net)],
          ...(pn(p.other_deductions) > 0 ? [['Autres retenues (rubriques)', null, pn(p.other_deductions)] as [string, null, number]] : []),
        ];
        const num = (v: number | null, neg = false) => v == null ? '' : `${neg ? '− ' : ''}${v.toFixed(2)}`;
        const twoCol = (lines: Array<[string, string] | false>) => (
          <table className="odoo-table">
            <tbody>
              {lines.filter((l): l is [string, string] => !!l).map(([k, v]) => (
                <tr key={k}><td>{k}</td><td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{v} DH</td></tr>
              ))}
            </tbody>
          </table>
        );
        return (
          <HrModal icon={Wallet} crumb="Bulletin" width={760} onClose={() => setDetailPayroll(null)}
            title={`${p.first_name as string} ${p.last_name as string} — ${MONTH_NAMES[month - 1]} ${year}`}
            tag={tag}
            headerActions={
              <button type="button" onClick={() => generatePDF(p)} className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <FileText size={12} /> PDF
              </button>
            }
            footer={<>
              <button type="button" className="odoo-btn-secondary" onClick={() => setDetailPayroll(null)}>Fermer</button>
              <button type="button" className="odoo-btn-primary" onClick={() => generatePDF(p)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Download size={12} /> Telecharger le bulletin PDF
              </button>
            </>}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px', fontSize: '0.8125rem' }}>
              <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--odoo-text)' }}>{p.first_name as string} {p.last_name as string}</span>
              <span style={{ color: 'var(--odoo-text-muted)' }}>
                {getRoleLabel(p.employee_role as string)} · <strong style={{ color: 'var(--odoo-text)' }}>{pf(p.net_salary)} DH</strong> net
              </span>
            </div>

            <ol className="ui-timeline" aria-label="Cycle de vie du bulletin" style={{ margin: '0 -16px' }}>
              {steps.map((s, i) => (
                <li key={s.label} className={`ui-timeline-step ${s.done ? 'is-done' : i === currentIdx ? 'is-current' : ''}`} aria-current={i === currentIdx ? 'step' : undefined}>
                  <span className="ui-timeline-dot">{s.done ? <CheckCircle2 size={14} /> : i + 1}</span>
                  <span className="ui-timeline-label">{s.label}</span>
                  <span className="ui-timeline-detail">{s.detail}</span>
                </li>
              ))}
            </ol>

            <SectionTitle icon={Clock}>Présence</SectionTitle>
            <table className="odoo-table">
              <thead><tr><th style={{ textAlign: 'center' }}>Jours payés</th><th style={{ textAlign: 'center' }}>Absences</th><th style={{ textAlign: 'center' }}>H. Sup</th></tr></thead>
              <tbody>
                <tr>
                  <td style={{ textAlign: 'center' }}>
                    <strong>{pn(p.worked_days)}</strong>
                    {pn(p.paid_leave_days) > 0 && <div style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)' }}>dont {pn(p.paid_leave_days)} j congé</div>}
                    {pn(p.holiday_paid_days) > 0 && <div style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)' }}>dont {pn(p.holiday_paid_days)} j férié</div>}
                  </td>
                  <td style={{ textAlign: 'center', color: '#dc3545', fontWeight: 600 }}>{p.absent_days as number}</td>
                  <td style={{ textAlign: 'center', fontWeight: 600 }}>{pn(p.overtime_hours).toFixed(1)}h</td>
                </tr>
              </tbody>
            </table>

            <SectionTitle icon={Receipt}>Éléments de paie</SectionTitle>
            {notDeclared && <span style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>Salarié non déclaré : ni cotisations ni IR.</span>}
            <table className="odoo-table">
              <thead>
                <tr><th>Désignation</th><th style={{ textAlign: 'right', width: 130 }}>Gains</th><th style={{ textAlign: 'right', width: 130 }}>Retenues</th></tr>
              </thead>
              <tbody>
                {rows.map(([label, gain, ret]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td style={{ textAlign: 'right' }}>{num(gain)}</td>
                    <td style={{ textAlign: 'right', color: '#dc3545' }}>{num(ret, true)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 600 }}>
                  <td>Salaire brut</td>
                  <td style={{ textAlign: 'right' }}>{pf(p.gross_salary)}</td>
                  <td />
                </tr>
                {cotis.map(([label, , ret]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td />
                    <td style={{ textAlign: 'right', color: '#dc3545' }}>{num(ret, true)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700 }}>
                  <td>Net à payer</td>
                  <td colSpan={2} style={{ textAlign: 'right', color: '#155724', fontSize: '0.9375rem' }}>{pf(p.net_salary)} DH</td>
                </tr>
              </tfoot>
            </table>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <SectionTitle>Bases IR</SectionTitle>
                {twoCol([
                  ['Salaire brut imposable', pf(p.brut_imposable ?? p.gross_salary)],
                  ['Frais professionnels', '− ' + pf(p.frais_pro)],
                  p.net_imposable != null && ['Revenu net imposable', pf(p.net_imposable)],
                  ['IR brut (barème)', pf(p.ir_gross)],
                  pn(p.family_deduction) > 0 && [`Deduction familiale (${p.nb_dependents} pers.)`, '− ' + pf(p.family_deduction)],
                  ['IR net', '− ' + pf(p.ir_net)],
                ])}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <SectionTitle>Charges patronales — {pf(p.total_charges_patron)} DH</SectionTitle>
                {twoCol([
                  ['CNSS patronale', pf(p.cnss_employer)],
                  ['AMO patronale', pf(p.amo_employer)],
                  pn(p.cimr_employer) > 0 && ['CIMR patronale', pf(p.cimr_employer)],
                  ['Allocations familiales', pf(p.alloc_familiales)],
                  ['Taxe formation professionnelle', pf(p.taxe_fp)],
                ])}
              </div>
            </div>

            <PayslipLinesEditor
              payrollId={p.id as string}
              locked={!!p.paid || isClosed}
              lockReason={p.paid ? 'Bulletin payé : annulez le paiement pour modifier les rubriques.' : isClosed ? 'Mois clôturé : rouvrez-le pour modifier les rubriques.' : undefined}
              onRecomputed={updated => setDetailPayroll({ ...p, ...updated })}
            />
          </HrModal>
        );
      })()}
      {showTransfer && <SalaryTransferDialog month={month} year={year} onClose={() => setShowTransfer(false)} />}
    </>
  );
}
