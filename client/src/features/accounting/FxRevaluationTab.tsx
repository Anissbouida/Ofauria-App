import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, CheckCircle2, Landmark, Undo2, AlertTriangle, Info, RefreshCw } from 'lucide-react';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { fxRevaluationApi } from '../../api/ledger.api';
import type { FxRevaluation, FxRevaluationLine } from '../../api/ledger.api';
import EditionButtons from './EditionButtons';
import { currencySymbol } from '../../utils/money';
import { DataPanel, ErrorState, FormField, HeaderActions, KpiCard, KpiGrid, LoadingState, SectionHeader } from '../../components/ds';

/**
 * Écarts de change (mig 431) : réévaluation au 31/12 des créances et dettes en
 * devise encore ouvertes, écarts de conversion (37xx / 47xx), provision pour
 * perte de change et contre-passation au 1er janvier.
 */

const n = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (s: string) => s.slice(0, 10).split('-').reverse().join('/');
const rt = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 6 });
const rateNum = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.')) || 0;
const mono = { fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' } as const;

const ACCOUNT_HINT: Record<string, string> = {
  '3701': 'perte latente (créance en baisse)', '3702': 'perte latente (dette en hausse)',
  '4701': 'gain latent (créance en hausse)', '4702': 'gain latent (dette en baisse)',
};

export default function FxRevaluationTab() {
  const qc = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  // Taux saisis (texte) et taux appliqués au calcul (bouton « Recalculer »).
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState<Record<string, number>>({});
  useEffect(() => { setDraft({}); setApplied({}); }, [year]);
  const { data: s, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['fx-revaluation', year, applied], queryFn: () => fxRevaluationApi.get(year, applied),
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['fx-revaluation'] }); qc.invalidateQueries({ queryKey: ['ledger-entries'] }); };
  const onErr = (e: unknown) => notify.error(apiErrorMessage(e, 'Opération impossible'));
  const dirty = Object.entries(draft).some(([k, v]) => rateNum(v) > 0 && rateNum(v) !== (applied[k] ?? s?.rates[k]?.rate ?? 0));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <HeaderActions>
        <EditionButtons kind="ecarts-conversion" params={{ endDate: `${year}-12-31` }} />
      </HeaderActions>

      {s && (
        <>
        {s.status === 'booked'
          ? <StatusBanner tone="success" icon={CheckCircle2} title={`Réévaluation ${year} comptabilisée (${s.reval_entry_number})`}>
              Écarts de conversion contre-passés au 01/01/{year + 1}{s.reopen_entry_number ? ` (${s.reopen_entry_number})` : ''} : chaque facture revient à son taux historique, son règlement dégagera l'écart réel.
            </StatusBanner>
          : <StatusBanner tone="info" icon={Info} title={`Calcul au ${fmtDate(s.closing_date)}`}>
              Créances et dettes en devise encore ouvertes au 31/12, converties au taux de clôture. Comptabilisez la réévaluation une fois les taux du 31/12 connus, avant la clôture de l'exercice.
            </StatusBanner>}
        <KpiGrid>
          <Stat label="Pertes latentes" value={s.loss_total} sub="écarts de conversion actif (37)" />
          <Stat label="Gains latents" value={s.gain_total} sub="écarts de conversion passif (47), sans produit" />
          <Stat label="Provision pour perte de change" value={s.provision} sub={s.provision_reversal ? `reprise ${year - 1} : ${n(s.provision_reversal)}` : '6393 / 4506'} />
          <Stat label="Change réalisé de l'exercice" value={s.realized.net} sub={`gains ${n(s.realized.gain)} · pertes ${n(s.realized.loss)}`} tone={s.realized.net < 0 ? 'neg' : undefined} />
        </KpiGrid>
        </>
      )}

      <div className="prj-toolbar">
        <select value={year} onChange={e => setYear(Number(e.target.value))} className="ds-input sm" style={{ minWidth: 110, width: 'auto' }} aria-label="Exercice">
          {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => <option key={y} value={y}>Exercice {y}</option>)}
        </select>
        {isFetching && !isLoading && <Loader2 size={14} className="animate-spin" aria-label="Actualisation" />}
      </div>
      {isError ? <ErrorState error={error} title="La réévaluation n'a pas pu être chargée" onRetry={() => refetch()} /> : isLoading || !s ? <LoadingState /> : (
        <>
          <Rates s={s} draft={draft} setDraft={setDraft} dirty={dirty} onApply={() => setApplied(
            Object.fromEntries(Object.entries(draft).filter(([, v]) => rateNum(v) > 0).map(([k, v]) => [k, rateNum(v)])))} />
          <Lines s={s} />
          <Booking s={s} applied={applied} dirty={dirty} refresh={refresh} onErr={onErr} />
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number; sub: string; tone?: 'neg' }) {
  return (
    <KpiCard label={label} value={n(value)} sub={sub} tone={tone === 'neg' ? 'red' : undefined} />
  );
}

/** Carte à en-tête : SectionHeader au-dessus, contenu dans un DataPanel (`flush` = tableau sans marge). */
function Section({ title, children, note, aside, flush }: { title: string; children: React.ReactNode; note?: React.ReactNode; aside?: React.ReactNode; flush?: boolean }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <SectionHeader title={title} note={note}>{aside}</SectionHeader>
      <DataPanel label={title}>{flush ? children : <div style={{ padding: 12 }}>{children}</div>}</DataPanel>
    </div>
  );
}

function Rates({ s, draft, setDraft, dirty, onApply }: {
  s: FxRevaluation; draft: Record<string, string>; setDraft: (d: Record<string, string>) => void; dirty: boolean; onApply: () => void;
}) {
  const codes = Object.keys(s.rates);
  if (!codes.length) return null;
  const booked = s.status === 'booked';
  return (
    <Section title={`Taux de clôture au ${fmtDate(s.closing_date)}`} aside={!booked && (
      <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={!dirty} onClick={onApply}>
        <RefreshCw size={12} /> Recalculer
      </button>)}>
      <div className="ds-form-grid cols-4">
        {codes.map(code => {
          const r = s.rates[code];
          const sourceLabel = r.source === 'table' ? `taux du ${fmtDate(r.valid_on!)}` : r.source === 'saisi' ? 'saisi' : 'manquant';
          return booked ? (
            <div key={code} className="ds-field">
              <span className="ds-field-label">1 {code} en {currencySymbol()}</span>
              <span style={mono}>{r.rate != null ? rt(r.rate) : '—'}</span>
            </div>
          ) : (
            <FormField key={code} label={`1 ${code} en ${currencySymbol()}`} htmlFor={`fx-rate-${code}`} required
              hint={r.rate != null ? sourceLabel : undefined} error={r.rate == null ? 'Taux manquant' : undefined}>
              <input id={`fx-rate-${code}`} className="ds-input" value={draft[code] ?? (r.rate != null ? String(r.rate).replace('.', ',') : '')} inputMode="decimal"
                onChange={e => setDraft({ ...draft, [code]: e.target.value })} placeholder="taux" style={{ textAlign: 'right' }} aria-invalid={r.rate == null || undefined} />
            </FormField>
          );
        })}
      </div>
      {s.missing_rates.length > 0 && !booked && (
        <div style={{ marginTop: 8 }}>
          <StatusBanner tone="warning" icon={AlertTriangle} title={`Taux manquant : ${s.missing_rates.join(', ')}`}>
            Saisissez le taux du 31/12 ci-dessus, ou enregistrez-le dans Paramètres › Devises.
          </StatusBanner>
        </div>
      )}
    </Section>
  );
}

function Lines({ s }: { s: FxRevaluation }) {
  if (!s.lines.length) {
    return <Section title="Créances et dettes en devise"><div style={{ fontSize: 13, color: 'var(--ds-muted)' }}>Aucune facture en devise ouverte au {fmtDate(s.closing_date)}.</div></Section>;
  }
  const group = (side: FxRevaluationLine['side']) => s.lines.filter(l => l.side === side);
  return (
    <Section flush title="Créances et dettes en devise">
        <table className="odoo-table ds-dense">
          <thead>
            <tr>
              <th>Facture</th><th>Tiers</th><th className="ds-num">Reste en devise</th>
              <th className="ds-num">Taux facture</th><th className="ds-num">Au taux historique ({currencySymbol()})</th>
              <th className="ds-num">Taux de clôture</th><th className="ds-num">Au taux de clôture ({currencySymbol()})</th>
              <th className="ds-num">Écart ({currencySymbol()})</th><th>Compte</th>
            </tr>
          </thead>
          <tbody>
            {(['receivable', 'payable'] as const).filter(side => group(side).length).map(side => [
              <tr key={side} className="ds-group"><td colSpan={9}>{side === 'receivable' ? 'Créances clients' : 'Dettes fournisseurs'}</td></tr>,
              ...group(side).map(l => (
                <tr key={l.invoice_id}>
                  <td><span className="ds-ref">{l.invoice_number}</span>{l.external_ref && <div style={{ fontSize: 11, color: 'var(--ds-muted)' }}>{l.external_ref}</div>}</td>
                  <td><span className="ds-strong">{l.tiers ?? '—'}</span><div style={{ fontSize: 11, color: 'var(--ds-muted)' }}>du {fmtDate(l.invoice_date)}</div></td>
                  <td className="ds-num">{n(l.foreign_remaining)} {l.currency_code}</td>
                  <td className="ds-num">{rt(l.book_rate)}</td>
                  <td className="ds-num">{n(l.book_amount)}</td>
                  <td className="ds-num">{l.closing_rate != null ? rt(l.closing_rate) : '—'}</td>
                  <td className="ds-num">{l.closing_amount != null ? n(l.closing_amount) : '—'}</td>
                  <td className="ds-num ds-strong" style={{ color: l.account_code?.startsWith('37') ? 'var(--ds-danger)' : l.account_code?.startsWith('47') ? 'var(--ds-success)' : undefined }}>
                    {l.difference != null ? n(l.difference) : '—'}
                  </td>
                  <td title={l.account_code ? ACCOUNT_HINT[l.account_code] : undefined}>
                    {l.account_code && l.account_code !== '-' ? <span className="ds-ref">{l.account_code}</span> : <span style={{ color: 'var(--ds-muted)' }}>—</span>}
                  </td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
    </Section>
  );
}

function Booking({ s, applied, dirty, refresh, onErr }: { s: FxRevaluation; applied: Record<string, number>; dirty: boolean; refresh: () => void; onErr: (e: unknown) => void }) {
  const [reason, setReason] = useState('');
  const book = useMutation({
    mutationFn: () => fxRevaluationApi.book(s.year, {
      ...Object.fromEntries(Object.entries(s.rates).filter(([, r]) => r.rate != null).map(([k, r]) => [k, r.rate as number])), ...applied,
    }),
    onSuccess: r => { notify.success(`Réévaluation comptabilisée (${r.reval_entry_number}${r.reopen_entry_number ? `, contre-passée par ${r.reopen_entry_number}` : ''})`); refresh(); },
    onError: onErr,
  });
  const cancel = useMutation({ mutationFn: () => fxRevaluationApi.cancel(s.year, reason.trim()), onSuccess: () => { setReason(''); notify.success('Réévaluation annulée'); refresh(); }, onError: onErr });
  const moving = s.lines.some(l => l.difference);
  return (
    <Section title="Écritures" note={`montants en ${currencySymbol()}`}>
      {s.status !== 'booked' ? (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, flex: 1, minWidth: 280, lineHeight: 1.6 }}>
            Au 31/12/{s.year} : une ligne par facture sur le compte du tiers (<span style={mono}>3421</span> / <span style={mono}>4411</span>), contrepartie
            {' '}<span style={mono}>37xx</span> (pertes, {n(s.loss_total)}) ou <span style={mono}>47xx</span> (gains, {n(s.gain_total)}) ;
            provision <span style={mono}>6393</span> / <span style={mono}>4506</span> de {n(s.provision)}
            {s.provision_reversal > 0 && <> ; reprise de la provision {s.year - 1} <span style={mono}>4506</span> / <span style={mono}>7393</span> de {n(s.provision_reversal)}</>}.
            {' '}Au 01/01/{s.year + 1} : contre-passation des écarts de conversion.
          </div>
          <button type="button" className="odoo-btn-primary"
            disabled={s.fiscal_year_closed || s.missing_rates.length > 0 || dirty || (!moving && !s.provision_reversal) || book.isPending}
            onClick={() => book.mutate()}
            title={dirty ? 'Recalculez avec les taux saisis avant de comptabiliser' : undefined}>
            {book.isPending ? <Loader2 size={13} className="animate-spin" /> : <Landmark size={13} />} Comptabiliser la réévaluation {s.year}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
          <div>Écriture du 31/12/{s.year} : <span className="ds-ref">{s.reval_entry_number}</span>
            {s.reopen_entry_number && <> · contre-passation du 01/01/{s.year + 1} : <span className="ds-ref">{s.reopen_entry_number}</span></>}</div>
          {!s.fiscal_year_closed && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', borderTop: '1px solid var(--ds-hair)', paddingTop: 8 }}>
              <AlertTriangle size={13} style={{ color: 'var(--ds-warning)' }} aria-hidden="true" />
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Motif pour annuler la réévaluation" aria-label="Motif pour annuler la réévaluation" className="ds-input sm" style={{ flex: 1 }} />
              <button type="button" className="odoo-btn-secondary" disabled={reason.trim().length < 3 || cancel.isPending} onClick={() => cancel.mutate()}><Undo2 size={12} /> Annuler la réévaluation</button>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
