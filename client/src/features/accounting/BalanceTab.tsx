import { useState, useMemo, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Download, Lock, Scale, Calendar } from 'lucide-react';
import { financialStatementsApi } from '../../api/ledger.api';
import type { BalanceRow } from '../../api/ledger.api';
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
  if (!Number.isFinite(num) || num === 0) return '';
  return num.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const CLASS_LABELS: Record<number, string> = {
  1: 'Financement permanent', 2: 'Actif immobilise', 3: 'Actif circulant',
  4: 'Passif circulant', 5: 'Tresorerie', 6: 'Charges', 7: 'Produits',
};

export default function BalanceTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const now = new Date();
  const [startDate, setStartDate] = useState(`${now.getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(now.toISOString().slice(0, 10));

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['ledger-balance', startDate, endDate],
    queryFn: () => financialStatementsApi.balance({ startDate, endDate }),
    enabled: isAdmin,
  });

  const totals = useMemo(() => {
    let d = 0, c = 0;
    for (const r of rows as BalanceRow[]) { d += parseFloat(r.total_debit) || 0; c += parseFloat(r.total_credit) || 0; }
    return { debit: d, credit: c, ecart: d - c };
  }, [rows]);

  // Regroupe par classe
  const byClass = useMemo(() => {
    const map = new Map<number, BalanceRow[]>();
    for (const r of rows as BalanceRow[]) {
      if (!map.has(r.account_class)) map.set(r.account_class, []);
      map.get(r.account_class)!.push(r);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [rows]);

  if (!isAdmin) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
        <Lock size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
        <p style={{ fontSize: '0.875rem' }}>La balance est reservee a l'administrateur ou au gerant.</p>
      </div>
    );
  }

  const handleExport = () => {
    const csvRows: string[][] = (rows as BalanceRow[]).map(r => [
      r.code, r.label, r.total_debit, r.total_credit, r.balance,
    ]);
    exportCSV(`balance_${startDate}_${endDate}.csv`,
      ['COMPTE', 'LIBELLE', 'DEBIT', 'CREDIT', 'SOLDE'], csvRows);
  };

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
        <button onClick={handleExport} className="odoo-btn-secondary" disabled={rows.length === 0}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: rows.length === 0 ? 0.5 : 1 }}>
          <Download size={13} /> Exporter CSV
        </button>
      </div>

      {/* Controle d'equilibre */}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">Total debit</div>
          <div className="odoo-stat-card-value" style={{ color: '#1565c0' }}>{n(totals.debit)}</div>
          <div className="odoo-stat-card-sub">DH</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">Total credit</div>
          <div className="odoo-stat-card-value" style={{ color: '#c62828' }}>{n(totals.credit)}</div>
          <div className="odoo-stat-card-sub">DH</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">Equilibre</div>
          <div className="odoo-stat-card-value" style={{ color: Math.abs(totals.ecart) < 0.01 ? '#0e7c3a' : '#c62828' }}>
            {Math.abs(totals.ecart) < 0.01 ? '✓ OK' : n(totals.ecart)}
          </div>
          <div className="odoo-stat-card-sub">debit − credit</div>
        </div>
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} />
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Scale size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>Aucun mouvement sur la periode</p>
        </div>
      ) : (
        <div className="odoo-section" style={{ padding: 0 }}>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th style={{ width: 90 }}>Compte</th>
                <th>Libelle</th>
                <th style={{ width: 120, textAlign: 'right' }}>Debit</th>
                <th style={{ width: 120, textAlign: 'right' }}>Credit</th>
                <th style={{ width: 130, textAlign: 'right' }}>Solde</th>
              </tr>
            </thead>
            <tbody>
              {byClass.map(([cls, items]) => (
                <Fragment key={`cls-${cls}`}>
                  <tr style={{ background: 'var(--theme-bg-secondary)' }}>
                    <td colSpan={5} style={{ fontWeight: 600, fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
                      Classe {cls} — {CLASS_LABELS[cls]}
                    </td>
                  </tr>
                  {items.map(r => {
                    const bal = parseFloat(r.balance) || 0;
                    return (
                      <tr key={r.code}>
                        <td style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{r.code}</td>
                        <td>{r.label}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' }}>{n(r.total_debit)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' }}>{n(r.total_credit)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: bal >= 0 ? '#1565c0' : '#c62828' }}>
                          {n(Math.abs(bal))} {bal >= 0 ? 'D' : 'C'}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--theme-bg-secondary)', fontWeight: 600 }}>
                <td colSpan={2} style={{ textAlign: 'right' }}>Totaux :</td>
                <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{n(totals.debit)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{n(totals.credit)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}
