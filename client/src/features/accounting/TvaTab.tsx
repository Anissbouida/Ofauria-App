import { useState } from 'react';
import SearchSelect from '../../components/ui/SearchSelect';
import { useQuery } from '@tanstack/react-query';
import { Download, Lock, Percent, Hourglass, Ban } from 'lucide-react';
import { tvaDeclarationApi, purchaseLedgerApi } from '../../api/ledger.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { purchasingReportsApi } from '../../api/purchasing-reports.api';
import { notify } from '../../components/ui/InlineNotification';
import { FileSearch } from 'lucide-react';

const REASON_LABEL: Record<string, string> = {
  cash_over_limit: 'Espèces au-delà du plafond', missing_mentions: 'Mentions légales manquantes',
  inactive_supplier: 'Fournisseur inactif', no_invoice: 'Sans facture', personal: 'Dépense personnelle',
  exempt_supplier: 'Fournisseur non assujetti', manual: 'Décision manuelle',
};
import { useAuth } from '../../context/AuthContext';
import { money, currencySymbol } from '../../utils/money';
import { DataPanel, EmptyState, ErrorState, HeaderActions, KpiCard, KpiGrid, LoadingState, SectionHeader, Toolbar } from '../../components/ds';
import { StatusTag } from '../../components/ui/StatusTag';

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
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ledger-tva', startDate, endDate],
    queryFn: () => tvaDeclarationApi.declaration(startDate, endDate),
    enabled: isAdmin,
  });
  // Mig 311 (G-D8-15) : relevé des déductions (droit né au règlement, CGI art. 101).
  const { data: statement = [] } = useQuery({
    queryKey: ['ledger-vat-statement', startDate, endDate],
    queryFn: () => purchaseLedgerApi.vatStatement(startDate, endDate),
    enabled: isAdmin,
  });
  const exportStatement = () => exportCSV(`releve-deductions-${year}-${String(month).padStart(2, '0')}.csv`,
    ['Facture', 'N° fournisseur', 'Date facture', 'Fournisseur', 'ICE', 'IF', 'HT', 'TVA', 'TTC', 'Droit né le', 'Récupérable', 'Motif', 'Règlements'],
    statement.map(r => [r.invoice_number, r.supplier_invoice_number ?? '', String(r.invoice_date).slice(0, 10), r.supplier_name,
      r.supplier_ice ?? '', r.supplier_if ?? '', r.amount_ht, r.amount_tva, r.amount_ttc,
      r.vat_recoverable_from ? String(r.vat_recoverable_from).slice(0, 10) : '', r.is_vat_recoverable ? 'oui' : 'non',
      r.vat_non_recoverable_reason ? (REASON_LABEL[r.vat_non_recoverable_reason] ?? r.vat_non_recoverable_reason) : '',
      (r.payments ?? '').replace(/;/g, ',')]));

  if (!isAdmin) {
    return (
      <EmptyState icon={Lock} title="La déclaration TVA est réservée à l'administrateur ou au gérant." />
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
      <HeaderActions>
        <button type="button" onClick={handleExport} className="odoo-btn-secondary" disabled={!data}>
          <Download size={13} aria-hidden="true" /> Exporter CSV
        </button>
      </HeaderActions>

      {data && (
        <>
        {data.regime?.mode === 'encaissement' && (
          <StatusBanner tone="info" icon={Percent} title={`Régime des encaissements depuis le ${(data.regime.since ?? '').split('-').reverse().join('/')}`}>
            La TVA des factures et tickets à crédit est déclarée au fur et à mesure des règlements.
            {(data.awaiting_collection ?? 0) > 0 && ` TVA facturée non encore encaissée au ${endDate.split('-').reverse().join('/')} : ${money(data.awaiting_collection ?? 0)}.`}
          </StatusBanner>
        )}
        {data.regime?.missing_since && (
          <StatusBanner tone="warning" icon={Hourglass} title="Régime des encaissements sans date de bascule">
            La déclaration reste calculée au régime des débits. Renseignez la date de bascule dans Paramètres › Ventes › Régime de TVA.
          </StatusBanner>
        )}
        {data.pending_payment && data.pending_payment.count > 0 && (
          <StatusBanner tone="info" icon={Hourglass} title={`TVA en attente de règlement : ${money(data.pending_payment.amount)}`}>
            {data.pending_payment.count} facture(s) fournisseur non soldée(s) au {endDate.split('-').reverse().join('/')} : leur TVA sera déductible le mois de leur règlement.
          </StatusBanner>
        )}
        {(() => {
          // Mig 312 (D9 G-D9-09) : signalements, sans exclusion automatique (décision de l'expert-comptable).
          const noIce = statement.filter(r => r.flag_no_ice && r.is_vat_recoverable);
          const internal = statement.filter(r => r.flag_internal_number && r.is_vat_recoverable);
          if (!noIce.length && !internal.length) return null;
          return (
            <StatusBanner tone="warning" icon={FileSearch} title="Déductions à justifier">
              {noIce.length > 0 && `${noIce.length} facture(s) d'un fournisseur sans ICE (${money(noIce.reduce((t, r) => t + parseFloat(r.amount_tva), 0))} de TVA). `}
              {internal.length > 0 && `${internal.length} facture(s) sans numéro du fournisseur (numéro interne). `}
              Complétez la fiche fournisseur ou la facture avant de déposer la déclaration.
            </StatusBanner>
          );
        })()}
        {(data.excluded ?? []).map(x => (
          <StatusBanner key={x.reason} tone="warning" icon={Ban} title={`TVA non récupérable : ${money(x.amount)}`}>
            {x.count} facture(s) — {REASON_LABEL[x.reason] ?? x.reason}. Cette TVA reste une charge.
          </StatusBanner>
        ))}
        <KpiGrid>
          <KpiCard label="TVA collectée (ventes)" value={n(data.total_collected)} sub="comptes 445x" />
          <KpiCard label="TVA déductible (achats)" value={n(data.total_deductible)} sub="comptes 345x" />
          <KpiCard label="TVA due" value={n(due)} sub={due >= 0 ? 'à payer à la DGI' : 'crédit à reporter'} tone={due >= 0 ? 'red' : 'green'} />
        </KpiGrid>
        </>
      )}

      <Toolbar>
        <SearchSelect
          options={MONTH_NAMES.map((m, i) => ({ id: String(i + 1), label: m }))}
          value={String(month)}
          onChange={id => id && setMonth(parseInt(id, 10))}
          placeholder="Mois"
          width={150}
        />
        <SearchSelect
          options={[now.getFullYear(), now.getFullYear() - 1].map(y => ({ id: String(y), label: String(y) }))}
          value={String(year)}
          onChange={id => id && setYear(parseInt(id, 10))}
          placeholder="Année"
          width={110}
        />
      </Toolbar>

      {isError ? (
        <ErrorState error={error} title="La déclaration de TVA n'a pas pu être calculée" onRetry={() => refetch()} />
      ) : isLoading || !data ? (
        <LoadingState />
      ) : (
        <>
          <DataPanel label="Déclaration de TVA">
            <table className="odoo-table ds-dense">
              <thead>
                <tr><th style={{ width: 80 }}>Compte</th><th>Libellé</th><th className="ds-num">Montant ({currencySymbol()})</th></tr>
              </thead>
              <tbody>
                <tr className="ds-group"><td colSpan={3}>TVA collectée sur ventes</td></tr>
                {data.collected.length === 0 ? (
                  <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--ds-muted)' }}>Aucune TVA collectée sur la période</td></tr>
                ) : data.collected.map(c => (
                  <tr key={c.code}>
                    <td className="ds-ref" style={{ width: 70 }}>{c.code}</td>
                    <td>{c.label} <span style={{ color: 'var(--ds-muted)' }}>· {c.tva_rate}%</span></td>
                    <td className="ds-num">{n(c.amount)}</td>
                  </tr>
                ))}

                <tr className="ds-group"><td colSpan={3}>TVA déductible sur achats</td></tr>
                {data.deductible.length === 0 ? (
                  <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--ds-muted)' }}>Aucune TVA déductible sur la période</td></tr>
                ) : data.deductible.map(d => (
                  <tr key={d.code}>
                    <td className="ds-ref" style={{ width: 70 }}>{d.code}</td>
                    <td>{d.label} <span style={{ color: 'var(--ds-muted)' }}>· {d.tva_rate}%</span></td>
                    <td className="ds-num">{n(d.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="ds-num" colSpan={2}>TVA due (collectée − déductible)</td>
                  <td className="ds-num" style={{ color: due >= 0 ? 'var(--ds-danger)' : 'var(--ds-success)' }}>{n(due)}</td>
                </tr>
              </tfoot>
            </table>
          </DataPanel>

          <p style={{ fontSize: 13, color: 'var(--ds-muted)', margin: 0 }}>
            Base de la déclaration mensuelle CA20. TVA collectée : écritures de la période. TVA déductible : factures fournisseurs
            dont le règlement complet est intervenu dans la période (le droit à déduction naît au paiement).
          </p>

          <SectionHeader title="Relevé des déductions" note={`${statement.length} facture${statement.length > 1 ? 's' : ''}`}>
            <button type="button" className="odoo-btn-secondary ds-btn-sm"
              onClick={() => purchasingReportsApi.exportPurchaseJournal(startDate, endDate).catch(() => notify.error('Export impossible'))}>
              <Download size={12} aria-hidden="true" /> Journal des achats</button>
            <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={statement.length === 0} onClick={exportStatement}><Download size={12} aria-hidden="true" /> Exporter</button>
          </SectionHeader>
          <DataPanel label="Relevé des déductions">
            <table className="odoo-table ds-dense">
              <thead><tr><th>Fournisseur</th><th style={{ width: 130 }}>ICE</th><th style={{ width: 120 }}>Facture</th><th style={{ width: 95 }}>Droit né le</th>
                <th className="ds-num" style={{ width: 110 }}>HT ({currencySymbol()})</th><th className="ds-num" style={{ width: 110 }}>TVA ({currencySymbol()})</th><th>Règlements</th></tr></thead>
              <tbody>
                {statement.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--ds-muted)' }}>Aucune facture déductible sur la période</td></tr>
                ) : statement.map(r => (
                  <tr key={r.invoice_id} style={!r.is_vat_recoverable ? { opacity: 0.6 } : undefined}>
                    <td className="ds-strong">{r.supplier_name}</td>
                    <td className="ds-ref">{r.supplier_ice || <StatusTag tone="todo" label="sans ICE" />}</td>
                    <td className="ds-ref">{r.supplier_invoice_number || r.invoice_number}</td>
                    <td>{r.vat_recoverable_from ? String(r.vat_recoverable_from).slice(0, 10).split('-').reverse().join('/') : '—'}</td>
                    <td className="ds-num">{n(r.amount_ht)}</td>
                    <td className="ds-num">
                      {n(r.amount_tva)} {!r.is_vat_recoverable && <StatusTag tone="blocked" label="exclue" title={REASON_LABEL[r.vat_non_recoverable_reason ?? ''] ?? ''} />}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--ds-muted)' }}>{r.payments || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataPanel>
        </>
      )}
    </>
  );
}
