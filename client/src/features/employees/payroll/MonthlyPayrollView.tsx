import PayrollPayDialog from './PayrollPayDialog';
import { useMemo, useState } from 'react';
import SearchSelect from '../../../components/ui/SearchSelect';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { payrollApi, advancesApi } from '../../../api/employees.api';
import { useReferentiel } from '../../../hooks/useReferentiel';
import { format } from 'date-fns';
import {
  UserCog, Users, Banknote, X, Download, ArrowUpDown, ArrowUp, ArrowDown, FileText, RotateCcw,
} from 'lucide-react';
import jsPDF from 'jspdf';
import { notify } from '../../../components/ui/InlineNotification';
import { MONTH_NAMES } from '../shared';

export default function MonthlyPayrollView({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [detailPayroll, setDetailPayroll] = useState<Record<string, any> | null>(null);
  const [payTarget, setPayTarget] = useState<Record<string, any> | null>(null);
  const [paySortKey, setPaySortKey] = useState<string>('name');
  const [paySortDir, setPaySortDir] = useState<'asc' | 'desc'>('asc');
  const { getLabel: getRoleLabel } = useReferentiel('employee_roles');

  const togglePaySort = (key: string) => {
    if (paySortKey === key) setPaySortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setPaySortKey(key); setPaySortDir('asc'); }
  };
  const PaySortIcon = ({ col }: { col: string }) => {
    if (paySortKey !== col) return <ArrowUpDown size={13} className="text-gray-300 ml-1 inline" />;
    return paySortDir === 'asc' ? <ArrowUp size={13} className="text-teal-600 ml-1 inline" /> : <ArrowDown size={13} className="text-teal-600 ml-1 inline" />;
  };

  const { data: payrolls = [], isLoading } = useQuery({
    queryKey: ['payroll', month, year],
    queryFn: () => payrollApi.list({ month: String(month), year: String(year) }),
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
    onError: () => notify.error('Erreur lors de la generation'),
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

  // ─── PDF bulletin generation ───
  const generatePDF = (p: Record<string, any>) => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210;
    const mg = 15; // margin
    let y = 15;

    const addLine = (label: string, value: string, x1 = mg, x2 = W - mg) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(label, x1, y);
      doc.setFont('helvetica', 'bold');
      doc.text(value, x2, y, { align: 'right' });
      y += 5;
    };

    const addSection = (title: string, color: [number, number, number]) => {
      y += 3;
      doc.setFillColor(...color);
      doc.rect(mg, y - 4, W - 2 * mg, 7, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(255, 255, 255);
      doc.text(title, mg + 3, y);
      doc.setTextColor(0, 0, 0);
      y += 7;
    };

    const addSeparator = () => {
      doc.setDrawColor(200, 200, 200);
      doc.line(mg, y, W - mg, y);
      y += 3;
    };

    // ═══ Header ═══
    doc.setFillColor(13, 148, 136); // teal-600
    doc.rect(0, 0, W, 38, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(255, 255, 255);
    doc.text('BULLETIN DE PAIE', W / 2, 15, { align: 'center' });
    doc.setFontSize(11);
    doc.text(`${MONTH_NAMES[month - 1]} ${year}`, W / 2, 23, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Ofauria', W / 2, 31, { align: 'center' });
    doc.setTextColor(0, 0, 0);
    y = 48;

    // ═══ Employee info ═══
    doc.setFillColor(245, 245, 245);
    doc.rect(mg, y - 5, W - 2 * mg, 18, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(`${p.first_name} ${p.last_name}`, mg + 5, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Fonction : ${getRoleLabel(p.employee_role as string)}`, mg + 5, y + 6);
    doc.text(`Jours trav. : ${p.worked_days}    |    Absences : ${p.absent_days}    |    H. Sup : ${pn(p.overtime_hours).toFixed(1)}h`, mg + 5, y + 11);
    y += 20;

    // ═══ Remuneration ═══
    addSection('REMUNERATION', [59, 130, 246]); // blue
    addLine('Salaire de base', `${pf(p.base_salary)} DH`);
    if (pn(p.seniority_bonus) > 0) addLine("Prime d'anciennete", `${pf(p.seniority_bonus)} DH`);
    if (pn(p.overtime_amount) > 0) addLine('Heures supplementaires', `${pf(p.overtime_amount)} DH`);
    if (pn(p.extra_shift_amount) > 0) addLine(`Double shifts (+${p.extra_shift_days} j)`, `${pf(p.extra_shift_amount)} DH`);
    if (pn(p.deductions) > 0) addLine('Retenue absences', `- ${pf(p.deductions)} DH`);
    addSeparator();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    addLine('Salaire brut', `${pf(p.gross_salary)} DH`);

    // ═══ Cotisations salariales ═══
    addSection('COTISATIONS SALARIALES', [234, 88, 12]); // orange
    addLine('CNSS (4.48% plaf. 6 000)', `- ${pf(p.cnss_employee)} DH`);
    addLine('AMO (2.26%)', `- ${pf(p.amo_employee)} DH`);
    if (pn(p.cimr_employee) > 0) addLine('CIMR', `- ${pf(p.cimr_employee)} DH`);
    addSeparator();
    const sni = pn(p.gross_salary) - pn(p.cnss_employee) - pn(p.amo_employee) - pn(p.cimr_employee);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    addLine('Salaire net imposable', `${sni.toFixed(2)} DH`);

    // ═══ IR ═══
    addSection("IMPOT SUR LE REVENU", [220, 38, 38]); // red
    addLine('Frais professionnels (20%)', `- ${pf(p.frais_pro)} DH`);
    addLine('IR brut (bareme)', `${pf(p.ir_gross)} DH`);
    if (pn(p.family_deduction) > 0) addLine(`Deduction familiale (${p.nb_dependents} pers.)`, `- ${pf(p.family_deduction)} DH`);
    addSeparator();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    addLine('IR net', `- ${pf(p.ir_net)} DH`);

    // ═══ Net a payer ═══
    y += 5;
    doc.setFillColor(22, 163, 74); // green-600
    doc.rect(mg, y - 5, W - 2 * mg, 14, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.text('NET A PAYER', mg + 5, y + 3);
    doc.text(`${pf(p.net_salary)} DH`, W - mg - 5, y + 3, { align: 'right' });
    doc.setTextColor(0, 0, 0);
    y += 16;

    // ═══ Charges patronales ═══
    addSection('CHARGES PATRONALES', [147, 51, 234]); // purple
    addLine('CNSS patronale (8.98%)', `${pf(p.cnss_employer)} DH`);
    addLine('AMO patronale (4.11%)', `${pf(p.amo_employer)} DH`);
    if (pn(p.cimr_employer) > 0) addLine('CIMR patronale', `${pf(p.cimr_employer)} DH`);
    addLine('Allocations familiales (6.40%)', `${pf(p.alloc_familiales)} DH`);
    addLine('Taxe form. prof. (1.60%)', `${pf(p.taxe_fp)} DH`);
    addSeparator();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    addLine('Total charges patronales', `${pf(p.total_charges_patron)} DH`);

    // ═══ Footer ═══
    y = 275;
    doc.setDrawColor(200, 200, 200);
    doc.line(mg, y, W - mg, y);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(`Bulletin genere le ${format(new Date(), 'dd/MM/yyyy')} — Ofauria`, W / 2, y + 5, { align: 'center' });

    doc.save(`bulletin_${(p.first_name as string).toLowerCase()}_${(p.last_name as string).toLowerCase()}_${MONTH_NAMES[month - 1].toLowerCase()}_${year}.pdf`);
  };

  const generateAllPDF = () => {
    sortedPayrolls.forEach(p => generatePDF(p));
    notify.success(`${sortedPayrolls.length} bulletins PDF generes`);
  };

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
          <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value))} className="input" style={{ width: 96 }} />
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
          <button onClick={() => {
            if (confirm(`Generer les bulletins de paie ${MONTH_NAMES[month - 1]} ${year} pour tous les employes mensuels ?\n\nLes bulletins deja PAYES ne sont jamais ecrases. Les autres sont recalcules depuis le pointage.`)) {
              generateMutation.mutate();
            }
          }} disabled={generateMutation.isPending} className="odoo-btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Banknote size={13} /> Générer les bulletins
          </button>
        </div>
      </div>

      {/* Stat tiles */}
      {(payrolls as Record<string, any>[]).length > 0 && (
        <div className="odoo-stat-grid">
          <div className="odoo-stat-card">
            <div className="odoo-stat-card-label">Masse salariale brute</div>
            <div className="odoo-stat-card-value">{totalGross.toFixed(2)} <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', fontWeight: 400 }}>DH</span></div>
          </div>
          <div className="odoo-stat-card">
            <div className="odoo-stat-card-label">Total net à payer</div>
            <div className="odoo-stat-card-value" style={{ color: '#28a745' }}>{totalNet.toFixed(2)} <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', fontWeight: 400 }}>DH</span></div>
          </div>
          <div className="odoo-stat-card">
            <div className="odoo-stat-card-label">CNSS + AMO + IR (sal.)</div>
            <div className="odoo-stat-card-value" style={{ color: '#b85d1a' }}>{(totalCNSS + totalAMO + totalIR).toFixed(2)} <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', fontWeight: 400 }}>DH</span></div>
          </div>
          <div className="odoo-stat-card">
            <div className="odoo-stat-card-label">Charges patronales</div>
            <div className="odoo-stat-card-value" style={{ color: 'var(--theme-accent)' }}>{totalChargesPatron.toFixed(2)} <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', fontWeight: 400 }}>DH</span></div>
          </div>
        </div>
      )}

      {isLoading ? (
        <p style={{ color: 'var(--odoo-text-muted)', fontSize: '0.8125rem' }}>Chargement...</p>
      ) : sortedPayrolls.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--odoo-text-muted)' }}>
          <Banknote size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>Aucun bulletin pour cette période. Cliquez sur « Générer les bulletins ».</p>
        </div>
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
                <th onClick={() => togglePaySort('net')} style={{ cursor: 'pointer', textAlign: 'right', background: '#eafaf1', color: '#155724' }}>Net <PaySortIcon col="net" /></th>
                <th style={{ textAlign: 'right' }}>Avance</th>
                <th onClick={() => togglePaySort('status')} style={{ cursor: 'pointer', textAlign: 'center' }}>Statut <PaySortIcon col="status" /></th>
                <th style={{ textAlign: 'center', width: 80 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedPayrolls.map(p => (
                <tr key={p.id as string}>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                      <Users size={11} style={{ color: 'var(--theme-accent)' }} />
                      {p.first_name as string} {p.last_name as string}
                      <span style={{ color: 'var(--odoo-text-muted)', fontSize: '0.6875rem' }}>· {getRoleLabel(p.employee_role as string)}</span>
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
                  <td style={{ textAlign: 'right', fontWeight: 700, color: '#155724', background: '#eafaf1' }}>
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
                    {p.paid ? (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <span className="odoo-tag odoo-tag-green">Payé</span>
                        <button onClick={() => {
                          if (confirm(`Annuler le paiement de ${p.first_name} ${p.last_name} ?\n\nLa sortie de caisse liée sera supprimée (écriture comptable reversée) et les retenues d'avance re-créditées. Vous pourrez ensuite re-payer sans doublon.`)) {
                            unpayMutation.mutate(p.id as string);
                          }
                        }} className="odoo-pager-btn" title="Annuler le paiement" style={{ color: '#dc3545' }}>
                          <RotateCcw size={12} />
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setPayTarget(p)}
                        className="odoo-tag odoo-tag-purple" style={{ cursor: 'pointer', border: 'none' }}>
                        Payer
                      </button>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'inline-flex', gap: 2 }}>
                      <button onClick={() => setDetailPayroll(p)} className="odoo-pager-btn" title="Voir le détail">
                        <UserCog size={13} />
                      </button>
                      <button onClick={() => generatePDF(p)} className="odoo-pager-btn" title="Télécharger PDF" style={{ color: '#dc3545' }}>
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
        const line = (label: string, value: string, color = 'text-gray-800', bold = false) => (
          <div className="flex justify-between py-1.5 px-3">
            <span className="text-gray-500 text-sm">{label}</span>
            <span className={`text-sm ${color} ${bold ? 'font-bold' : 'font-medium'}`}>{value} DH</span>
          </div>
        );
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setDetailPayroll(null)}>
            <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl" onClick={ev => ev.stopPropagation()}>
              {/* Header */}
              <div className="bg-gradient-to-r from-teal-600 to-cyan-600 text-white p-5 rounded-t-2xl">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold">{p.first_name as string} {p.last_name as string}</h2>
                    <p className="text-teal-100 text-sm">{getRoleLabel(p.employee_role as string)} — {MONTH_NAMES[month - 1]} {year}</p>
                  </div>
                  <button onClick={() => setDetailPayroll(null)} className="w-8 h-8 bg-white/20 hover:bg-white/30 rounded-lg flex items-center justify-center">
                    <X size={16} />
                  </button>
                </div>
              </div>

              <div className="p-5 space-y-4">
                {/* Presence */}
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Presence</p>
                  <div className="grid grid-cols-3 gap-2 text-center text-sm">
                    <div><p className="text-gray-500">Jours trav.</p><p className="font-bold">{p.worked_days as number}</p></div>
                    <div><p className="text-gray-500">Absences</p><p className="font-bold text-red-600">{p.absent_days as number}</p></div>
                    <div><p className="text-gray-500">H. Sup</p><p className="font-bold">{pn(p.overtime_hours).toFixed(1)}h</p></div>
                  </div>
                </div>

                {/* Remuneration */}
                <div className="bg-blue-50 rounded-xl overflow-hidden">
                  <p className="text-xs font-semibold text-blue-600 uppercase px-3 pt-3 pb-1">Remuneration</p>
                  {line('Salaire de base', pf(p.base_salary))}
                  {pn(p.seniority_bonus) > 0 && line('Prime d\'anciennete', pf(p.seniority_bonus))}
                  {pn(p.overtime_amount) > 0 && line('Heures supplementaires', pf(p.overtime_amount))}
                  {pn(p.extra_shift_amount) > 0 && line(`Double shifts (+${p.extra_shift_days} j)`, pf(p.extra_shift_amount))}
                  {pn(p.deductions) > 0 && line('Retenue absences', '-' + pf(p.deductions), 'text-red-600')}
                  <div className="border-t border-blue-200 mt-1">
                    {line('Salaire brut', pf(p.gross_salary), 'text-blue-700', true)}
                  </div>
                </div>

                {/* Cotisations salariales */}
                <div className="bg-orange-50 rounded-xl overflow-hidden">
                  <p className="text-xs font-semibold text-orange-600 uppercase px-3 pt-3 pb-1">Cotisations salariales</p>
                  {line('CNSS (4.48% plaf. 6 000)', '-' + pf(p.cnss_employee), 'text-orange-700')}
                  {line('AMO (2.26%)', '-' + pf(p.amo_employee), 'text-orange-700')}
                  {pn(p.cimr_employee) > 0 && line('CIMR', '-' + pf(p.cimr_employee), 'text-orange-700')}
                  <div className="border-t border-orange-200 mt-1">
                    {line('= Salaire net imposable', pf(pn(p.gross_salary) - pn(p.cnss_employee) - pn(p.amo_employee) - pn(p.cimr_employee)), 'text-orange-800', true)}
                  </div>
                </div>

                {/* IR */}
                <div className="bg-red-50 rounded-xl overflow-hidden">
                  <p className="text-xs font-semibold text-red-600 uppercase px-3 pt-3 pb-1">Impot sur le revenu</p>
                  {line('Frais professionnels (20%)', '-' + pf(p.frais_pro))}
                  {line('IR brut (bareme)', pf(p.ir_gross))}
                  {pn(p.family_deduction) > 0 && line(`Deduction familiale (${p.nb_dependents} pers.)`, '-' + pf(p.family_deduction))}
                  <div className="border-t border-red-200 mt-1">
                    {line('IR net', '-' + pf(p.ir_net), 'text-red-700', true)}
                  </div>
                </div>

                {/* Net */}
                <div className="bg-green-100 rounded-xl p-4 text-center">
                  <p className="text-xs text-green-600 uppercase font-semibold mb-1">Net a payer</p>
                  <p className="text-3xl font-bold text-green-700">{pf(p.net_salary)} <span className="text-base">DH</span></p>
                </div>

                {/* Charges patronales */}
                <details className="bg-purple-50 rounded-xl overflow-hidden">
                  <summary className="text-xs font-semibold text-purple-600 uppercase px-3 py-3 cursor-pointer hover:bg-purple-100 transition-colors">
                    Charges patronales — {pf(p.total_charges_patron)} DH
                  </summary>
                  <div className="pb-2">
                    {line('CNSS patronale (8.98%)', pf(p.cnss_employer), 'text-purple-700')}
                    {line('AMO patronale (4.11%)', pf(p.amo_employer), 'text-purple-700')}
                    {pn(p.cimr_employer) > 0 && line('CIMR patronale', pf(p.cimr_employer), 'text-purple-700')}
                    {line('Allocations familiales (6.40%)', pf(p.alloc_familiales), 'text-purple-700')}
                    {line('Taxe form. prof. (1.60%)', pf(p.taxe_fp), 'text-purple-700')}
                  </div>
                </details>

                {/* PDF download button */}
                <button onClick={() => { generatePDF(p); notify.success('Bulletin PDF telecharge'); }}
                  className="w-full py-3 bg-red-50 hover:bg-red-100 text-red-700 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors">
                  <FileText size={18} /> Telecharger le bulletin PDF
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
