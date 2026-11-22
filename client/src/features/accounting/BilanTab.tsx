import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Lock, Download, Scale, Calendar } from 'lucide-react';
import { financialStatementsApi } from '../../api/ledger.api';
import type { BilanLine } from '../../api/ledger.api';
import { useAuth } from '../../context/AuthContext';
import EditionButtons from './EditionButtons';
import { money, currencySymbol } from '../../utils/money';
import { EmptyState, LoadingState, Alert, DataPanel, SectionHeader, Toolbar, HeaderActions } from '../../components/ds';

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

function MasseLines({ lines }: { lines: BilanLine[] }) {
  if (lines.length === 0) return null;
  return (
    <>
      {lines.map(l => (
        <tr key={l.code}>
          <td className="ds-ref" style={{ color: 'var(--ds-muted)', width: 60, paddingLeft: 20 }}>{l.code}</td>
          <td style={{ fontSize: '13px' }}>{l.label}</td>
          <td className="ds-num" style={{ color: l.amount < 0 ? 'var(--ds-danger)' : undefined }}>{n(l.amount)}</td>
        </tr>
      ))}
    </>
  );
}

export default function BilanTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const now = new Date();
  const [endDate, setEndDate] = useState(now.toISOString().slice(0, 10));

  const { data, isLoading } = useQuery({
    queryKey: ['ledger-bilan', endDate],
    queryFn: () => financialStatementsApi.balanceSheet(endDate),
    enabled: isAdmin,
  });

  if (!isAdmin) {
    return (
      <EmptyState icon={Lock} title="Le bilan est réservé à l'administrateur ou au gérant." />
    );
  }

  const handleExport = () => {
    if (!data) return;
    const rows: string[][] = [];
    rows.push(['ACTIF', '', '']);
    rows.push(['Actif immobilisé', '', String(data.actif.total_immobilise.toFixed(2))]);
    data.actif.immobilise.forEach(l => rows.push([l.code, l.label, l.amount.toFixed(2)]));
    rows.push(['Actif circulant', '', String(data.actif.total_circulant.toFixed(2))]);
    data.actif.circulant.forEach(l => rows.push([l.code, l.label, l.amount.toFixed(2)]));
    rows.push(['Trésorerie-Actif', '', String(data.actif.total_tresorerie.toFixed(2))]);
    data.actif.tresorerie.forEach(l => rows.push([l.code, l.label, l.amount.toFixed(2)]));
    rows.push(['TOTAL ACTIF', '', String(data.actif.total.toFixed(2))]);
    rows.push(['PASSIF', '', '']);
    rows.push(['Financement permanent', '', String(data.passif.total_financement.toFixed(2))]);
    data.passif.financement_permanent.forEach(l => rows.push([l.code, l.label, l.amount.toFixed(2)]));
    rows.push(['', 'Résultat net de l\'exercice', data.passif.resultat_net.toFixed(2)]);
    if (data.passif.resultat_anterieur) rows.push(['', 'Résultats des exercices antérieurs non clôturés', data.passif.resultat_anterieur.toFixed(2)]);
    rows.push(['Passif circulant', '', String(data.passif.total_circulant.toFixed(2))]);
    data.passif.circulant.forEach(l => rows.push([l.code, l.label, l.amount.toFixed(2)]));
    rows.push(['Trésorerie-Passif', '', String(data.passif.total_tresorerie.toFixed(2))]);
    data.passif.tresorerie.forEach(l => rows.push([l.code, l.label, l.amount.toFixed(2)]));
    rows.push(['TOTAL PASSIF', '', String(data.passif.total.toFixed(2))]);
    exportCSV(`bilan_${endDate}.csv`, ['CODE', 'LIBELLE', 'MONTANT'], rows);
  };

  const masseHeader = (label: string, total: number) => (
    <tr className="ds-group">
      <td colSpan={2}>{label}</td>
      <td className="ds-num">{n(total)}</td>
    </tr>
  );

  return (
    <>
      <HeaderActions>
        <button type="button" onClick={handleExport} className="odoo-btn-secondary" disabled={!data}>
          <Download size={13} aria-hidden="true" /> Exporter CSV
        </button>
        <EditionButtons kind="bilan" params={{ endDate }} />
      </HeaderActions>

      {data && (
        <Alert tone={Math.abs(data.ecart) < 0.01 ? 'success' : 'danger'} icon={Scale}>
          {Math.abs(data.ecart) < 0.01 ? 'Bilan équilibré' : 'Bilan déséquilibré'} · total actif {money(data.actif.total)} · total passif {money(data.passif.total)}
          {Math.abs(data.ecart) >= 0.01 && <> · écart {money(data.ecart)}</>}
        </Alert>
      )}

      <Toolbar>
        <label className="ds-period">
          <Calendar size={14} aria-hidden="true" /> Arrêté au
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="ds-input sm" style={{ width: 150 }} aria-label="Date d'arrêté" />
        </label>
      </Toolbar>

      {isLoading || !data ? (
        <LoadingState />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16, alignItems: 'start' }}>
            {/* ACTIF */}
            <div style={{ display: 'grid', gap: 8 }}>
              <SectionHeader title="Actif" />
              <DataPanel label="Actif">
              <table className="odoo-table ds-dense">
                <thead>
                  <tr><th style={{ width: 80 }}>Compte</th><th>Libellé</th><th className="ds-num">Montant ({currencySymbol()})</th></tr>
                </thead>
                <tbody>
                  {masseHeader('Actif immobilisé', data.actif.total_immobilise)}
                  <MasseLines lines={data.actif.immobilise} />
                  {masseHeader('Actif circulant', data.actif.total_circulant)}
                  <MasseLines lines={data.actif.circulant} />
                  {masseHeader('Trésorerie-Actif', data.actif.total_tresorerie)}
                  <MasseLines lines={data.actif.tresorerie} />
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>Total actif</td>
                    <td className="ds-num">{n(data.actif.total)}</td>
                  </tr>
                </tfoot>
              </table>
              </DataPanel>
            </div>

            {/* PASSIF */}
            <div style={{ display: 'grid', gap: 8 }}>
              <SectionHeader title="Passif" />
              <DataPanel label="Passif">
              <table className="odoo-table ds-dense">
                <thead>
                  <tr><th style={{ width: 80 }}>Compte</th><th>Libellé</th><th className="ds-num">Montant ({currencySymbol()})</th></tr>
                </thead>
                <tbody>
                  {masseHeader('Financement permanent', data.passif.total_financement)}
                  <MasseLines lines={data.passif.financement_permanent} />
                  <tr>
                    <td style={{ width: 60, paddingLeft: 20 }}></td>
                    <td>Résultat net de l'exercice</td>
                    <td className="ds-num" style={{ color: data.passif.resultat_net < 0 ? 'var(--ds-danger)' : 'var(--ds-success)' }}>{n(data.passif.resultat_net)}</td>
                  </tr>
                  {/* Mig 416 : tant que l'exercice précédent n'est pas clôturé, son résultat
                      n'est pas encore reporté (à-nouveaux) : il reste au passif à part. */}
                  {!!data.passif.resultat_anterieur && (
                    <tr>
                      <td style={{ width: 60, paddingLeft: 20 }}></td>
                      <td title="Exercice précédent non encore clôturé : son résultat n'est pas reporté en à-nouveaux">
                        Résultats des exercices antérieurs non clôturés
                      </td>
                      <td className="ds-num" style={{ color: data.passif.resultat_anterieur < 0 ? 'var(--ds-danger)' : 'var(--ds-success)' }}>{n(data.passif.resultat_anterieur)}</td>
                    </tr>
                  )}
                  {masseHeader('Passif circulant', data.passif.total_circulant)}
                  <MasseLines lines={data.passif.circulant} />
                  {masseHeader('Trésorerie-Passif', data.passif.total_tresorerie)}
                  <MasseLines lines={data.passif.tresorerie} />
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>Total passif</td>
                    <td className="ds-num">{n(data.passif.total)}</td>
                  </tr>
                </tfoot>
              </table>
              </DataPanel>
            </div>
          </div>

          <p style={{ fontSize: 13, color: 'var(--ds-muted)', margin: 0 }}>
            Bilan à la date d'arrêté, soldes cumulés. Le résultat net (produits − charges) est porté au financement permanent.
          </p>
        </>
      )}
    </>
  );
}
