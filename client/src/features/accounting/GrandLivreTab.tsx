import { useState, useMemo } from 'react';
import SearchSelect from '../../components/ui/SearchSelect';
import { useQuery } from '@tanstack/react-query';
import { Download, Lock, BookOpen, ChevronRight, ChevronDown } from 'lucide-react';
import { financialStatementsApi } from '../../api/ledger.api';
import type { LedgerAccountBlock, LedgerMovement } from '../../api/ledger.api';
import { useAuth } from '../../context/AuthContext';
import EditionButtons from './EditionButtons';
import { currencySymbol } from '../../utils/money';
import { EmptyState, KpiCard, KpiGrid, LoadingState, SearchBar, DataPanel, NoResultState, Toolbar, HeaderActions, DateRangeField } from '../../components/ds';

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
  // n() efface les zéros (colonnes de mouvements) ; un solde nul s'affiche, lui.
  const abs = n(Math.abs(v));
  return abs ? `${abs} ${v >= 0 ? 'D' : 'C'}` : '0,00';
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
      <EmptyState icon={Lock} title="Le grand livre est réservé à l'administrateur ou au gérant." />
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
      <HeaderActions>
        <button type="button" onClick={handleExport} className="odoo-btn-secondary" disabled={accounts.length === 0}>
          <Download size={13} aria-hidden="true" /> Exporter CSV
        </button>
        <EditionButtons kind="grand-livre" params={{ startDate, endDate, class: classFilter === 'all' ? undefined : classFilter }} />
      </HeaderActions>

      {data && (
        <KpiGrid>
          <KpiCard label="Comptes mouvementés" value={accounts.length} sub="sur la période" />
          <KpiCard label="Total débit" value={n(data.total_debit)} sub={currencySymbol()} />
          <KpiCard label="Total crédit" value={n(data.total_credit)} sub={currencySymbol()} />
        </KpiGrid>
      )}

      {/* Barre d'outils : recherche, puis période et classe ; dépliage à droite. */}
      <Toolbar>
        <SearchBar value={search} onChange={setSearch} placeholder="Filtrer un compte…" />
        <DateRangeField from={startDate} to={endDate} onFrom={setStartDate} onTo={setEndDate} />
        <SearchSelect
          options={[1, 2, 3, 4, 5, 6, 7].map(c => ({ id: String(c), label: `Classe ${c} — ${CLASS_LABELS[c]}` }))}
          value={classFilter === 'all' ? '' : String(classFilter)}
          onChange={id => setClassFilter(id === '' ? 'all' : parseInt(id, 10))}
          placeholder="Toutes les classes"
          width={200}
        />
        <span className="ds-grow" />
        <button type="button" onClick={() => setAllOpen(v => !v)} className="ds-btn-ghost ds-btn-sm" aria-pressed={allOpen}>
          {allOpen ? 'Tout replier' : 'Tout déplier'}
        </button>
      </Toolbar>

      {isLoading ? (
        <LoadingState />
      ) : accounts.length === 0 ? (
        (data?.accounts ?? []).length === 0
          ? <EmptyState icon={BookOpen} title="Aucun mouvement sur la période" text="Élargissez la période ou changez de classe." />
          : <NoResultState text="Aucun compte ne correspond à la recherche." onReset={() => setSearch('')} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {accounts.map((a: LedgerAccountBlock) => {
            const open = isOpen(a.code);
            return (
              <DataPanel key={a.code} label={`Compte ${a.code}`}>
                {/* En-tête du compte */}
                <button type="button" onClick={() => toggle(a.code)} aria-expanded={open} style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px',
                  background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 14,
                  borderBottom: open ? '1px solid var(--ds-sep)' : 'none',
                }}>
                  {open ? <ChevronDown size={14} aria-hidden="true" style={{ color: 'var(--ds-muted)' }} /> : <ChevronRight size={14} aria-hidden="true" style={{ color: 'var(--ds-muted)' }} />}
                  <span className="ds-ref" style={{ minWidth: 70 }}>{a.code}</span>
                  <span className="ds-strong" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.label}</span>
                  <span style={{ fontSize: 13, color: 'var(--ds-muted)' }}>{a.movements.length} mouvement{a.movements.length > 1 ? 's' : ''}</span>
                  <span className="ds-num" style={{ fontSize: 13, minWidth: 190, color: 'var(--ds-muted)' }}>
                    D {n(a.total_debit) || '0,00'} · C {n(a.total_credit) || '0,00'}
                  </span>
                  <span className="ds-num ds-strong" style={{ minWidth: 120, color: a.closing >= 0 ? undefined : 'var(--ds-danger)' }}>
                    {sign(a.closing)}
                  </span>
                </button>

                {open && (
                  <table className="odoo-table ds-dense">
                    <thead>
                      <tr>
                        <th style={{ width: 80 }}>Date</th>
                        <th style={{ width: 130 }}>N° d'écriture</th>
                        <th style={{ width: 60 }}>Journal</th>
                        <th>Libellé</th>
                        <th className="ds-num" style={{ width: 100 }}>Débit ({currencySymbol()})</th>
                        <th className="ds-num" style={{ width: 100 }}>Crédit ({currencySymbol()})</th>
                        <th className="ds-num" style={{ width: 110 }}>Solde ({currencySymbol()})</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td colSpan={6} style={{ color: 'var(--ds-muted)' }}>Solde d'ouverture</td>
                        <td className="ds-num ds-strong">{sign(a.opening)}</td>
                      </tr>
                      <RunningRows opening={a.opening} movements={a.movements} />
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className="ds-num" colSpan={4}>Totaux et solde de clôture</td>
                        <td className="ds-num">{n(a.total_debit)}</td>
                        <td className="ds-num">{n(a.total_credit)}</td>
                        <td className="ds-num" style={{ color: a.closing >= 0 ? undefined : 'var(--ds-danger)' }}>{sign(a.closing)}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </DataPanel>
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
            <td>{fmtDate(m.entry_date)}</td>
            <td className="ds-ref">{m.entry_number}</td>
            <td>{m.journal_code}</td>
            <td className="ds-strong">
              {m.auxiliary_label ? <span style={{ color: 'var(--ds-muted)', fontWeight: 400 }}>{m.auxiliary_label} · </span> : ''}
              {m.entry_description || m.line_label || '—'}
            </td>
            <td className="ds-num">{n(m.debit)}</td>
            <td className="ds-num">{n(m.credit)}</td>
            <td className="ds-num ds-strong">{sign(running)}</td>
          </tr>
        );
      })}
    </>
  );
}
