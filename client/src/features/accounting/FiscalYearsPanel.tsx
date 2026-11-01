import { Fragment, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Lock, LockOpen, ShieldCheck, ListChecks, AlertTriangle, CheckCircle2, CalendarRange, Fingerprint, Download } from 'lucide-react';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { fiscalYearsApi, type CloseCheck, type FiscalYear } from '../../api/ledger.api';

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

  const { data: years = [], isLoading } = useQuery({ queryKey: ['ledger-fiscal-years'], queryFn: fiscalYearsApi.list });

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
      + `même par extourne : une correction se fera sur ${fy.year + 1}.`))) return;
    close.mutate(fy.year);
  };

  if (isLoading) return <div style={{ padding: 12 }}><Loader2 size={16} className="animate-spin" /></div>;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontWeight: 600, fontSize: '0.875rem' }}>
        <CalendarRange size={14} /> Exercices
      </div>
      <div className="odoo-section" style={{ padding: 0 }}>
        <table className="odoo-table" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th style={{ width: 110 }}>Exercice</th>
              <th style={{ width: 200 }}>Dates</th>
              <th style={{ width: 170 }}>Statut</th>
              <th style={{ width: 170, textAlign: 'right' }}>Résultat</th>
              <th>À-nouveaux</th>
              <th style={{ width: 380, textAlign: 'right' }}>Actions</th>
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
                    <td style={{ fontWeight: 600 }}>{fy.year}</td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
                      {String(fy.start_date).slice(0, 10)} → {String(fy.end_date).slice(0, 10)}
                    </td>
                    <td>
                      {closed ? (
                        <span className="odoo-tag odoo-tag-red" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <ShieldCheck size={11} /> Clôturé
                        </span>
                      ) : (
                        <span className="odoo-tag odoo-tag-green" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <LockOpen size={11} /> Ouvert{fy.months_open ? ` · ${fy.months_open} mois ouverts` : ''}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: Number(result) < 0 ? '#c62828' : undefined }}>
                      {fmt(result)}
                      {!closed && <span style={{ marginLeft: 4, fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontFamily: 'inherit' }}>provisoire</span>}
                    </td>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}>
                      {fy.opening_entries.length ? fy.opening_entries.join(', ') : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 6, whiteSpace: 'nowrap' }}>
                        <button className="odoo-btn-secondary" onClick={() => setOpenYear(expanded ? null : fy.year)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <ListChecks size={12} /> {expanded ? 'Masquer' : 'Contrôles'}
                        </button>
                        <button className="odoo-btn-secondary" disabled={fec.isPending} onClick={() => fec.mutate(fy.year)}
                          title={closed ? 'Fichier des écritures comptables (avis CNC n° 24) et attestation d\'intégrité'
                            : 'Export provisoire : l\'exercice est encore ouvert'}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {fec.isPending && fec.variables === fy.year ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} FEC
                        </button>
                        {!closed && isAdmin && (
                          <button className="odoo-btn-danger" disabled={!ended || close.isPending} onClick={() => doClose(fy)}
                            title={ended ? undefined : `L'exercice ${fy.year} n'est pas terminé`}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {close.isPending && close.variables === fy.year ? <Loader2 size={12} className="animate-spin" /> : <Lock size={12} />}
                            Clôturer l'exercice
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expanded && (
                    <tr><td colSpan={6} style={{ background: 'var(--theme-bg-page)', padding: 12 }}>
                      {closed ? <ClosedYear fy={fy} /> : <YearChecks year={fy.year} />}
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Exercice clôturé : qui, quand, et l'empreinte à reporter sur le PV de clôture. */
function ClosedYear({ fy }: { fy: FiscalYear }) {
  return (
    <StatusBanner tone="success" icon={ShieldCheck} title={`Exercice ${fy.year} clôturé définitivement`}>
      Le {fy.closed_at ? new Date(fy.closed_at).toLocaleString('fr-FR') : '—'}
      {fy.closed_by_name ? ` par ${fy.closed_by_name}` : ''}. Résultat {fmt(fy.result_amount)} DH reporté en instance
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
  const { data: checks = [], isLoading } = useQuery({
    queryKey: ['ledger-fiscal-year-checklist', year], queryFn: () => fiscalYearsApi.checklist(year),
  });
  if (isLoading) return <Loader2 size={16} className="animate-spin" />;
  const rows = (checks as CloseCheck[]).filter(c => c.code !== 'result');
  const result = (checks as CloseCheck[]).find(c => c.code === 'result');
  const blocking = rows.filter(c => c.blocking && c.item_count > 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {blocking.length > 0
        ? <StatusBanner tone="danger" icon={AlertTriangle} title={`${blocking.length} contrôle(s) bloquant(s)`}>L'exercice ne peut pas être clôturé tant qu'ils ne sont pas résolus.</StatusBanner>
        : <StatusBanner tone="success" icon={CheckCircle2} title="Aucun point bloquant">
            Les mois sans écriture encore ouverts seront fermés d'office ; les à-nouveaux reprendront le résultat de {fmt(result?.amount)} DH.
          </StatusBanner>}
      <table className="odoo-table" style={{ margin: 0 }}>
        <thead><tr><th>Contrôle</th><th style={{ width: 90, textAlign: 'right' }}>Nombre</th><th style={{ width: 130, textAlign: 'right' }}>Montant</th><th style={{ width: 120 }}>Effet</th></tr></thead>
        <tbody>
          {rows.map(c => (
            <tr key={c.code}>
              <td>{c.label}</td>
              <td style={{ textAlign: 'right' }}>{c.item_count}</td>
              <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{c.amount != null && c.item_count > 0 ? fmt(c.amount) : '—'}</td>
              <td>{c.item_count === 0
                ? <span className="odoo-tag odoo-tag-green">OK</span>
                : c.blocking ? <span className="odoo-tag odoo-tag-red">Bloquant</span> : <span className="odoo-tag odoo-tag-orange">À examiner</span>}</td>
            </tr>
          ))}
          {result && (
            <tr>
              <td style={{ fontWeight: 600 }}>{result.label}</td>
              <td />
              <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 600, color: Number(result.amount) < 0 ? '#c62828' : '#0e7c3a' }}>{fmt(result.amount)}</td>
              <td><span className="odoo-tag odoo-tag-grey">Information</span></td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
