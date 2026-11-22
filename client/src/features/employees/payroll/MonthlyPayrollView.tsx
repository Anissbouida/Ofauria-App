import { money, currencySymbol } from '../../../utils/money';
import PayrollPayDialog from './PayrollPayDialog';
import { useMemo, useState } from 'react';
import SearchSelect from '../../../components/ui/SearchSelect';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { payrollApi, advancesApi, payrollConfigApi } from '../../../api/employees.api';
import { useReferentiel } from '../../../hooks/useReferentiel';
import {
  Eye, Banknote, Download, ArrowUpDown, ArrowUp, ArrowDown, FileText, RotateCcw, Lock, Unlock,
  CheckCircle2, Clock, Wallet, Receipt, AlertTriangle } from 'lucide-react';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { StatusBanner } from '../../../components/ui/StatusBanner';
import { StatusTag } from '../../../components/ui/StatusTag';
import { RowMenu } from '../../../components/ui/RowMenu';
import { FilterChips } from '../../sales/ListTemplate';
import { HrModal, LoadingPanel, SectionTitle, HrHeaderActions } from '../ui';
import { KpiGrid, KpiCard, Toolbar, DataPanel, TableFooter, EmptyState, NoResultState, ErrorState } from '../../../components/ds';

type PayStage = 'generated' | 'topay' | 'paid';
import { notify } from '../../../components/ui/InlineNotification';
import { MONTH_NAMES, apiErrorMessage, saveBlobResponse, openPeriodMessage, OPEN_PERIOD_CONFIRM, amount as fmt } from '../shared';
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
    if (paySortKey !== col) return <ArrowUpDown size={13} style={{ display: "inline", marginLeft: 4, color: "var(--ds-muted)" }} />;
    return paySortDir === 'asc' ? <ArrowUp size={13} style={{ display: "inline", marginLeft: 4, color: "var(--theme-accent)" }} /> : <ArrowDown size={13} style={{ display: "inline", marginLeft: 4, color: "var(--theme-accent)" }} />;
  };

  const { data: payrolls = [], isLoading, isError, error, refetch } = useQuery({
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
    mutationFn: (allowOpenPeriod: boolean = false) => payrollApi.generate(month, year, allowOpenPeriod),
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
    onError: async (err: unknown) => {
      // G0-10 : période non terminée — raison et date affichées ; l'administrateur
      // peut générer une paie provisoire (non payable).
      const open = openPeriodMessage(err);
      if (!open) { notify.error(apiErrorMessage(err, 'Erreur lors de la génération')); return; }
      if (isAdmin && await confirm(open + OPEN_PERIOD_CONFIRM)) generateMutation.mutate(true);
      else notify.error(open);
    },
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
  /** Reste du sur le bulletin : net moins les acomptes hebdo / quinzaine deja verses (mig 327). */
  const dueOf = (p: Record<string, any>) => Math.round((pn(p.net_salary) - pn(p.acomptes_amount)) * 100) / 100;

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
    generated: { count: allRows.length, sub: `${money(totalGross, { decimals: 0 })} brut` },
    topay: { count: toPayRows.length, sub: money(toPayRows.reduce((s, p) => s + dueOf(p), 0), { decimals: 0 }) },
    paid: { count: totalPaid, sub: money(allRows.filter(p => p.paid).reduce((s, p) => s + pn(p.net_salary), 0), { decimals: 0 }) },
  };

  const generateAllPDF = async () => {
    for (const p of sortedPayrolls) await generatePDF(p);
    notify.success(`${sortedPayrolls.length} bulletins PDF générés`);
  };

  const cur = currencySymbol();
  const smigCount = (payrolls as Record<string, any>[]).filter(p => p.smig_alert).length;
  const editions = [
    { label: 'Tous les bulletins en PDF', icon: FileText, disabled: sortedPayrolls.length === 0, onSelect: generateAllPDF },
    { label: 'Exporter en CSV', icon: Download, disabled: sortedPayrolls.length === 0, onSelect: exportPayroll },
    ...(['pdf', 'xlsx'] as const).map(f => ({
      label: `Livre de paie ${f === 'pdf' ? 'PDF' : 'Excel'}`, icon: FileText, disabled: sortedPayrolls.length === 0,
      onSelect: async () => {
        try { saveBlobResponse(await payrollConfigApi.bookFile(year, month, f), `livre_de_paie_${year}-${String(month).padStart(2, '0')}.${f}`); }
        catch (err) { notify.error(apiErrorMessage(err, 'Erreur lors de l\'édition du livre de paie')); }
      },
    })),
    { label: `Livre de paie ${year}`, icon: FileText, onSelect: async () => {
      try { saveBlobResponse(await payrollConfigApi.bookFile(year, null, 'xlsx'), `livre_de_paie_${year}.xlsx`); }
      catch (err) { notify.error(apiErrorMessage(err, 'Erreur lors de l\'édition du livre de paie')); }
    } },
  ];

  return (
    <>
      {/* En-tête de page : éditions et actions du mois en secondaire, puis l'action principale. */}
      <HrHeaderActions>
        {/* Éditions et exports (bulletins PDF, CSV, livre de paie G0-12) regroupés dans un menu. */}
        <RowMenu label="Éditions et exports" items={editions} />
        <button type="button" onClick={() => setShowTransfer(true)} className="odoo-btn-secondary" disabled={sortedPayrolls.length === 0}
          title="Ordre de virement groupé : fichier banque et lettre à signer"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Banknote size={13} aria-hidden="true" /> Virement groupé
        </button>
        {isAdmin && !isClosed && (
          <button type="button" onClick={async () => {
            if (!(await confirm(`Clôturer la paie de ${MONTH_NAMES[month - 1]} ${year} ?\n\nLes bulletins seront figés et comptabilisés (écriture de paie : salaires, charges sociales, CNSS, IR, net à payer). Le paiement reste possible.\n\nVérifiez d'abord les bulletins.`,
              { title: 'Clôturer le mois', confirmLabel: 'Clôturer', danger: true }))) return;
            periodMutation.mutate('close');
          }}
            disabled={periodMutation.isPending || sortedPayrolls.length === 0} className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Lock size={13} aria-hidden="true" /> Clôturer le mois
          </button>
        )}
        <button type="button" onClick={async () => {
          if (!(await confirm(`Générer les bulletins de paie ${MONTH_NAMES[month - 1]} ${year} pour les employés mensuels et les employés hebdo / quinzaine déclarés ?\n\nLes bulletins déjà PAYÉS ne sont jamais écrasés. Les autres sont recalculés depuis le pointage et les paies périodiques du mois.`,
            { title: 'Générer les bulletins', confirmLabel: 'Générer' }))) return;
          generateMutation.mutate(false);
        }} disabled={generateMutation.isPending || isClosed} className="odoo-btn-primary" aria-busy={generateMutation.isPending || undefined}
          title={isClosed ? 'Mois clôturé : rouvrez-le pour régénérer' : undefined}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Banknote size={13} aria-hidden="true" /> Générer les bulletins
        </button>
      </HrHeaderActions>

      {/* Alertes */}
      {isClosed && (
        <StatusBanner tone="neutral" icon={Lock} title={`Paie de ${MONTH_NAMES[month - 1]} ${year} clôturée`}
          actions={isAdmin ? (
            <button type="button" onClick={async () => {
              if (!(await confirm(`Rouvrir la paie de ${MONTH_NAMES[month - 1]} ${year} ?\n\nLes écritures de paie du mois seront extournées et les bulletins non payés pourront être recalculés. Impossible si le mois a déjà été déclaré.`,
                { title: 'Rouvrir le mois', confirmLabel: 'Rouvrir', danger: true }))) return;
              periodMutation.mutate('reopen');
            }}
              disabled={periodMutation.isPending} className="odoo-btn-secondary ds-btn-sm">
              <Unlock size={13} aria-hidden="true" /> Rouvrir le mois
            </button>
          ) : undefined}>
          {period?.closed_at && <>Clôturée le {new Date(period.closed_at).toLocaleDateString('fr-FR')}</>}
          {period?.closed_by_first_name && <> par {period.closed_by_first_name} {period.closed_by_last_name}</>}
          {period?.closed_at ? '. ' : ''}Les bulletins sont figés et comptabilisés ; le paiement reste possible.
        </StatusBanner>
      )}
      {smigCount > 0 && (
        <StatusBanner tone="warning" icon={AlertTriangle} title={`${smigCount} bulletin(s) sous le SMIG`}>
          Le salaire de base de ces salariés est inférieur au SMIG saisi dans le barème de paie. Le détail est indiqué sur chaque ligne.
        </StatusBanner>
      )}

      {/* Montants du mois, puis pastilles d'étape (filtre de la liste). */}
      {allRows.length > 0 && (
        <>
          <KpiGrid>
            <KpiCard label={`Masse salariale brute (${cur})`} value={fmt(totalGross)} />
            <KpiCard label={`Total net à payer (${cur})`} value={fmt(totalNet)} sub={`${totalPaid} sur ${allRows.length} payés`} />
            <KpiCard label={`CNSS, AMO et IR salariés (${cur})`} value={fmt(totalCNSS + totalAMO + totalIR)} />
            <KpiCard label={`Charges patronales (${cur})`} value={fmt(totalChargesPatron)} />
          </KpiGrid>
          <FilterChips label="Étape des bulletins" value={stageFilter ?? ''} onChange={k => setStageFilter((k || null) as PayStage | null)}
            chips={[
              { key: '', label: 'Tous', icon: Receipt, count: stageStats.generated.count },
              { key: 'topay', label: 'À payer', icon: Clock, count: stageStats.topay.count },
              { key: 'paid', label: 'Payés', icon: CheckCircle2, count: stageStats.paid.count },
            ]} />
        </>
      )}

      {/* Barre d'outils : période. */}
      <Toolbar>
        <div className="hr-tools">
          <SearchSelect
            options={MONTH_NAMES.map((m, i) => ({ id: String(i + 1), label: m }))}
            value={String(month)}
            onChange={id => id && setMonth(parseInt(id))}
            placeholder="Mois"
            width={140}
          />
          <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value))} className="odoo-filter-dropdown" style={{ width: 96 }} aria-label="Année" />
        </div>
      </Toolbar>

      {isLoading ? (
        <LoadingPanel />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : sortedPayrolls.length === 0 ? (
        <EmptyState icon={Banknote} title="Aucun bulletin pour cette période" text="Générez les bulletins du mois depuis le pointage avec « Générer les bulletins »." />
      ) : visiblePayrolls.length === 0 ? (
        <NoResultState text="Aucun bulletin à cette étape." onReset={() => setStageFilter(null)} />
      ) : (
        <DataPanel label="Bulletins du mois" footer={<TableFooter
          note={`${visiblePayrolls.length} bulletin${visiblePayrolls.length > 1 ? 's' : ''} · ${totalPaid} sur ${allRows.length} payés · à payer ${stageStats.topay.sub} · payé ${stageStats.paid.sub}`} />}>
          <table className="odoo-table ds-dense">
            <thead>
              <tr>
                <th><button type="button" className="ds-sort" onClick={() => togglePaySort('name')}>Employé <PaySortIcon col="name" /></button></th>
                <th>Poste</th>
                <th className="ds-num"><button type="button" className="ds-sort" onClick={() => togglePaySort('worked')}>Jours travaillés <PaySortIcon col="worked" /></button></th>
                <th className="ds-num"><button type="button" className="ds-sort" onClick={() => togglePaySort('base')}>Base ({cur}) <PaySortIcon col="base" /></button></th>
                <th className="ds-num"><button type="button" className="ds-sort" onClick={() => togglePaySort('gross')}>Brut ({cur}) <PaySortIcon col="gross" /></button></th>
                <th className="ds-num"><button type="button" className="ds-sort" onClick={() => togglePaySort('cnss')}>CNSS ({cur}) <PaySortIcon col="cnss" /></button></th>
                <th className="ds-num"><button type="button" className="ds-sort" onClick={() => togglePaySort('amo')}>AMO ({cur}) <PaySortIcon col="amo" /></button></th>
                <th className="ds-num"><button type="button" className="ds-sort" onClick={() => togglePaySort('ir')}>IR ({cur}) <PaySortIcon col="ir" /></button></th>
                <th className="ds-num"><button type="button" className="ds-sort" onClick={() => togglePaySort('net')}>Net à verser ({cur}) <PaySortIcon col="net" /></button></th>
                <th className="ds-num">Avance ({cur})</th>
                <th><button type="button" className="ds-sort" onClick={() => togglePaySort('status')}>Statut <PaySortIcon col="status" /></button></th>
                <th className="ds-actions"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visiblePayrolls.map(p => {
                const who = `${p.first_name} ${p.last_name}`;
                const payable = !p.paid && !p.is_provisional;
                return (
                <tr key={p.id as string}>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span className="ds-strong">{who}</span>
                      {/* G0-11 : salaire de base sous le SMIG du barème. */}
                      {p.smig_alert && <StatusTag tone="todo" label="Sous le SMIG" title={p.smig_alert as string} />}
                      {p.is_declared === false && <span className="odoo-tag odoo-tag-grey" title="Ni cotisations ni IR">Non déclaré</span>}
                      {p.pay_frequency && p.pay_frequency !== 'monthly' && (
                        <span className="odoo-tag odoo-tag-blue" title={`Payé ${p.pay_frequency === 'weekly' ? 'à la semaine' : 'à la quinzaine'} : brut cumulé des paies du mois, acomptes versés ${money(pf(p.acomptes_amount))} déduits du net`}>
                          {p.pay_frequency === 'weekly' ? 'Hebdo' : 'Quinzaine'}
                        </span>
                      )}
                    </span>
                  </td>
                  <td>{getRoleLabel(p.employee_role as string)}</td>
                  <td className="ds-num" title={pn(p.worked_days) < 26 ? 'Moins de 26 jours payés' : undefined}>
                    <span className="ds-strong">{pn(p.worked_days)}</span>
                    <span style={{ color: 'var(--ds-muted)' }}> / 26</span>
                  </td>
                  <td className="ds-num">{fmt(pn(p.base_salary))}</td>
                  <td className="ds-num">{fmt(pn(p.gross_salary))}</td>
                  <td className="ds-num">{fmt(pn(p.cnss_employee))}</td>
                  <td className="ds-num">{fmt(pn(p.amo_employee))}</td>
                  <td className="ds-num">{fmt(pn(p.ir_net))}</td>
                  <td className="ds-num ds-strong">
                    {(() => {
                      // Reste du apres acomptes hebdo / quinzaine (mig 327).
                      const net = dueOf(p);
                      const ded = p.paid
                        ? pn(p.advance_deduction)
                        : Math.min(suggestedByEmp.get(p.employee_id as string) ?? 0, net);
                      const verse = Math.max(0, Math.round((net - ded) * 100) / 100);
                      if (ded <= 0.005 && pn(p.acomptes_amount) <= 0) return fmt(pn(p.net_salary));
                      return (
                        <span title={p.paid
                          ? `Net ${net.toFixed(2)} − retenue avance ${ded.toFixed(2)} = versé ${verse.toFixed(2)}`
                          : `Net dû ${net.toFixed(2)} − retenue proposée ${ded.toFixed(2)} (modifiable au paiement)`}>
                          {fmt(verse)}
                          <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--ds-muted)' }}>
                            net {fmt(pn(p.net_salary))}{pn(p.acomptes_amount) > 0 && ` − acomptes ${fmt(pn(p.acomptes_amount))}`}
                          </div>
                        </span>
                      );
                    })()}
                  </td>
                  <td className="ds-num">
                    {p.paid ? (
                      pn(p.advance_deduction) > 0 ? <>− {fmt(pn(p.advance_deduction))}</> : '—'
                    ) : (outstandingByEmp.get(p.employee_id as string) || 0) > 0 ? (
                      <span className="odoo-tag odoo-tag-orange" title="Solde d'avances à récupérer">
                        {fmt(outstandingByEmp.get(p.employee_id as string) || 0)}
                      </span>
                    ) : '—'}
                  </td>
                  <td>
                    {p.paid ? <StatusTag tone="done" label="Payé" />
                      // G0-10 : généré avant la fin du mois par dérogation — non payable.
                      : p.is_provisional ? <StatusTag tone="draft" label="Provisoire" title="Mois non terminé : régénérez la paie une fois le mois fini pour pouvoir payer" />
                      : <StatusTag tone="todo" label="À payer" />}
                  </td>
                  <td className="ds-actions">
                    {payable
                      ? <button type="button" onClick={() => setPayTarget(p)} className="odoo-btn-secondary ds-btn-sm"><Banknote size={13} aria-hidden="true" /> Payer</button>
                      : <button type="button" onClick={() => setDetailPayroll(p)} className="odoo-btn-secondary ds-btn-sm">Détail</button>}
                    <RowMenu label={`Plus d'actions pour le bulletin de ${who}`} items={[
                      ...(payable ? [{ label: 'Voir le détail', icon: Eye, onSelect: () => setDetailPayroll(p) }] : []),
                      { label: 'Télécharger le PDF', icon: FileText, onSelect: () => void generatePDF(p) },
                      ...(p.paid ? [{
                        label: 'Annuler le paiement', icon: RotateCcw, danger: true,
                        onSelect: async () => {
                          if (!(await confirm(`Annuler le paiement de ${who} ?\n\nLa sortie de caisse liée sera supprimée (écriture comptable reversée) et les retenues d'avance re-créditées. Vous pourrez ensuite re-payer sans doublon.`,
                            { title: 'Annuler le paiement', confirmLabel: 'Annuler le paiement', danger: true }))) return;
                          unpayMutation.mutate(p.id as string);
                        },
                      }] : []),
                    ]} />
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </DataPanel>
      )}

      {/* ─── Dialogue de paiement (mode + retenue avance) ─── */}
      {payTarget && (
        <PayrollPayDialog
          employeeName={`${payTarget.first_name} ${payTarget.last_name}`}
          periodLabel={`${MONTH_NAMES[month - 1]} ${year}`}
          net={dueOf(payTarget)}
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
        const tag = p.paid ? <StatusTag tone="done" label="Payé" />
          : notDeclared ? <StatusTag tone="draft" label="Non déclaré" />
          : <StatusTag tone="todo" label="À payer" />;
        // Cycle de vie du bulletin : Généré → Mois clôturé → Payé (le paiement
        // peut preceder la cloture : chaque etape est franchie independamment).
        const steps = [
          { label: 'Généré', detail: `${MONTH_NAMES[month - 1]} ${year}`, done: true },
          { label: 'Mois clôturé', detail: isClosed ? (period?.closed_at ? new Date(period.closed_at).toLocaleDateString('fr-FR') : 'comptabilisé') : 'en saisie', done: isClosed },
          { label: 'Payé', detail: p.paid ? (pn(p.advance_deduction) > 0 ? `retenue ${money(pf(p.advance_deduction))}` : 'versé') : 'à payer', done: !!p.paid },
        ];
        const currentIdx = steps.findIndex(s => !s.done);
        const otLabel = [
          pn(p.ot_day_hours) && `${pn(p.ot_day_hours)} h jour`, pn(p.ot_night_hours) && `${pn(p.ot_night_hours)} h nuit`,
          pn(p.ot_rest_day_hours) && `${pn(p.ot_rest_day_hours)} h repos`, pn(p.ot_rest_night_hours) && `${pn(p.ot_rest_night_hours)} h repos nuit`,
        ].filter(Boolean).join(', ') || `${pn(p.overtime_hours)} h`;
        // Lignes du bulletin : [désignation, gain, retenue]
        const rows: Array<[string, number | null, number | null]> = [
          ['Salaire de base', pn(p.base_salary), null],
          ...(pn(p.seniority_bonus) > 0 ? [['Prime d\'ancienneté', pn(p.seniority_bonus), null] as [string, number, null]] : []),
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
          <DataPanel>
          <table className="odoo-table ds-dense">
            <tbody>
              {lines.filter((l): l is [string, string] => !!l).map(([k, v]) => (
                <tr key={k}><td>{k}</td><td className="ds-num" style={{ whiteSpace: 'nowrap' }}>{v} {currencySymbol()}</td></tr>
              ))}
            </tbody>
          </table>
          </DataPanel>
        );
        return (
          <HrModal icon={Wallet} crumb="Bulletin" width={760} onClose={() => setDetailPayroll(null)}
            title={`${p.first_name as string} ${p.last_name as string} — ${MONTH_NAMES[month - 1]} ${year}`}
            tag={tag}
            headerActions={
              <button type="button" onClick={() => generatePDF(p)} className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <FileText size={13} aria-hidden="true" /> PDF
              </button>
            }
            footer={<>
              <button type="button" className="odoo-btn-secondary" onClick={() => setDetailPayroll(null)}>Fermer</button>
              <button type="button" className="odoo-btn-primary" onClick={() => generatePDF(p)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Download size={13} aria-hidden="true" /> Télécharger le bulletin PDF
              </button>
            </>}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px', fontSize: '0.8125rem' }}>
              <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--ds-ink)' }}>{p.first_name as string} {p.last_name as string}</span>
              <span style={{ color: 'var(--ds-muted)' }}>
                {getRoleLabel(p.employee_role as string)} · <strong style={{ color: 'var(--ds-ink)' }}>{money(pf(p.net_salary))}</strong> net
              </span>
            </div>

            <ol className="ui-timeline" aria-label="Cycle de vie du bulletin" style={{ margin: '0 -16px' }}>
              {steps.map((s, i) => (
                <li key={s.label} className={`ui-timeline-step ${s.done ? 'is-done' : i === currentIdx ? 'is-current' : ''}`} aria-current={i === currentIdx ? 'step' : undefined}>
                  <span className="ui-timeline-dot">{s.done ? <CheckCircle2 size={14} /> : null}</span>
                  <span className="ui-timeline-label">{s.label}</span>
                  <span className="ui-timeline-detail">{s.detail}</span>
                </li>
              ))}
            </ol>

            <SectionTitle icon={Clock}>Présence</SectionTitle>
            <DataPanel label="Présence">
            <table className="odoo-table ds-dense">
              <thead><tr><th className="ds-num">Jours payés</th><th className="ds-num">Absences (j)</th><th className="ds-num">Heures sup (h)</th></tr></thead>
              <tbody>
                <tr>
                  <td className="ds-num">
                    <strong>{pn(p.worked_days)}</strong>
                    {pn(p.paid_leave_days) > 0 && <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>dont {pn(p.paid_leave_days)} j congé</div>}
                    {pn(p.holiday_paid_days) > 0 && <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>dont {pn(p.holiday_paid_days)} j férié</div>}
                  </td>
                  <td className="ds-num ds-strong">{p.absent_days as number}</td>
                  <td className="ds-num ds-strong">{pn(p.overtime_hours).toFixed(1)}</td>
                </tr>
              </tbody>
            </table>
            </DataPanel>

            <SectionTitle icon={Receipt}>Éléments de paie</SectionTitle>
            {notDeclared && <span style={{ fontSize: 12, color: 'var(--ds-muted)' }}>Salarié non déclaré : ni cotisations ni IR.</span>}
            <DataPanel label="Éléments de paie">
            <table className="odoo-table ds-dense">
              <thead>
                <tr><th>Désignation</th><th className="ds-num" style={{ width: 150 }}>Gains ({currencySymbol()})</th><th className="ds-num" style={{ width: 150 }}>Retenues ({currencySymbol()})</th></tr>
              </thead>
              <tbody>
                {rows.map(([label, gain, ret]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td className="ds-num">{num(gain)}</td>
                    <td className="ds-num">{num(ret, true)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 600 }}>
                  <td>Salaire brut</td>
                  <td className="ds-num">{pf(p.gross_salary)}</td>
                  <td />
                </tr>
                {cotis.map(([label, , ret]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td />
                    <td className="ds-num">{num(ret, true)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700 }}>
                  <td>Net à payer</td>
                  <td colSpan={2} className="ds-num">{money(pf(p.net_salary))}</td>
                </tr>
                {pn(p.acomptes_amount) > 0 && (<>
                  <tr>
                    <td>Acomptes {p.pay_frequency === 'weekly' ? 'hebdomadaires' : 'de quinzaine'} versés</td>
                    <td colSpan={2} className="ds-num">− {money(pf(p.acomptes_amount))}</td>
                  </tr>
                  <tr style={{ fontWeight: 700 }}>
                    <td>Reste à payer</td>
                    <td colSpan={2} className="ds-num">{money(pf(dueOf(p)))}</td>
                  </tr>
                </>)}
              </tfoot>
            </table>
            </DataPanel>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <SectionTitle>Bases IR</SectionTitle>
                {twoCol([
                  ['Salaire brut imposable', pf(p.brut_imposable ?? p.gross_salary)],
                  ['Frais professionnels', '− ' + pf(p.frais_pro)],
                  p.net_imposable != null && ['Revenu net imposable', pf(p.net_imposable)],
                  ['IR brut (barème)', pf(p.ir_gross)],
                  pn(p.family_deduction) > 0 && [`Déduction familiale (${p.nb_dependents} pers.)`, '− ' + pf(p.family_deduction)],
                  ['IR net', '− ' + pf(p.ir_net)],
                ])}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <SectionTitle>Charges patronales — {money(pf(p.total_charges_patron))}</SectionTitle>
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
