import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Download, Lock, BookOpen, Calendar, Search, X, ChevronRight, ChevronDown } from 'lucide-react';
import { financialStatementsApi } from '../../api/ledger.api';
import type { LedgerAccountBlock, LedgerMovement } from '../../api/ledger.api';
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
function sign(v: number): string {
  return `${n(Math.abs(v))} ${v >= 0 ? 'D' : 'C'}`;
}
function fmtDate(raw: string | null): string {
  if (!raw) return '';
  const s = String(raw).slice(0, 10);
  if (s.length !== 10) return s;
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

const CLASS_LABELS: Record<number, string> = {
  1: 'Financement permanent', 2: 'Actif immobilisé', 3: 'Actif circulant',
  4: 'Passif circulant', 5: 'Trésorerie', 6: 'Charges', 7: 'Produits',
};

export default function GrandLivreTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const now = new Date();
  const [startDate, setStartDate] = useState(`${now.getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(now.toISOString().slice(0, 10));
  const [classFilter, setClassFilter] = useState<number | 'all'>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [allOpen, setAllOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['ledger-general-ledger-full', startDate, endDate, classFilter],
    queryFn: () => financialStatementsApi.generalLedgerFull({
      startDate, endDate,
      class: classFilter === 'all' ? undefined : classFilter,
    }),
    enabled: isAdmin,
  });

  // Filtre texte cote client (code ou libelle)
  const accounts = useMemo(() => {
    const all = data?.accounts ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(a => a.code.toLowerCase().includes(q) || a.label.toLowerCase().includes(q));
  }, [data, search]);

  if (!isAdmin) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
        <Lock size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
        <p style={{ fontSize: '0.875rem' }}>Le grand livre est réservé à l'administrateur ou au gérant.</p>
      </div>
    );
  }

  const toggle = (code: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(code)) next.delete(code); else next.add(code);
    return next;
  });
  const isOpen = (code: string) => allOpen || expanded.has(code) || !!search;

  const handleExport = () => {
    const rows: string[][] = [];
    for (const a of accounts) {
      rows.push([a.code, a.label, '', '', 'Solde ouverture', '', '', a.opening.toFixed(2)]);
      let running = a.opening;
      for (const m of a.movements) {
        running += (parseFloat(m.debit) || 0) - (parseFloat(m.credit) || 0);
        rows.push([a.code, '', fmtDate(m.entry_date), m.entry_number,
          m.entry_description || m.line_label || '', m.debit, m.credit, running.toFixed(2)]);
      }
      rows.push([a.code, '', '', '', 'Solde clôture', a.total_debit.toFixed(2), a.total_credit.toFixed(2), a.closing.toFixed(2)]);
    }
    exportCSV(`grand_livre_${startDate}_${endDate}.csv`,
      ['COMPTE', 'LIBELLE', 'DATE', 'N ECRITURE', 'DESCRIPTION', 'DEBIT', 'CREDIT', 'SOLDE'], rows);
  };

  return (
    <>
      {/* Filtres : periode + classe + recherche */}
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', gap: 6 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Calendar size={12} style={{ color: 'var(--theme-text-muted)' }} />
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="odoo-search-input" style={{ width: 140 }} />
          <span style={{ color: 'var(--theme-text-muted)' }}>→</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="odoo-search-input" style={{ width: 140 }} />
        </div>
        <select value={classFilter} onChange={e => setClassFilter(e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10))} className="odoo-search-input" style={{ minWidth: 170 }}>
          <option value="all">Toutes les classes</option>
          {[1, 2, 3, 4, 5, 6, 7].map(c => <option key={c} value={c}>Classe {c} — {CLASS_LABELS[c]}</option>)}
        </select>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flex: '1 1 180px', minWidth: 160 }}>
          <Search size={13} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
          <input type="text" placeholder="Filtrer un compte..." value={search} onChange={e => setSearch(e.target.value)} className="odoo-search-input" style={{ flex: 1, minWidth: 0 }} />
          {search && <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--theme-text-muted)' }}><X size={12} /></button>}
        </div>
        <button onClick={() => setAllOpen(v => !v)} className="odoo-btn-secondary" style={{ fontSize: '0.75rem' }}>
          {allOpen ? 'Tout replier' : 'Tout déplier'}
        </button>
        <button onClick={handleExport} className="odoo-btn-secondary" disabled={accounts.length === 0}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: accounts.length === 0 ? 0.5 : 1 }}>
          <Download size={13} /> Exporter CSV
        </button>
      </div>

      {data && (
        <div className="odoo-stat-grid">
          <div className="odoo-stat-card">
            <div className="odoo-stat-card-label">Comptes mouvementés</div>
            <div className="odoo-stat-card-value">{accounts.length}</div>
            <div className="odoo-stat-card-sub">sur la période</div>
          </div>
          <div className="odoo-stat-card">
            <div className="odoo-stat-card-label">Total débit</div>
            <div className="odoo-stat-card-value" style={{ color: '#1565c0' }}>{n(data.total_debit)}</div>
            <div className="odoo-stat-card-sub">DH</div>
          </div>
          <div className="odoo-stat-card">
            <div className="odoo-stat-card-label">Total crédit</div>
            <div className="odoo-stat-card-value" style={{ color: '#c62828' }}>{n(data.total_credit)}</div>
            <div className="odoo-stat-card-sub">DH</div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} />
        </div>
      ) : accounts.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <BookOpen size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>Aucun mouvement sur la période</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {accounts.map((a: LedgerAccountBlock) => {
            const open = isOpen(a.code);
            return (
              <div key={a.code} className="odoo-section" style={{ padding: 0 }}>
                {/* En-tete du compte */}
                <button onClick={() => toggle(a.code)} style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                  background: 'var(--theme-bg-secondary)', border: 'none', cursor: 'pointer', textAlign: 'left',
                  borderBottom: open ? '1px solid var(--theme-bg-separator)' : 'none',
                }}>
                  {open ? <ChevronDown size={14} style={{ color: 'var(--theme-text-muted)' }} /> : <ChevronRight size={14} style={{ color: 'var(--theme-text-muted)' }} />}
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600, minWidth: 70 }}>{a.code}</span>
                  <span style={{ fontWeight: 500, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.label}</span>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>{a.movements.length} mvt</span>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem', minWidth: 180, textAlign: 'right' }}>
                    <span style={{ color: 'var(--theme-text-muted)' }}>D {n(a.total_debit)} · C {n(a.total_credit)}</span>
                  </span>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600, minWidth: 110, textAlign: 'right', color: a.closing >= 0 ? '#1565c0' : '#c62828' }}>
                    {sign(a.closing)}
                  </span>
                </button>

                {open && (
                  <table className="odoo-table" style={{ margin: 0 }}>
                    <thead>
                      <tr>
                        <th style={{ width: 80 }}>Date</th>
                        <th style={{ width: 130 }}>N écriture</th>
                        <th style={{ width: 44 }}>Jr</th>
                        <th>Libellé</th>
                        <th style={{ width: 100, textAlign: 'right' }}>Débit</th>
                        <th style={{ width: 100, textAlign: 'right' }}>Crédit</th>
                        <th style={{ width: 110, textAlign: 'right' }}>Solde</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ background: 'var(--theme-bg-tertiary)' }}>
                        <td colSpan={6} style={{ fontStyle: 'italic', color: 'var(--theme-text-muted)', fontSize: '0.75rem' }}>Solde d'ouverture</td>
                        <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{sign(a.opening)}</td>
                      </tr>
                      <RunningRows opening={a.opening} movements={a.movements} />
                    </tbody>
                    <tfoot>
                      <tr style={{ background: 'var(--theme-bg-secondary)', fontWeight: 600 }}>
                        <td colSpan={4} style={{ textAlign: 'right' }}>Totaux / Solde de clôture :</td>
                        <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{n(a.total_debit)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{n(a.total_credit)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: a.closing >= 0 ? '#1565c0' : '#c62828' }}>{sign(a.closing)}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function RunningRows({ opening, movements }: { opening: number; movements: LedgerMovement[] }) {
  let running = opening;
  return (
    <>
      {movements.map((m, i) => {
        running += (parseFloat(m.debit) || 0) - (parseFloat(m.credit) || 0);
        return (
          <tr key={i}>
            <td style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{fmtDate(m.entry_date)}</td>
            <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem', color: '#185fa5' }}>{m.entry_number}</td>
            <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.6875rem' }}>{m.journal_code}</td>
            <td style={{ fontSize: '0.8125rem' }}>
              {m.auxiliary_label ? <span style={{ color: 'var(--theme-text-muted)' }}>{m.auxiliary_label} · </span> : ''}
              {m.entry_description || m.line_label || '—'}
            </td>
            <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' }}>{n(m.debit)}</td>
            <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' }}>{n(m.credit)}</td>
            <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{sign(running)}</td>
          </tr>
        );
      })}
    </>
  );
}
