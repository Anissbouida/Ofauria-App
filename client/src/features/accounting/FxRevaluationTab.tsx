import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, CheckCircle2, Landmark, Undo2, AlertTriangle, Info, RefreshCw } from 'lucide-react';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { fxRevaluationApi } from '../../api/ledger.api';
import type { FxRevaluation, FxRevaluationLine } from '../../api/ledger.api';
import EditionButtons from './EditionButtons';

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
const inp: React.CSSProperties = { padding: '5px 8px', border: '1px solid var(--theme-bg-separator)', borderRadius: 6, fontSize: '0.8125rem', background: 'var(--theme-bg-input)' };

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
  const { data: s, isLoading, isFetching } = useQuery({
    queryKey: ['fx-revaluation', year, applied], queryFn: () => fxRevaluationApi.get(year, applied),
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['fx-revaluation'] }); qc.invalidateQueries({ queryKey: ['ledger-entries'] }); };
  const onErr = (e: unknown) => notify.error(apiErrorMessage(e, 'Opération impossible'));
  const dirty = Object.entries(draft).some(([k, v]) => rateNum(v) > 0 && rateNum(v) !== (applied[k] ?? s?.rates[k]?.rate ?? 0));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', gap: 6 }}>
        <select value={year} onChange={e => setYear(Number(e.target.value))} className="odoo-search-input" style={{ minWidth: 110 }} aria-label="Exercice">
          {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => <option key={y} value={y}>Exercice {y}</option>)}
        </select>
        {isFetching && !isLoading && <Loader2 size={14} className="animate-spin" />}
        <div style={{ flex: 1 }} />
        <EditionButtons kind="ecarts-conversion" params={{ endDate: `${year}-12-31` }} />
      </div>
      {isLoading || !s ? <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><Loader2 size={20} className="animate-spin" /></div> : (
        <>
          {s.status === 'booked'
            ? <StatusBanner tone="success" icon={CheckCircle2} title={`Réévaluation ${year} comptabilisée (${s.reval_entry_number})`}>
                Écarts de conversion contre-passés au 01/01/{year + 1}{s.reopen_entry_number ? ` (${s.reopen_entry_number})` : ''} : chaque facture revient à son taux historique, son règlement dégagera l'écart réel.
              </StatusBanner>
            : <StatusBanner tone="info" icon={Info} title={`Calcul au ${fmtDate(s.closing_date)}`}>
                Créances et dettes en devise encore ouvertes au 31/12, converties au taux de clôture. Comptabilisez la réévaluation une fois les taux du 31/12 connus, avant la clôture de l'exercice.
              </StatusBanner>}
          <div className="odoo-stat-grid">
            <Stat label="Pertes latentes" value={s.loss_total} sub="écarts de conversion actif (37)" />
            <Stat label="Gains latents" value={s.gain_total} sub="écarts de conversion passif (47), sans produit" />
            <Stat label="Provision pour perte de change" value={s.provision} sub={s.provision_reversal ? `reprise ${year - 1} : ${n(s.provision_reversal)}` : '6393 / 4506'} />
            <Stat label="Change réalisé de l'exercice" value={s.realized.net} sub={`gains ${n(s.realized.gain)} · pertes ${n(s.realized.loss)}`} tone={s.realized.net < 0 ? 'neg' : undefined} />
          </div>
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
    <div className="odoo-stat-card">
      <div className="odoo-stat-card-label">{label}</div>
      <div className="odoo-stat-card-value" style={{ color: tone === 'neg' ? '#c62828' : undefined }}>{n(value)}</div>
      <div className="odoo-stat-card-sub">{sub}</div>
    </div>
  );
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="odoo-section" style={{ padding: 0 }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--theme-bg-separator)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--theme-bg-secondary)' }}>
        <strong style={{ fontSize: '0.8125rem', flex: 1 }}>{title}</strong>{aside}
      </div>
      <div style={{ padding: 12 }}>{children}</div>
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
      <button type="button" className="odoo-btn-secondary" disabled={!dirty} onClick={onApply} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <RefreshCw size={12} /> Recalculer
      </button>)}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {codes.map(code => {
          const r = s.rates[code];
          return (
            <label key={code} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem' }}>
              <strong>1 {code} =</strong>
              {booked ? <span style={mono}>{r.rate != null ? rt(r.rate) : '—'}</span> : (
                <input value={draft[code] ?? (r.rate != null ? String(r.rate).replace('.', ',') : '')} inputMode="decimal"
                  onChange={e => setDraft({ ...draft, [code]: e.target.value })} placeholder="taux"
                  style={{ ...inp, width: 90, textAlign: 'right', borderColor: r.rate == null ? '#c62828' : undefined }} />
              )}
              <span>DH</span>
              {!booked && <span style={{ color: r.rate == null ? '#c62828' : 'var(--theme-text-muted)', fontSize: '0.75rem' }}>
                {r.source === 'table' ? `taux du ${fmtDate(r.valid_on!)}` : r.source === 'saisi' ? 'saisi' : 'manquant'}
              </span>}
            </label>
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
    return <Section title="Créances et dettes en devise"><div style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Aucune facture en devise ouverte au {fmtDate(s.closing_date)}.</div></Section>;
  }
  const group = (side: FxRevaluationLine['side']) => s.lines.filter(l => l.side === side);
  return (
    <Section title="Créances et dettes en devise">
      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Facture</th><th>Tiers</th><th style={{ textAlign: 'right' }}>Reste en devise</th>
              <th style={{ textAlign: 'right' }}>Taux facture</th><th style={{ textAlign: 'right' }}>Au taux historique</th>
              <th style={{ textAlign: 'right' }}>Taux de clôture</th><th style={{ textAlign: 'right' }}>Au taux de clôture</th>
              <th style={{ textAlign: 'right' }}>Écart</th><th>Compte</th>
            </tr>
          </thead>
          <tbody>
            {(['receivable', 'payable'] as const).filter(side => group(side).length).map(side => [
              <tr key={side}><td colSpan={9} style={{ fontWeight: 600, background: 'var(--theme-bg-secondary)' }}>{side === 'receivable' ? 'Créances clients' : 'Dettes fournisseurs'}</td></tr>,
              ...group(side).map(l => (
                <tr key={l.invoice_id}>
                  <td><span style={mono}>{l.invoice_number}</span>{l.external_ref && <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>{l.external_ref}</div>}</td>
                  <td>{l.tiers ?? '—'}<div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>du {fmtDate(l.invoice_date)}</div></td>
                  <td style={{ ...mono, textAlign: 'right' }}>{n(l.foreign_remaining)} {l.currency_code}</td>
                  <td style={{ ...mono, textAlign: 'right' }}>{rt(l.book_rate)}</td>
                  <td style={{ ...mono, textAlign: 'right' }}>{n(l.book_amount)}</td>
                  <td style={{ ...mono, textAlign: 'right' }}>{l.closing_rate != null ? rt(l.closing_rate) : '—'}</td>
                  <td style={{ ...mono, textAlign: 'right' }}>{l.closing_amount != null ? n(l.closing_amount) : '—'}</td>
                  <td style={{ ...mono, textAlign: 'right', fontWeight: 600, color: l.account_code?.startsWith('37') ? '#c62828' : l.account_code?.startsWith('47') ? '#2e7d32' : undefined }}>
                    {l.difference != null ? n(l.difference) : '—'}
                  </td>
                  <td title={l.account_code ? ACCOUNT_HINT[l.account_code] : undefined}>
                    {l.account_code && l.account_code !== '-' ? <span style={mono}>{l.account_code}</span> : <span style={{ color: 'var(--theme-text-muted)' }}>—</span>}
                  </td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
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
    <Section title="Écritures">
      {s.status !== 'booked' ? (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '0.8125rem', flex: 1, minWidth: 280, lineHeight: 1.6 }}>
            Au 31/12/{s.year} : une ligne par facture sur le compte du tiers (<span style={mono}>3421</span> / <span style={mono}>4411</span>), contrepartie
            {' '}<span style={mono}>37xx</span> (pertes, {n(s.loss_total)}) ou <span style={mono}>47xx</span> (gains, {n(s.gain_total)}) ;
            provision <span style={mono}>6393</span> / <span style={mono}>4506</span> de {n(s.provision)}
            {s.provision_reversal > 0 && <> ; reprise de la provision {s.year - 1} <span style={mono}>4506</span> / <span style={mono}>7393</span> de {n(s.provision_reversal)}</>}.
            {' '}Au 01/01/{s.year + 1} : contre-passation des écarts de conversion.
          </div>
          <button type="button" className="odoo-btn-primary"
            disabled={s.fiscal_year_closed || s.missing_rates.length > 0 || dirty || (!moving && !s.provision_reversal) || book.isPending}
            onClick={() => book.mutate()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            title={dirty ? 'Recalculez avec les taux saisis avant de comptabiliser' : undefined}>
            {book.isPending ? <Loader2 size={13} className="animate-spin" /> : <Landmark size={13} />} Comptabiliser la réévaluation {s.year}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.8125rem' }}>
          <div>Écriture du 31/12/{s.year} : <span style={{ ...mono, color: '#185fa5' }}>{s.reval_entry_number}</span>
            {s.reopen_entry_number && <> · contre-passation du 01/01/{s.year + 1} : <span style={{ ...mono, color: '#185fa5' }}>{s.reopen_entry_number}</span></>}</div>
          {!s.fiscal_year_closed && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', borderTop: '1px solid var(--theme-bg-separator)', paddingTop: 8 }}>
              <AlertTriangle size={13} style={{ color: '#856404' }} />
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Motif pour annuler la réévaluation" style={{ ...inp, flex: 1 }} />
              <button type="button" className="odoo-btn-secondary" disabled={reason.trim().length < 3 || cancel.isPending} onClick={() => cancel.mutate()}><Undo2 size={12} /> Annuler la réévaluation</button>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
