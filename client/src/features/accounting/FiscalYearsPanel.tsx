import { Fragment, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, LockOpen, ShieldCheck, ListChecks, AlertTriangle, CheckCircle2, Fingerprint, Download } from 'lucide-react';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag } from '../../components/ui/StatusTag';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { fiscalYearsApi, type CloseCheck, type FiscalYear } from '../../api/ledger.api';
import { money, currencySymbol } from '../../utils/money';
import { DataPanel, ErrorState, LoadingState, SectionHeader } from '../../components/ds';
import { RowMenu } from '../../components/ui/RowMenu';

const fmt = (v: number | string | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);

/** Téléchargement d'un texte tel quel (UTF-8 sans BOM : l'empreinte SHA-256 de l'attestation porte sur ces octets). */
function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Exercices (mig 416) : clôture annuelle définitive. Elle génère les
 * à-nouveaux au 1er jour de l'exercice suivant (journal AN, par magasin et par
 * tiers, résultat au 1181), verrouille les mois et scelle le grand livre.
 * Chaque exercice s'exporte au format FEC avec son attestation d'intégrité.
 */
export default function FiscalYearsPanel({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [openYear, setOpenYear] = useState<number | null>(null);

  const { data: years = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ['ledger-fiscal-years'], queryFn: fiscalYearsApi.list });

  const close = useMutation({
    mutationFn: (year: number) => fiscalYearsApi.close(year),
    onSuccess: (r) => {
      for (const k of ['ledger-fiscal-years', 'ledger-fiscal-year-checklist', 'ledger-fiscal-periods', 'ledger-integrity', 'ledger-audit-log']) {
        queryClient.invalidateQueries({ queryKey: [k] });
      }
      notify.success(`Exercice ${r.year} clôturé : ${r.opening_entries.length} écriture(s) d'à-nouveaux, ${r.periods_locked} mois verrouillés`);
    },
    onError: (e) => notify.error(apiErrorMessage(e, 'Clôture impossible')),
  });

  const fec = useMutation({
    mutationFn: (year: number) => fiscalYearsApi.fec(year),
    onSuccess: (r) => {
      download(r.filename, r.content);
      download(r.attestationFilename, r.attestation);
      queryClient.invalidateQueries({ queryKey: ['ledger-audit-log'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-integrity'] });
      notify.success(`FEC exporté : ${r.stats.entries} écriture(s), ${r.stats.lines} ligne(s) · SHA-256 ${r.stats.sha256.slice(0, 12)}…`);
    },
    onError: (e) => notify.error(apiErrorMessage(e, 'Export FEC impossible')),
  });

  const doClose = async (fy: FiscalYear) => {
    if (!(await confirm(
      `Clôturer définitivement l'exercice ${fy.year} ? Les à-nouveaux seront générés au 1er janvier ${fy.year + 1}, `
      + `les mois de ${fy.year} verrouillés et le grand livre scellé. Plus aucune écriture ne pourra être passée sur ${fy.year}, `
      + `même par extourne : une correction se fera sur ${fy.year + 1}.`, { title: `Clôturer l'exercice ${fy.year}`, confirmLabel: 'Clôturer l\'exercice', danger: true }))) return;
    close.mutate(fy.year);
  };

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState error={error} title="Les exercices n'ont pas pu être chargés" onRetry={() => refetch()} />;

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <SectionHeader title="Exercices" />
      <DataPanel label="Exercices">
        <table className="odoo-table ds-dense">
          <thead>
            <tr>
              <th style={{ width: 110 }}>Exercice</th>
              <th style={{ width: 200 }}>Dates</th>
              <th style={{ width: 170 }}>Statut</th>
              <th className="ds-num" style={{ width: 170 }}>Résultat ({currencySymbol()})</th>
              <th>À-nouveaux</th>
              <th className="ds-actions" style={{ width: 200 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {years.map(fy => {
              const closed = fy.status === 'closed';
              const ended = String(fy.end_date).slice(0, 10) < today();
              const result = closed ? fy.result_amount : fy.result_to_date;
              const expanded = openYear === fy.year;
              return (
                <Fragment key={fy.id}>
                  <tr>
                    <td className="ds-strong">{fy.year}</td>
                    <td style={{ color: 'var(--ds-muted)' }}>
                      {String(fy.start_date).slice(0, 10)} → {String(fy.end_date).slice(0, 10)}
                    </td>
                    <td>
                      {closed ? (
                        <StatusTag tone="done" icon={ShieldCheck} label="Clôturé" />
                      ) : (
                        <StatusTag tone="progress" icon={LockOpen} label={`Ouvert${fy.months_open ? ` · ${fy.months_open} mois ouverts` : ''}`} />
                      )}
                    </td>
                    <td className="ds-num" style={{ color: Number(result) < 0 ? 'var(--ds-danger)' : undefined }}>
                      {fmt(result)}
                      {!closed && <span style={{ marginLeft: 4, fontSize: 12, color: 'var(--ds-muted)' }}>provisoire</span>}
                    </td>
                    <td className="ds-ref">
                      {fy.opening_entries.length ? fy.opening_entries.join(', ') : '—'}
                    </td>
                    <td className="ds-actions">
                      <button type="button" className="odoo-btn-secondary ds-btn-sm" aria-expanded={expanded} onClick={() => setOpenYear(expanded ? null : fy.year)}>
                        <ListChecks size={12} aria-hidden="true" /> {expanded ? 'Masquer' : 'Contrôles'}
                      </button>
                      <RowMenu label={`Actions sur l'exercice ${fy.year}`} items={[
                        { label: closed ? 'Télécharger le FEC' : 'Télécharger le FEC provisoire', icon: Download, disabled: fec.isPending, onSelect: () => fec.mutate(fy.year) },
                        ...(!closed && isAdmin ? [{ label: ended ? 'Clôturer l\'exercice' : `Clôturer l'exercice (non terminé)`, icon: Lock, danger: true, disabled: !ended || close.isPending, onSelect: () => { void doClose(fy); } }] : []),
                      ]} />
                    </td>
                  </tr>
                  {expanded && (
                    <tr><td colSpan={6} style={{ background: 'var(--ds-bg)', padding: 16 }}>
                      {closed ? <ClosedYear fy={fy} /> : <YearChecks year={fy.year} />}
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </DataPanel>
    </div>
  );
}

/** Exercice clôturé : qui, quand, et l'empreinte à reporter sur le PV de clôture. */
function ClosedYear({ fy }: { fy: FiscalYear }) {
  return (
    <StatusBanner tone="success" icon={ShieldCheck} title={`Exercice ${fy.year} clôturé définitivement`}>
      Le {fy.closed_at ? new Date(fy.closed_at).toLocaleString('fr-FR') : '—'}
      {fy.closed_by_name ? ` par ${fy.closed_by_name}` : ''}. Résultat {money(fy.result_amount)} reporté en instance
      d'affectation (1181) par {fy.opening_entries.join(', ') || 'aucune écriture'}.
      {fy.chain_hash && (
        <>
          <br />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}
            title={fy.chain_hash}>
            <Fingerprint size={11} /> Empreinte de clôture n° {fy.chain_seq} : {fy.chain_hash}
          </span>
        </>
      )}
    </StatusBanner>
  );
}

/** Contrôles de clôture d'un exercice ouvert (fn_fiscal_year_checklist). */
function YearChecks({ year }: { year: number }) {
  const { data: checks = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ledger-fiscal-year-checklist', year], queryFn: () => fiscalYearsApi.checklist(year),
  });
  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState error={error} title="Les contrôles n'ont pas pu être chargés" onRetry={() => refetch()} />;
  const rows = (checks as CloseCheck[]).filter(c => c.code !== 'result');
  const result = (checks as CloseCheck[]).find(c => c.code === 'result');
  const blocking = rows.filter(c => c.blocking && c.item_count > 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {blocking.length > 0
        ? <StatusBanner tone="danger" icon={AlertTriangle} title={`${blocking.length} contrôle(s) bloquant(s)`}>L'exercice ne peut pas être clôturé tant qu'ils ne sont pas résolus.</StatusBanner>
        : <StatusBanner tone="success" icon={CheckCircle2} title="Aucun point bloquant">
            Les mois sans écriture encore ouverts seront fermés d'office ; les à-nouveaux reprendront le résultat de {money(result?.amount)}.
          </StatusBanner>}
      <DataPanel label={`Contrôles de clôture ${year}`}>
      <table className="odoo-table ds-dense">
        <thead><tr><th>Contrôle</th><th className="ds-num" style={{ width: 90 }}>Nombre</th><th className="ds-num" style={{ width: 130 }}>Montant ({currencySymbol()})</th><th style={{ width: 120 }}>Effet</th></tr></thead>
        <tbody>
          {rows.map(c => (
            <tr key={c.code}>
              <td>{c.label}</td>
              <td className="ds-num">{c.item_count}</td>
              <td className="ds-num">{c.amount != null && c.item_count > 0 ? fmt(c.amount) : '—'}</td>
              <td>{c.item_count === 0
                ? <StatusTag tone="done" label="OK" />
                : c.blocking ? <StatusTag tone="blocked" label="Bloquant" /> : <StatusTag tone="todo" label="À examiner" />}</td>
            </tr>
          ))}
        </tbody>
        {result && (
          <tfoot>
            <tr>
              <td className="ds-strong">{result.label}</td>
              <td />
              <td className="ds-num ds-strong" style={{ color: Number(result.amount) < 0 ? 'var(--ds-danger)' : 'var(--ds-success)' }}>{fmt(result.amount)}</td>
              <td><StatusTag tone="draft" label="Information" /></td>
            </tr>
          </tfoot>
        )}
      </table>
      </DataPanel>
    </div>
  );
}
