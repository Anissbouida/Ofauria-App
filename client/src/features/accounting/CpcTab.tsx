import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Download, Lock, TrendingUp, TrendingDown, Calendar } from 'lucide-react';
import { financialStatementsApi } from '../../api/ledger.api';
import { useAuth } from '../../context/AuthContext';

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
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
        <Lock size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
        <p style={{ fontSize: '0.875rem' }}>Le CPC est reserve a l'administrateur ou au gerant.</p>
      </div>
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
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', gap: 6 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Calendar size={12} style={{ color: 'var(--theme-text-muted)' }} />
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            className="odoo-search-input" style={{ width: 140 }} />
          <span style={{ color: 'var(--theme-text-muted)' }}>→</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
            className="odoo-search-input" style={{ width: 140 }} />
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={handleExport} className="odoo-btn-secondary" disabled={!data}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: !data ? 0.5 : 1 }}>
          <Download size={13} /> Exporter CSV
        </button>
      </div>

      {isLoading || !data ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} />
        </div>
      ) : (
        <>
          {/* Synthese */}
          <div className="odoo-stat-grid">
            <div className="odoo-stat-card">
              <div className="odoo-stat-card-label"><TrendingUp size={11} style={{ display: 'inline', marginRight: 4 }} />Produits (classe 7)</div>
              <div className="odoo-stat-card-value" style={{ color: '#0e7c3a' }}>{n(data.total_produits)}</div>
              <div className="odoo-stat-card-sub">DH</div>
            </div>
            <div className="odoo-stat-card">
              <div className="odoo-stat-card-label"><TrendingDown size={11} style={{ display: 'inline', marginRight: 4 }} />Charges (classe 6)</div>
              <div className="odoo-stat-card-value" style={{ color: '#c62828' }}>{n(data.total_charges)}</div>
              <div className="odoo-stat-card-sub">DH</div>
            </div>
            <div className="odoo-stat-card" style={{ border: `1.5px solid ${isProfit ? '#0e7c3a' : '#c62828'}` }}>
              <div className="odoo-stat-card-label">Resultat net</div>
              <div className="odoo-stat-card-value" style={{ color: isProfit ? '#0e7c3a' : '#c62828' }}>
                {isProfit ? '+' : ''}{n(resultat)}
              </div>
              <div className="odoo-stat-card-sub">{isProfit ? 'Benefice' : 'Perte'}</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {/* Produits */}
            <div className="odoo-section" style={{ padding: 0 }}>
              <div style={{ padding: '10px 14px', background: '#f0f9f4', borderBottom: '1px solid var(--theme-bg-separator)', fontWeight: 600, fontSize: '0.8125rem', color: '#0e7c3a' }}>
                Produits
              </div>
              <table className="odoo-table" style={{ margin: 0 }}>
                <tbody>
                  {data.produits.map(p => (
                    <tr key={p.code}>
                      <td style={{ fontFamily: 'ui-monospace, monospace', width: 70 }}>{p.code}</td>
                      <td>{p.label}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' }}>{n(p.amount)}</td>
                    </tr>
                  ))}
                  {data.produits.length === 0 && (
                    <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--theme-text-muted)', fontStyle: 'italic' }}>Aucun produit</td></tr>
                  )}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#f0f9f4', fontWeight: 600 }}>
                    <td colSpan={2}>Total produits</td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{n(data.total_produits)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Charges */}
            <div className="odoo-section" style={{ padding: 0 }}>
              <div style={{ padding: '10px 14px', background: '#fff5f5', borderBottom: '1px solid var(--theme-bg-separator)', fontWeight: 600, fontSize: '0.8125rem', color: '#c62828' }}>
                Charges
              </div>
              <table className="odoo-table" style={{ margin: 0 }}>
                <tbody>
                  {data.charges.map(c => (
                    <tr key={c.code}>
                      <td style={{ fontFamily: 'ui-monospace, monospace', width: 70 }}>{c.code}</td>
                      <td>{c.label}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' }}>{n(c.amount)}</td>
                    </tr>
                  ))}
                  {data.charges.length === 0 && (
                    <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--theme-text-muted)', fontStyle: 'italic' }}>Aucune charge</td></tr>
                  )}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#fff5f5', fontWeight: 600 }}>
                    <td colSpan={2}>Total charges</td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{n(data.total_charges)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
