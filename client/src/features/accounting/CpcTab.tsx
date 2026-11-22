import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Lock } from 'lucide-react';
import { financialStatementsApi } from '../../api/ledger.api';
import { useAuth } from '../../context/AuthContext';
import EditionButtons from './EditionButtons';
import { currencySymbol } from '../../utils/money';
import { EmptyState, KpiCard, KpiGrid, LoadingState, DataPanel, SectionHeader, Toolbar, HeaderActions, DateRangeField } from '../../components/ds';

function exportCSV(filename: string, headers: string[], rows: string[][]) {
  const BOM = '﻿';
  const csv = BOM + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

function n(v: string | number): string {
  const num = typeof v === 'string' ? parseFloat(v) : v;
  if (!Number.isFinite(num) || num === 0) return '0,00';
  return num.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function CpcTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const now = new Date();
  const [startDate, setStartDate] = useState(`${now.getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(now.toISOString().slice(0, 10));

  const { data, isLoading } = useQuery({
    queryKey: ['ledger-cpc', startDate, endDate],
    queryFn: () => financialStatementsApi.incomeStatement({ startDate, endDate }),
    enabled: isAdmin,
  });

  if (!isAdmin) {
    return (
      <EmptyState icon={Lock} title="Le CPC est réservé à l'administrateur ou au gérant." />
    );
  }

  const handleExport = () => {
    if (!data) return;
    const rows: string[][] = [
      ['PRODUITS', '', ''],
      ...data.produits.map(p => [p.code, p.label, p.amount]),
      ['Total produits', '', String(data.total_produits.toFixed(2))],
      ['CHARGES', '', ''],
      ...data.charges.map(c => [c.code, c.label, c.amount]),
      ['Total charges', '', String(data.total_charges.toFixed(2))],
      ['RESULTAT NET', '', String(data.resultat_net.toFixed(2))],
    ];
    exportCSV(`cpc_${startDate}_${endDate}.csv`, ['COMPTE', 'LIBELLE', 'MONTANT'], rows);
  };

  const resultat = data?.resultat_net ?? 0;
  const isProfit = resultat >= 0;

  return (
    <>
      <HeaderActions>
        <button type="button" onClick={handleExport} className="odoo-btn-secondary" disabled={!data}>
          <Download size={13} aria-hidden="true" /> Exporter CSV
        </button>
        <EditionButtons kind="cpc" params={{ startDate, endDate }} />
      </HeaderActions>

      {data && (
        <KpiGrid>
          <KpiCard label="Produits (classe 7)" value={n(data.total_produits)} sub={currencySymbol()} />
          <KpiCard label="Charges (classe 6)" value={n(data.total_charges)} sub={currencySymbol()} />
          <KpiCard label="Résultat net" value={<>{isProfit ? '+' : ''}{n(resultat)}</>} sub={isProfit ? 'Bénéfice' : 'Perte'} tone={isProfit ? 'green' : 'red'} />
        </KpiGrid>
      )}

      <Toolbar>
        <DateRangeField from={startDate} to={endDate} onFrom={setStartDate} onTo={setEndDate} />
      </Toolbar>

      {isLoading || !data ? (
        <LoadingState />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, alignItems: 'start' }}>
            {/* Produits */}
            <div style={{ display: 'grid', gap: 8 }}>
              <SectionHeader title="Produits" />
              <DataPanel label="Produits">
              <table className="odoo-table ds-dense">
                <thead>
                  <tr><th style={{ width: 80 }}>Compte</th><th>Libellé</th><th className="ds-num">Montant ({currencySymbol()})</th></tr>
                </thead>
                <tbody>
                  {data.produits.map(p => (
                    <tr key={p.code}>
                      <td className="ds-ref" style={{ width: 70 }}>{p.code}</td>
                      <td className="ds-strong">{p.label}</td>
                      <td className="ds-num">{n(p.amount)}</td>
                    </tr>
                  ))}
                  {data.produits.length === 0 && (
                    <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--ds-muted)' }}>Aucun produit sur la période</td></tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>Total produits</td>
                    <td className="ds-num">{n(data.total_produits)}</td>
                  </tr>
                </tfoot>
              </table>
              </DataPanel>
            </div>

            {/* Charges */}
            <div style={{ display: 'grid', gap: 8 }}>
              <SectionHeader title="Charges" />
              <DataPanel label="Charges">
              <table className="odoo-table ds-dense">
                <thead>
                  <tr><th style={{ width: 80 }}>Compte</th><th>Libellé</th><th className="ds-num">Montant ({currencySymbol()})</th></tr>
                </thead>
                <tbody>
                  {data.charges.map(c => (
                    <tr key={c.code}>
                      <td className="ds-ref" style={{ width: 70 }}>{c.code}</td>
                      <td className="ds-strong">{c.label}</td>
                      <td className="ds-num">{n(c.amount)}</td>
                    </tr>
                  ))}
                  {data.charges.length === 0 && (
                    <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--ds-muted)' }}>Aucune charge sur la période</td></tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>Total charges</td>
                    <td className="ds-num">{n(data.total_charges)}</td>
                  </tr>
                </tfoot>
              </table>
              </DataPanel>
            </div>
          </div>
        </>
      )}
    </>
  );
}
