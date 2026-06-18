import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Download, Lock, Percent } from 'lucide-react';
import { tvaDeclarationApi } from '../../api/ledger.api';
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

const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

export default function TvaTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const { data, isLoading } = useQuery({
    queryKey: ['ledger-tva', startDate, endDate],
    queryFn: () => tvaDeclarationApi.declaration(startDate, endDate),
    enabled: isAdmin,
  });

  if (!isAdmin) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
        <Lock size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
        <p style={{ fontSize: '0.875rem' }}>La declaration TVA est reservee a l'administrateur.</p>
      </div>
    );
  }

  const handleExport = () => {
    if (!data) return;
    const rows: string[][] = [
      ['TVA COLLECTEE', '', ''],
      ...data.collected.map(c => [c.code, `${c.label} (${c.tva_rate}%)`, c.amount]),
      ['Total collectee', '', String(data.total_collected.toFixed(2))],
      ['TVA DEDUCTIBLE', '', ''],
      ...data.deductible.map(d => [d.code, `${d.label} (${d.tva_rate}%)`, d.amount]),
      ['Total deductible', '', String(data.total_deductible.toFixed(2))],
      ['TVA DUE', '', String(data.tva_due.toFixed(2))],
    ];
    exportCSV(`declaration_tva_${MONTH_NAMES[month - 1]}_${year}.csv`, ['COMPTE', 'LIBELLE', 'MONTANT'], rows);
  };

  const due = data?.tva_due ?? 0;

  return (
    <>
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', gap: 6 }}>
        <select value={month} onChange={e => setMonth(parseInt(e.target.value, 10))} className="odoo-search-input" style={{ minWidth: 130 }}>
          {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select value={year} onChange={e => setYear(parseInt(e.target.value, 10))} className="odoo-search-input" style={{ minWidth: 90 }}>
          {[now.getFullYear(), now.getFullYear() - 1].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
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
          <div className="odoo-stat-grid">
            <div className="odoo-stat-card">
              <div className="odoo-stat-card-label">TVA collectée (ventes)</div>
              <div className="odoo-stat-card-value" style={{ color: '#0e7c3a' }}>{n(data.total_collected)}</div>
              <div className="odoo-stat-card-sub">comptes 445x</div>
            </div>
            <div className="odoo-stat-card">
              <div className="odoo-stat-card-label">TVA déductible (achats)</div>
              <div className="odoo-stat-card-value" style={{ color: '#1565c0' }}>{n(data.total_deductible)}</div>
              <div className="odoo-stat-card-sub">comptes 345x</div>
            </div>
            <div className="odoo-stat-card" style={{ border: `1.5px solid ${due >= 0 ? '#c62828' : '#0e7c3a'}` }}>
              <div className="odoo-stat-card-label">TVA due</div>
              <div className="odoo-stat-card-value" style={{ color: due >= 0 ? '#c62828' : '#0e7c3a' }}>{n(due)}</div>
              <div className="odoo-stat-card-sub">{due >= 0 ? 'à payer à la DGI' : 'crédit à reporter'}</div>
            </div>
          </div>

          <div className="odoo-section" style={{ padding: 0 }}>
            <table className="odoo-table" style={{ margin: 0 }}>
              <tbody>
                <tr style={{ background: '#f0f9f4' }}>
                  <td colSpan={3} style={{ fontWeight: 600, fontSize: '0.8125rem', color: '#0e7c3a' }}>
                    <Percent size={12} style={{ display: 'inline', marginRight: 4 }} />TVA collectée sur ventes
                  </td>
                </tr>
                {data.collected.length === 0 ? (
                  <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--theme-text-muted)', fontStyle: 'italic' }}>Aucune TVA collectée sur la période</td></tr>
                ) : data.collected.map(c => (
                  <tr key={c.code}>
                    <td style={{ fontFamily: 'ui-monospace, monospace', width: 70 }}>{c.code}</td>
                    <td>{c.label} <span style={{ color: 'var(--theme-text-muted)' }}>· {c.tva_rate}%</span></td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' }}>{n(c.amount)}</td>
                  </tr>
                ))}

                <tr style={{ background: '#e8f0fe' }}>
                  <td colSpan={3} style={{ fontWeight: 600, fontSize: '0.8125rem', color: '#1565c0' }}>
                    <Percent size={12} style={{ display: 'inline', marginRight: 4 }} />TVA déductible sur achats
                  </td>
                </tr>
                {data.deductible.length === 0 ? (
                  <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--theme-text-muted)', fontStyle: 'italic' }}>Aucune TVA déductible sur la période</td></tr>
                ) : data.deductible.map(d => (
                  <tr key={d.code}>
                    <td style={{ fontFamily: 'ui-monospace, monospace', width: 70 }}>{d.code}</td>
                    <td>{d.label} <span style={{ color: 'var(--theme-text-muted)' }}>· {d.tva_rate}%</span></td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' }}>{n(d.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 600, background: 'var(--theme-bg-secondary)' }}>
                  <td colSpan={2} style={{ textAlign: 'right' }}>TVA due (collectée − déductible) :</td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: due >= 0 ? '#c62828' : '#0e7c3a' }}>{n(due)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', marginTop: 8, fontStyle: 'italic' }}>
            Base de la déclaration mensuelle CA20. À transmettre à la DGI. Les montants reflètent les écritures comptabilisées de la période.
          </p>
        </>
      )}
    </>
  );
}
