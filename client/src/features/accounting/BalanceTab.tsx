import { useState, useMemo, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Lock, Scale } from 'lucide-react';
import { financialStatementsApi } from '../../api/ledger.api';
import type { BalanceRow } from '../../api/ledger.api';
import { useAuth } from '../../context/AuthContext';
import EditionButtons from './EditionButtons';
import { currencySymbol } from '../../utils/money';
import { DataPanel, EmptyState, KpiCard, KpiGrid, LoadingState, TableFooter, Toolbar, HeaderActions, DateRangeField } from '../../components/ds';

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
  1: 'Financement permanent', 2: 'Actif immobilisé', 3: 'Actif circulant',
  4: 'Passif circulant', 5: 'Trésorerie', 6: 'Charges', 7: 'Produits',
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
      <EmptyState icon={Lock} title="La balance est réservée à l'administrateur ou au gérant." />
    );
  }

  const handleExport = () => {
    const csvRows: string[][] = (rows as BalanceRow[]).map(r => [
      r.code, r.label, String(r.opening ?? 0), r.total_debit, r.total_credit, String(r.closing ?? r.balance),
    ]);
    exportCSV(`balance_${startDate}_${endDate}.csv`,
      ['COMPTE', 'LIBELLE', 'OUVERTURE', 'DEBIT', 'CREDIT', 'CLOTURE'], csvRows);
  };

  return (
    <>
      {/* Contrôle d'équilibre */}
      <KpiGrid>
        <KpiCard label="Total débit" value={n(totals.debit)} sub={currencySymbol()} />
        <KpiCard label="Total crédit" value={n(totals.credit)} sub={currencySymbol()} />
        <KpiCard label="Équilibre" value={Math.abs(totals.ecart) < 0.01 ? '✓ OK' : n(totals.ecart)} sub="débit − crédit" tone={Math.abs(totals.ecart) < 0.01 ? 'green' : 'red'} />
      </KpiGrid>

      <HeaderActions>
        <button type="button" onClick={handleExport} className="odoo-btn-secondary" disabled={rows.length === 0}>
          <Download size={13} aria-hidden="true" /> Exporter CSV
        </button>
        <EditionButtons kind="balance" params={{ startDate, endDate }} />
      </HeaderActions>

      <Toolbar>
        <DateRangeField from={startDate} to={endDate} onFrom={setStartDate} onTo={setEndDate} />
      </Toolbar>

      {isLoading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState icon={Scale} title="Aucun mouvement sur la période" text="Élargissez la période pour afficher les comptes mouvementés." />
      ) : (
        <DataPanel label="Balance générale" footer={<TableFooter note={`${rows.length} compte${rows.length > 1 ? 's' : ''} · débit ${n(totals.debit) || '0,00'} · crédit ${n(totals.credit) || '0,00'} ${currencySymbol()}`} />}>
          <table className="odoo-table ds-dense">
            <thead>
              <tr>
                <th style={{ width: 90 }}>Compte</th>
                <th>Libellé</th>
                <th className="ds-num" style={{ width: 130 }} title="Solde au début de la période, à-nouveaux compris">Ouverture ({currencySymbol()})</th>
                <th className="ds-num" style={{ width: 120 }}>Débit ({currencySymbol()})</th>
                <th className="ds-num" style={{ width: 120 }}>Crédit ({currencySymbol()})</th>
                <th className="ds-num" style={{ width: 130 }} title="Ouverture + mouvements de la période">Clôture ({currencySymbol()})</th>
              </tr>
            </thead>
            <tbody>
              {byClass.map(([cls, items]) => (
                <Fragment key={`cls-${cls}`}>
                  <tr className="ds-group">
                    <td colSpan={6}>Classe {cls} — {CLASS_LABELS[cls]}<small>{items.length} compte{items.length > 1 ? 's' : ''}</small></td>
                  </tr>
                  {items.map(r => {
                    const bal = r.closing ?? (parseFloat(r.balance) || 0);
                    const open = r.opening ?? 0;
                    return (
                      <tr key={r.code}>
                        <td className="ds-ref">{r.code}</td>
                        <td className="ds-strong">{r.label}</td>
                        <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>
                          {open === 0 ? '—' : `${n(Math.abs(open))} ${open > 0 ? 'D' : 'C'}`}
                        </td>
                        <td className="ds-num">{n(r.total_debit)}</td>
                        <td className="ds-num">{n(r.total_credit)}</td>
                        <td className="ds-num ds-strong">
                          {Math.round(bal * 100) === 0 ? '0,00' : `${n(Math.abs(bal))} ${bal > 0 ? 'D' : 'C'}`}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="ds-num" colSpan={3}>Totaux des mouvements</td>
                <td className="ds-num">{n(totals.debit)}</td>
                <td className="ds-num">{n(totals.credit)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </DataPanel>
      )}
    </>
  );
}
