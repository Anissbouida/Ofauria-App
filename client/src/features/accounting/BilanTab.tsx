import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Lock, Download, Scale, Calendar } from 'lucide-react';
import { financialStatementsApi } from '../../api/ledger.api';
import type { BalanceSheet, BilanLine } from '../../api/ledger.api';
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

function MasseLines({ lines }: { lines: BilanLine[] }) {
  if (lines.length === 0) return null;
  return (
    <>
      {lines.map(l => (
        <tr key={l.code}>
          <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.6875rem', color: 'var(--theme-text-muted)', width: 60, paddingLeft: 20 }}>{l.code}</td>
          <td style={{ fontSize: '0.8125rem' }}>{l.label}</td>
          <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums', color: l.amount < 0 ? '#c62828' : undefined }}>{n(l.amount)}</td>
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
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
        <Lock size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
        <p style={{ fontSize: '0.875rem' }}>Le bilan est réservé à l'administrateur ou au gérant.</p>
      </div>
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
    rows.push(['Passif circulant', '', String(data.passif.total_circulant.toFixed(2))]);
    data.passif.circulant.forEach(l => rows.push([l.code, l.label, l.amount.toFixed(2)]));
    rows.push(['Trésorerie-Passif', '', String(data.passif.total_tresorerie.toFixed(2))]);
    data.passif.tresorerie.forEach(l => rows.push([l.code, l.label, l.amount.toFixed(2)]));
    rows.push(['TOTAL PASSIF', '', String(data.passif.total.toFixed(2))]);
    exportCSV(`bilan_${endDate}.csv`, ['CODE', 'LIBELLE', 'MONTANT'], rows);
  };

  const masseHeader = (label: string, total: number) => (
    <tr style={{ background: 'var(--theme-bg-secondary)' }}>
      <td colSpan={2} style={{ fontWeight: 600, fontSize: '0.8125rem' }}>{label}</td>
      <td style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'ui-monospace, monospace' }}>{n(total)}</td>
    </tr>
  );

  return (
    <>
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', gap: 6 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Calendar size={12} style={{ color: 'var(--theme-text-muted)' }} />
          <span style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Arrêté au</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="odoo-search-input" style={{ width: 140 }} />
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
          {/* Contrôle d'équilibre */}
          <div style={{
            padding: '10px 14px', borderRadius: 6, marginBottom: 12,
            background: Math.abs(data.ecart) < 0.01 ? '#E1F5EE' : '#FCEBEB',
            color: Math.abs(data.ecart) < 0.01 ? '#085041' : '#791F1F',
            display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.8125rem',
          }}>
            <Scale size={15} />
            <strong>{Math.abs(data.ecart) < 0.01 ? 'Bilan équilibré' : 'Bilan déséquilibré'}</strong>
            <span>Total actif {n(data.actif.total)} = Total passif {n(data.passif.total)} DH</span>
            {Math.abs(data.ecart) >= 0.01 && <span style={{ marginLeft: 'auto' }}>écart : {n(data.ecart)} DH</span>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {/* ACTIF */}
            <div className="odoo-section" style={{ padding: 0 }}>
              <div style={{ padding: '10px 14px', background: '#e8f0fe', borderBottom: '1px solid var(--theme-bg-separator)', fontWeight: 600, fontSize: '0.875rem', color: '#185fa5' }}>ACTIF</div>
              <table className="odoo-table" style={{ margin: 0 }}>
                <tbody>
                  {masseHeader('Actif immobilisé', data.actif.total_immobilise)}
                  <MasseLines lines={data.actif.immobilise} />
                  {masseHeader('Actif circulant', data.actif.total_circulant)}
                  <MasseLines lines={data.actif.circulant} />
                  {masseHeader('Trésorerie-Actif', data.actif.total_tresorerie)}
                  <MasseLines lines={data.actif.tresorerie} />
                </tbody>
                <tfoot>
                  <tr style={{ background: '#185fa5', color: '#fff', fontWeight: 600 }}>
                    <td colSpan={2}>TOTAL ACTIF</td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{n(data.actif.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* PASSIF */}
            <div className="odoo-section" style={{ padding: 0 }}>
              <div style={{ padding: '10px 14px', background: '#fdeee8', borderBottom: '1px solid var(--theme-bg-separator)', fontWeight: 600, fontSize: '0.875rem', color: '#b3541e' }}>PASSIF</div>
              <table className="odoo-table" style={{ margin: 0 }}>
                <tbody>
                  {masseHeader('Financement permanent', data.passif.total_financement)}
                  <MasseLines lines={data.passif.financement_permanent} />
                  <tr>
                    <td style={{ width: 60, paddingLeft: 20 }}></td>
                    <td style={{ fontSize: '0.8125rem', fontStyle: 'italic' }}>Résultat net de l'exercice</td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums', color: data.passif.resultat_net < 0 ? '#c62828' : '#0e7c3a' }}>{n(data.passif.resultat_net)}</td>
                  </tr>
                  {masseHeader('Passif circulant', data.passif.total_circulant)}
                  <MasseLines lines={data.passif.circulant} />
                  {masseHeader('Trésorerie-Passif', data.passif.total_tresorerie)}
                  <MasseLines lines={data.passif.tresorerie} />
                </tbody>
                <tfoot>
                  <tr style={{ background: '#b3541e', color: '#fff', fontWeight: 600 }}>
                    <td colSpan={2}>TOTAL PASSIF</td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{n(data.passif.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <p style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', marginTop: 8, fontStyle: 'italic' }}>
            Bilan à la date d'arrêté, soldes cumulés. Le résultat net (produits − charges) est porté au financement permanent.
          </p>
        </>
      )}
    </>
  );
}
