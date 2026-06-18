import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Download, Lock, BookOpen, Calendar } from 'lucide-react';
import { financialStatementsApi, planComptableApi } from '../../api/ledger.api';
import type { LedgerMovement } from '../../api/ledger.api';
import type { Account } from '@ofauria/shared';
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

function fmtDate(raw: string | null): string {
  if (!raw) return '';
  const s = String(raw).slice(0, 10);
  if (s.length !== 10) return s;
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

export default function GrandLivreTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const now = new Date();
  const [accountCode, setAccountCode] = useState('4411');
  const [startDate, setStartDate] = useState(`${now.getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(now.toISOString().slice(0, 10));

  const { data: accounts = [] } = useQuery({
    queryKey: ['ledger-accounts'],
    queryFn: () => planComptableApi.list(),
    enabled: isAdmin,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['ledger-general-ledger', accountCode, startDate, endDate],
    queryFn: () => financialStatementsApi.generalLedger(accountCode, { startDate, endDate }),
    enabled: isAdmin && !!accountCode,
  });

  // Calcul du solde progressif
  const withRunning = useMemo(() => {
    if (!data) return [];
    let running = data.opening;
    return data.movements.map((m: LedgerMovement) => {
      running += (parseFloat(m.debit) || 0) - (parseFloat(m.credit) || 0);
      return { ...m, running };
    });
  }, [data]);

  const totals = useMemo(() => {
    if (!data) return { debit: 0, credit: 0 };
    let d = 0, c = 0;
    for (const m of data.movements) { d += parseFloat(m.debit) || 0; c += parseFloat(m.credit) || 0; }
    return { debit: d, credit: c };
  }, [data]);

  if (!isAdmin) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
        <Lock size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
        <p style={{ fontSize: '0.875rem' }}>Le grand livre est reserve a l'administrateur ou au gerant.</p>
      </div>
    );
  }

  const handleExport = () => {
    const rows: string[][] = withRunning.map(m => [
      fmtDate(m.entry_date), m.entry_number, m.journal_code,
      m.entry_description || m.line_label || '',
      m.debit, m.credit, String(m.running.toFixed(2)),
    ]);
    exportCSV(`grand_livre_${accountCode}_${startDate}_${endDate}.csv`,
      ['DATE', 'N ECRITURE', 'JOURNAL', 'LIBELLE', 'DEBIT', 'CREDIT', 'SOLDE'], rows);
  };

  const closingBalance = data ? data.opening + totals.debit - totals.credit : 0;

  return (
    <>
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', gap: 6 }}>
        <select value={accountCode} onChange={e => setAccountCode(e.target.value)}
          className="odoo-search-input" style={{ minWidth: 320, flex: '1 1 280px' }}>
          {(accounts as Account[]).map(a => (
            <option key={a.code} value={a.code}>{a.code} — {a.label}</option>
          ))}
        </select>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Calendar size={12} style={{ color: 'var(--theme-text-muted)' }} />
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            className="odoo-search-input" style={{ width: 140 }} />
          <span style={{ color: 'var(--theme-text-muted)' }}>→</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
            className="odoo-search-input" style={{ width: 140 }} />
        </div>
        <button onClick={handleExport} className="odoo-btn-secondary" disabled={!data || data.movements.length === 0}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: (!data || data.movements.length === 0) ? 0.5 : 1 }}>
          <Download size={13} /> Exporter CSV
        </button>
      </div>

      {data && (
        <div className="odoo-stat-grid">
          <div className="odoo-stat-card">
            <div className="odoo-stat-card-label">Solde d'ouverture</div>
            <div className="odoo-stat-card-value">{n(Math.abs(data.opening))} {data.opening >= 0 ? 'D' : 'C'}</div>
            <div className="odoo-stat-card-sub">avant {fmtDate(startDate)}</div>
          </div>
          <div className="odoo-stat-card">
            <div className="odoo-stat-card-label">Mouvements</div>
            <div className="odoo-stat-card-value">{data.movements.length}</div>
            <div className="odoo-stat-card-sub">D {n(totals.debit)} · C {n(totals.credit)}</div>
          </div>
          <div className="odoo-stat-card">
            <div className="odoo-stat-card-label">Solde de cloture</div>
            <div className="odoo-stat-card-value" style={{ color: closingBalance >= 0 ? '#1565c0' : '#c62828' }}>
              {n(Math.abs(closingBalance))} {closingBalance >= 0 ? 'D' : 'C'}
            </div>
            <div className="odoo-stat-card-sub">au {fmtDate(endDate)}</div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} />
        </div>
      ) : !data || data.movements.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <BookOpen size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>Aucun mouvement sur ce compte pour la periode</p>
        </div>
      ) : (
        <div className="odoo-section" style={{ padding: 0 }}>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th style={{ width: 80 }}>Date</th>
                <th style={{ width: 130 }}>N ecriture</th>
                <th style={{ width: 50 }}>Jr</th>
                <th>Libelle</th>
                <th style={{ width: 100, textAlign: 'right' }}>Debit</th>
                <th style={{ width: 100, textAlign: 'right' }}>Credit</th>
                <th style={{ width: 120, textAlign: 'right' }}>Solde</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ background: 'var(--theme-bg-secondary)' }}>
                <td colSpan={6} style={{ fontStyle: 'italic', color: 'var(--theme-text-muted)', fontSize: '0.75rem' }}>Solde d'ouverture</td>
                <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>
                  {n(Math.abs(data.opening))} {data.opening >= 0 ? 'D' : 'C'}
                </td>
              </tr>
              {withRunning.map((m, idx) => (
                <tr key={idx}>
                  <td style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{fmtDate(m.entry_date)}</td>
                  <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem', color: '#185fa5' }}>{m.entry_number}</td>
                  <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.6875rem' }}>{m.journal_code}</td>
                  <td style={{ fontSize: '0.8125rem' }}>
                    {m.auxiliary_label ? <span style={{ color: 'var(--theme-text-muted)' }}>{m.auxiliary_label} · </span> : ''}
                    {m.entry_description || m.line_label || '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' }}>{n(m.debit)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' }}>{n(m.credit)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                    {n(Math.abs(m.running))} {m.running >= 0 ? 'D' : 'C'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
